#!/usr/bin/env bash
# fm-tool-patches.sh - keep this fleet's local fixes to third-party CLI tools applied.
#
# Usage:
#   fm-tool-patches.sh [--check]
#     Detect only. Prints one line per patch that is not applied and exits 0.
#     Silent when every patch is applied, and silent for a patch whose tool is
#     not installed on this machine - an absent optional tool is not a problem.
#       "TOOL_PATCH: <tool>/<name> (apply: bin/fm-tool-patches.sh --apply)"
#       "TOOL_PATCH_CONFLICT: <tool>/<name> no longer applies to the installed
#        <tool> (<version>); re-read the patch against the new source"
#   fm-tool-patches.sh --apply
#     Apply every pending patch, then print what changed. Idempotent: a patch
#     that is already applied is left alone, so this is safe to re-run.
#   fm-tool-patches.sh --status
#     Print every known patch with its resolved state, including applied ones.
#
# Why this exists: some CLI tools firstmate depends on carry bugs fixed here
# rather than upstream, and a global `npm install -g <tool>` silently reverts the
# fix. A tracked patch plus an idempotent applier is what lets a fresh machine
# reproduce this fleet exactly instead of depending on someone remembering.
#
# Layout: patches/<tool>/<name>.patch, each a unified diff written against the
# tool's installed package root and applied with `patch -p1`. <tool> is the
# command name; its package root is resolved by following `command -v <tool>` to
# a real path and walking up to the nearest directory holding a package.json.
#
# A patch that no longer applies is reported as a conflict and never forced.
# That state means the tool changed underneath the fix, which needs a human to
# re-read it - forcing would corrupt a working install to preserve a stale fix.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PATCHES="${FM_PATCHES_OVERRIDE:-$FM_ROOT/patches}"

usage() {
  sed -n '2,${/^#/!q;p;}' "$0" | sed 's/^# \{0,1\}//'
}

MODE=check
case "${1:-}" in
  ''|--check) MODE=check ;;
  --apply) MODE=apply ;;
  --status) MODE=status ;;
  -h|--help) usage; exit 0 ;;
  *) echo "error: unknown argument '$1'; expected --check, --apply, --status, or --help" >&2; exit 2 ;;
esac

# Follow a symlink chain by hand: the tool is typically a relative link from a
# bin directory into a sibling lib tree, and `readlink -f` is not portable.
resolve_link() {  # <path> -> real path
  local p=$1 target
  while [ -L "$p" ]; do
    target=$(readlink "$p")
    case "$target" in
      /*) p=$target ;;
      *) p=$(dirname "$p")/$target ;;
    esac
  done
  printf '%s/%s\n' "$(cd "$(dirname "$p")" && pwd -P)" "$(basename "$p")"
}

package_root_for() {  # <tool> -> installed package root, or empty when absent
  local tool=$1 bin dir
  bin=$(command -v "$tool" 2>/dev/null) || return 0
  [ -n "$bin" ] || return 0
  dir=$(dirname "$(resolve_link "$bin")")
  while [ "$dir" != / ] && [ -n "$dir" ]; do
    if [ -f "$dir/package.json" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 0
}

tool_version() {  # <package-root> -> version string, or "unknown"
  local root=$1 version
  version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$root/package.json" 2>/dev/null | head -1)
  printf '%s\n' "${version:-unknown}"
}

# applied  - the installed file already carries this patch (reverse applies)
# pending  - the patch applies cleanly and has not been applied
# conflict - neither direction applies; the tool changed underneath the patch
patch_state() {  # <package-root> <patch-file> -> applied|pending|conflict
  local root=$1 file=$2
  if patch -p1 -R -f -s --dry-run -d "$root" < "$file" >/dev/null 2>&1; then
    printf 'applied\n'
  elif patch -p1 -f -s --dry-run -d "$root" < "$file" >/dev/null 2>&1; then
    printf 'pending\n'
  else
    printf 'conflict\n'
  fi
}

[ -d "$PATCHES" ] || exit 0

applied_now=0
for tool_dir in "$PATCHES"/*/; do
  [ -d "$tool_dir" ] || continue
  tool=$(basename "$tool_dir")
  root=$(package_root_for "$tool")

  for file in "$tool_dir"*.patch; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .patch)

    if [ -z "$root" ]; then
      # Not installed here. Only --status has any reason to mention it.
      [ "$MODE" = status ] && printf 'not-installed  %s/%s\n' "$tool" "$name"
      continue
    fi

    state=$(patch_state "$root" "$file")
    case "$MODE:$state" in
      status:*)
        printf '%-13s  %s/%s (%s %s)\n' "$state" "$tool" "$name" "$tool" "$(tool_version "$root")" ;;
      check:pending)
        printf 'TOOL_PATCH: %s/%s (apply: bin/fm-tool-patches.sh --apply)\n' "$tool" "$name" ;;
      check:conflict|apply:conflict)
        printf 'TOOL_PATCH_CONFLICT: %s/%s no longer applies to the installed %s (%s); re-read the patch against the new source\n' \
          "$tool" "$name" "$tool" "$(tool_version "$root")" ;;
      apply:pending)
        if patch -p1 -f -s -d "$root" < "$file" >/dev/null 2>&1; then
          printf 'applied %s/%s to %s\n' "$tool" "$name" "$root"
          applied_now=$((applied_now + 1))
        else
          printf 'error: %s/%s reported as applicable but failed to apply to %s\n' "$tool" "$name" "$root" >&2
          exit 1
        fi ;;
    esac
  done
done

if [ "$MODE" = apply ] && [ "$applied_now" -eq 0 ]; then
  echo "no pending tool patches"
fi
exit 0
