#!/usr/bin/env bash
# Bootstrap detection, best-effort fleet refresh/prune, and installs.
# Usage: fm-bootstrap.sh
#          Detect: prints one line per actionable problem, or an explicit
#          BOOTSTRAP_INFO no-action fact for completed benign bootstrap work, and
#          exits 0.
#          Silent = all good.
#          Lines: "MISSING: <tool> (install: <command>)",
#                 "MISSING_MANUAL: <tool> (instructions: <url>)", "NEEDS_GH_AUTH",
#                 "BACKEND_INVALID: <name> (known: <names>)",
#                 "STARTUP_MEMORY_BUDGET: invalid config/startup-memory-budget - <reason>",
#                 "FLEET_SYNC: <repo>: skipped|recovered|STUCK: <detail>",
#                 "PR_CHECK_MIGRATION: <private remediation>",
#                 "TANGLE: <remediation>",
#                 "BOOTSTRAP_INFO: nudged fm-<id> with '<message>'".
#          A TANGLE line means the firstmate primary checkout (FM_ROOT) is stranded
#          on a feature branch instead of its default branch - a crewmate's work
#          landed in the primary instead of its own worktree; restore it per the line.
#          no-mistakes is also MISSING when its installed version is older than
#          1.31.2.
#          LOCAL FORK: COMMON_TOOLS is trimmed to "node git gh". Upstream also
#          required no-mistakes, gh-axi, chrome-devtools-axi, lavish-axi and
#          tasks-axi. Of those, chrome-devtools-axi and lavish-axi have no shell
#          call site at all - they are agent-facing capabilities, so gating
#          dispatch on them was pure friction. no-mistakes is replaced by this
#          repo's own judge fleet (skills/coding/), gh-axi is swapped for plain
#          gh in fm-pr-merge.sh, and tasks-axi is deferred via
#          config/backlog-backend=manual. The version gates below are all guarded
#          by `command -v`, so they stay correct no-ops until a tool is installed
#          and start enforcing again the moment one is. See FORK-NOTES.md.
#          Upstream's requirement text, still accurate for anything installed:
#          tasks-axi is a required bootstrap tool (same class as lavish-axi) and
#          is version and feature gated (0.1.1+ with update --archive-body and
#          mv [<id>...]); an installed but incompatible build reports MISSING
#          like no-mistakes. A compatible tasks-axi default backend is silent.
#          On a primary home, the locked mutable path materializes the visible
#          default config/startup-memory-budget=7500 when absent. It never
#          guesses at malformed or unsafe existing files.
#          Fleet sync fetches, fast-forwards safe default-branch states, reports
#          recovered and STUCK clone drift, and prunes gone local branches; it is
#          bounded by FM_FLEET_SYNC_BOOTSTRAP_TIMEOUT when it is a non-empty
#          numeric override, while non-numeric values fall back to 20s.
#          When the override is unset or blank, the timeout is
#          max(20, 5 + 3 * origin-backed project clone count). A timed-out
#          refresh relays any completed fm-fleet-sync.sh output before the
#          aggregate timeout skip line with timeout and elapsed seconds.
#          Set FM_FLEET_PRUNE=0 to skip branch pruning during that refresh.
#          Set FM_BOOTSTRAP_DETECT_ONLY=1 to skip the two MUTATING sweeps
#          (PR-check migration, fleet_sync) while still printing every read-only
#          detect line above; the TANGLE line switches to advisory-only wording
#          with no checkout command. Used by fm-session-start.sh's read-only path
#          when another live session holds the fleet lock, so a second concurrent
#          session never race-mutates PR-check artifacts, project clones, or
#          repair instructions.
#          Unset/0 (the default) runs every sweep exactly as before - this flag
#          is purely additive.
#        fm-bootstrap.sh install <tool>...
#          Install the named tools (only ones the captain approved).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"
PROJECTS="${FM_PROJECTS_OVERRIDE:-$FM_HOME/projects}"
CONFIG="${FM_CONFIG_OVERRIDE:-$FM_HOME/config}"
# shellcheck source=bin/fm-tasks-axi-lib.sh disable=SC1091
. "$SCRIPT_DIR/fm-tasks-axi-lib.sh"
# shellcheck source=bin/fm-tangle-lib.sh disable=SC1091
. "$SCRIPT_DIR/fm-tangle-lib.sh"
# shellcheck source=bin/fm-ff-lib.sh disable=SC1091
. "$SCRIPT_DIR/fm-ff-lib.sh"
# shellcheck source=bin/fm-startup-memory-budget-lib.sh disable=SC1091
. "$SCRIPT_DIR/fm-startup-memory-budget-lib.sh"
# shellcheck source=bin/fm-x-lib.sh disable=SC1091
. "$SCRIPT_DIR/fm-x-lib.sh"
# shellcheck source=bin/fm-backend.sh disable=SC1091
. "$SCRIPT_DIR/fm-backend.sh"

fleet_sync_origin_backed_project_count() {
  local count proj
  count=0
  [ -d "$PROJECTS" ] || { echo 0; return 0; }
  for proj in "$PROJECTS"/*; do
    [ -d "$proj" ] || continue
    git -C "$proj" rev-parse --git-dir >/dev/null 2>&1 || continue
    git -C "$proj" remote get-url origin >/dev/null 2>&1 || continue
    count=$((count + 1))
  done
  echo "$count"
}

fleet_sync_bootstrap_timeout() {
  local count timeout
  if [ -n "${FM_FLEET_SYNC_BOOTSTRAP_TIMEOUT:-}" ]; then
    case "$FM_FLEET_SYNC_BOOTSTRAP_TIMEOUT" in
      *[!0-9]*) echo 20 ;;
      *) echo "$FM_FLEET_SYNC_BOOTSTRAP_TIMEOUT" ;;
    esac
    return 0
  fi

  count=$(fleet_sync_origin_backed_project_count)
  timeout=$((5 + (3 * count)))
  [ "$timeout" -ge 20 ] || timeout=20
  echo "$timeout"
}

fleet_sync_relay_filtered_output() {
  local tmp=$1 line
  while IFS= read -r line; do
    case "$line" in
      *': skipped: local-only project') ;;
      *': skipped: no origin remote') ;;
      *': skipped:'*) echo "FLEET_SYNC: $line" ;;
      *': STUCK:'*) echo "FLEET_SYNC: $line" ;;
      *': recovered:'*) echo "FLEET_SYNC: $line" ;;
    esac
  done < "$tmp"
}

fleet_sync_relay_all_output() {
  local tmp=$1 line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "FLEET_SYNC: $line"
  done < "$tmp"
}

fleet_sync() {
  [ -x "$FM_ROOT/bin/fm-fleet-sync.sh" ] || return 0
  [ -d "$PROJECTS" ] || return 0

  tmp=$(mktemp "${TMPDIR:-/tmp}/fm-fleet-sync.XXXXXX" 2>/dev/null) || return 0
  timeout=$(fleet_sync_bootstrap_timeout)
  monitor_was_on=0
  case $- in *m*) monitor_was_on=1 ;; esac
  set -m 2>/dev/null || true
  "$FM_ROOT/bin/fm-fleet-sync.sh" >"$tmp" 2>/dev/null &
  pid=$!

  start=$SECONDS
  while jobs -r -p | grep -qx "$pid"; do
    elapsed=$((SECONDS - start))
    if [ "$elapsed" -ge "$timeout" ]; then
      kill -TERM "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      [ "$monitor_was_on" -eq 1 ] || set +m 2>/dev/null || true
      fleet_sync_relay_all_output "$tmp"
      echo "FLEET_SYNC: fleet: skipped: bootstrap refresh timed out (timeout=${timeout}s elapsed=${elapsed}s)"
      rm -f "$tmp"
      return 0
    fi
    sleep 1
  done
  wait "$pid" 2>/dev/null || true
  [ "$monitor_was_on" -eq 1 ] || set +m 2>/dev/null || true

  fleet_sync_relay_filtered_output "$tmp"
  rm -f "$tmp"
}

install_cmd() {
  case "$1" in
    tmux|node|git|gh|curl|jq) echo "brew install $1  # or the platform's package manager" ;;
    no-mistakes) echo "curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh" ;;
    gh-axi|chrome-devtools-axi|lavish-axi) echo "npm install -g $1 && $1 setup hooks" ;;
    tasks-axi) echo "npm install -g $1" ;;
    *) return 1 ;;
  esac
}

manual_install_url() {
  return 1
}

missing_tool_diagnostic() {
  local tool=$1 instructions
  if instructions=$(manual_install_url "$tool"); then
    echo "MISSING_MANUAL: $tool (instructions: $instructions)"
    return 0
  fi
  echo "MISSING: $tool (install: $(install_cmd "$tool"))"
}

# Required-tool detection follows the RESOLVED backend, not a one-size default:
# a universal toolchain every home needs plus the backend-specific delta owned by
# fm_backend_required_tools (bin/fm-backend.sh). A backend value with no verified
# dependency set is reported before the universal checks continue.
# LOCAL FORK: trimmed from upstream's
#   "node git gh no-mistakes gh-axi chrome-devtools-axi lavish-axi tasks-axi"
# See the rationale in this file's header and FORK-NOTES.md.
COMMON_TOOLS="node git gh"
BACKEND=$(fm_backend_name)
BACKEND_VALID=1
if ! BACKEND_TOOLS=$(fm_backend_required_tools "$BACKEND"); then
  BACKEND_VALID=0
  BACKEND_TOOLS=""
fi
NO_MISTAKES_MIN=1.31.2

# Shared semantic-version floor for the tool gates below. A version string that
# cannot be parsed into exactly one major.minor.patch triple is incompatible,
# never assumed current, so a development or vendored build cannot pass a floor
# it was never checked against.
tool_version_at_least() {  # <tool> <min-version>
  local tool=$1 min=$2 output parts major minor patch extra
  local min_major min_minor min_patch min_extra
  command -v "$tool" >/dev/null 2>&1 || return 1
  output=$("$tool" --version 2>/dev/null) || return 1
  parts=$(printf '%s\n' "$output" | sed -nE 's/.*[vV]?([0-9]+)\.([0-9]+)\.([0-9]+).*/\1 \2 \3/p' | head -n 1)
  IFS=' ' read -r major minor patch extra <<< "$parts"
  [ -n "$major" ] && [ -n "$minor" ] && [ -n "$patch" ] && [ -z "$extra" ] || return 1
  IFS='.' read -r min_major min_minor min_patch min_extra <<< "$min"
  [ -n "$min_major" ] && [ -n "$min_minor" ] && [ -n "$min_patch" ] && [ -z "$min_extra" ] || return 1
  [ "$major" -gt "$min_major" ] && return 0
  [ "$major" -eq "$min_major" ] || return 1
  [ "$minor" -gt "$min_minor" ] && return 0
  [ "$minor" -eq "$min_minor" ] || return 1
  [ "$patch" -ge "$min_patch" ]
}

startup_memory_budget_setup() {
  if ! fm_startup_memory_budget_materialize "$CONFIG"; then
    echo "STARTUP_MEMORY_BUDGET: invalid config/$FM_STARTUP_MEMORY_BUDGET_FILE - $FM_STARTUP_MEMORY_BUDGET_ERROR"
  fi
}

if [ "${1:-}" = "install" ]; then
  shift
  [ $# -gt 0 ] || { echo "usage: fm-bootstrap.sh install <tool>..." >&2; exit 1; }
  for t in "$@"; do
    if ! cmd=$(install_cmd "$t"); then
      instructions=$(manual_install_url "$t") || { echo "error: unknown tool $t" >&2; exit 1; }
      echo "error: $t requires manual installation (instructions: $instructions)" >&2
      exit 1
    fi
    cmd=${cmd%%  #*}
    echo "installing $t: $cmd"
    eval "$cmd"
  done
  exit 0
fi

# This is the first mutating sweep at a locked session boundary. It pauses an
# identity-matched watcher, holds its lock, and neutralizes legacy PR checks
# before any tool detection or later bootstrap mutation can leave old artifacts
# runnable. Detect-only sessions never touch state.
if [ "${FM_BOOTSTRAP_DETECT_ONLY:-0}" != 1 ]; then
  "$SCRIPT_DIR/fm-pr-check-migrate.sh" || true
  startup_memory_budget_setup
fi

if [ "$BACKEND_VALID" -eq 0 ]; then
  echo "BACKEND_INVALID: $BACKEND (known: $FM_BACKEND_KNOWN)"
fi
for t in $BACKEND_TOOLS; do
  fm_backend_required_tool_available "$BACKEND" "$t" \
    || missing_tool_diagnostic "$t"
done
for t in $COMMON_TOOLS; do
  command -v "$t" >/dev/null || missing_tool_diagnostic "$t"
done
if command -v no-mistakes >/dev/null 2>&1 && ! tool_version_at_least no-mistakes "$NO_MISTAKES_MIN"; then
  echo "MISSING: no-mistakes (install: $(install_cmd no-mistakes))"
fi
if command -v tasks-axi >/dev/null 2>&1 && ! fm_tasks_axi_compatible; then
  echo "MISSING: tasks-axi (install: $(install_cmd tasks-axi))"
fi
gh auth status >/dev/null 2>&1 || echo "NEEDS_GH_AUTH"
# Worktree-tangle check: the firstmate primary checkout (FM_ROOT) must sit on its
# default branch, not a feature branch (see fm-tangle-lib.sh). Scoped to the
# primary only; a detached-HEAD worktree never trips it.
tangle_branch=$(fm_primary_tangle_branch "$FM_ROOT" 2>/dev/null || true)
if [ -n "$tangle_branch" ]; then
  tangle_default=$(fm_default_branch "$FM_ROOT" 2>/dev/null || echo main)
  if [ "${FM_BOOTSTRAP_DETECT_ONLY:-0}" = 1 ]; then
    echo "TANGLE: primary checkout on feature branch '$tangle_branch' (expected '$tangle_default'); the work is safe on that ref - read-only session must leave restore work to the session holding the fleet lock"
  else
    echo "TANGLE: primary checkout on feature branch '$tangle_branch' (expected '$tangle_default'); the work is safe on that ref - restore the primary with: git -C $FM_ROOT checkout $tangle_default, then re-validate the branch in a proper worktree"
  fi
fi
crew=
[ -f "$CONFIG/crew-harness" ] && crew=$(tr -d '[:space:]' < "$CONFIG/crew-harness" || true)
if [ "${FM_BOOTSTRAP_VERBOSE_FACTS:-0}" = 1 ] && [ -n "$crew" ] && [ "$crew" != "default" ]; then
  echo "BOOTSTRAP_INFO: crew harness override active: $crew"
fi
if [ "${FM_BOOTSTRAP_VERBOSE_FACTS:-0}" = 1 ] \
  && ! fm_backlog_backend_manual "$CONFIG" && fm_tasks_axi_compatible; then
  echo "BOOTSTRAP_INFO: tasks-axi available"
fi
if [ "${FM_BOOTSTRAP_DETECT_ONLY:-0}" != 1 ]; then
  fleet_sync
fi
exit 0
