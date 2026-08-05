#!/usr/bin/env bash
# fm-tool-patches behavior.
#
# The point of tracking a third-party fix as a patch is that a fresh machine, or
# a machine that just reinstalled the tool, converges to the same state without
# anyone remembering. These tests pin that contract through the CLI: pending is
# reported once and applied silently thereafter, applying twice is a no-op, a
# tool that is not installed is not a problem, and a patch that no longer applies
# refuses loudly instead of forcing a stale fix onto changed source.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PATCHER="$ROOT/bin/fm-tool-patches.sh"
TMP_ROOT=$(fm_test_tmproot fm-tool-patches)

# A fake globally-installed npm CLI: bin/<tool> symlinked into a package tree,
# exactly the shape fm-tool-patches has to resolve back to a package root.
make_fake_tool() {  # <dir> <tool> <version> <file-contents> -> echoes fakebin dir
  local dir=$1 tool=$2 version=$3 contents=$4
  mkdir -p "$dir/lib/node_modules/$tool/dist" "$dir/bin"
  printf '{\n  "name": "%s",\n  "version": "%s"\n}\n' "$tool" "$version" \
    > "$dir/lib/node_modules/$tool/package.json"
  printf '%s' "$contents" > "$dir/lib/node_modules/$tool/dist/client.js"
  ln -sf "../lib/node_modules/$tool/dist/cli.mjs" "$dir/bin/$tool"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$dir/lib/node_modules/$tool/dist/cli.mjs"
  chmod +x "$dir/lib/node_modules/$tool/dist/cli.mjs"
  printf '%s\n' "$dir/bin"
}

PRISTINE='one
two
three
'
FIXED='one
two
patched
three
'

make_patches_dir() {  # <dir> <tool> -> echoes patches dir
  local dir=$1 tool=$2 patches="$1/patches"
  mkdir -p "$patches/$tool" "$dir/before/dist" "$dir/after/dist"
  printf '%s' "$PRISTINE" > "$dir/before/dist/client.js"
  printf '%s' "$FIXED" > "$dir/after/dist/client.js"
  diff -u --label a/dist/client.js --label b/dist/client.js \
    "$dir/before/dist/client.js" "$dir/after/dist/client.js" \
    > "$patches/$tool/add-the-fix.patch" || true
  printf '%s\n' "$patches"
}

# Compare through command substitution on both sides so the trailing newline is
# stripped identically; comparing a $(cat) against a raw heredoc-style variable
# fails on that newline alone and says nothing about the behavior under test.
assert_file_is() {  # <file> <expected> <message>
  [ "$(cat "$1")" = "$(printf '%s' "$2")" ] || fail "$3"$'\n'"$(cat "$1")"
}

# Sets OUT and RC as globals rather than echoing: a command substitution around
# the call would run it in a subshell, where the captured exit code dies with it.
OUT=
RC=0
run_patcher() {  # <fakebin> <patches> [args...]
  local fb=$1 patches=$2; shift 2
  set +e
  OUT=$(PATH="$fb:$PATH" FM_PATCHES_OVERRIDE="$patches" "$PATCHER" "$@" 2>&1)
  RC=$?
  set -e
}

test_pending_is_reported_then_applied_and_silent() {
  local dir fb patches out installed
  dir="$TMP_ROOT/converge"; mkdir -p "$dir"
  fb=$(make_fake_tool "$dir/install" widget-axi 1.2.3 "$PRISTINE")
  patches=$(make_patches_dir "$dir" widget-axi)
  installed="$dir/install/lib/node_modules/widget-axi/dist/client.js"

  run_patcher "$fb" "$patches" --check
  out=$OUT
  expect_code 0 "$RC" "a detect run always exits 0"
  assert_contains "$out" "TOOL_PATCH: widget-axi/add-the-fix" "an unapplied patch must be reported"
  assert_contains "$out" "bin/fm-tool-patches.sh --apply" "the report must name the command that fixes it"
  assert_file_is "$installed" "$PRISTINE" "a detect run must not modify the install"

  run_patcher "$fb" "$patches" --apply
  out=$OUT
  expect_code 0 "$RC" "applying a pending patch should succeed"
  assert_contains "$out" "applied widget-axi/add-the-fix" "apply should name what it applied"
  assert_file_is "$installed" "$FIXED" "the installed file was not patched"

  run_patcher "$fb" "$patches" --check
  out=$OUT
  expect_code 0 "$RC" "a detect run after applying should exit 0"
  [ -z "$out" ] || fail "an applied patch must report nothing"$'\n'"$out"
  pass "fm-tool-patches: a pending patch is reported once, applied, then silent"
}

test_applying_twice_changes_nothing() {
  local dir fb patches out installed first
  dir="$TMP_ROOT/idempotent"; mkdir -p "$dir"
  fb=$(make_fake_tool "$dir/install" widget-axi 1.2.3 "$PRISTINE")
  patches=$(make_patches_dir "$dir" widget-axi)
  installed="$dir/install/lib/node_modules/widget-axi/dist/client.js"

  run_patcher "$fb" "$patches" --apply
  first=$(cat "$installed")

  run_patcher "$fb" "$patches" --apply
  out=$OUT
  expect_code 0 "$RC" "a second apply should succeed rather than error"
  assert_contains "$out" "no pending tool patches" "a second apply should say there was nothing to do"
  [ "$(cat "$installed")" = "$first" ] || fail "a second apply changed the installed file"$'\n'"$(cat "$installed")"
  pass "fm-tool-patches: applying an already-applied patch is a no-op"
}

# No fake tool is installed for this one, so widget-axi resolves nowhere. The
# real PATH stays in front of nothing extra: the script still needs patch, sed
# and friends, and emptying PATH would test the harness rather than the script.
test_absent_tool_is_not_a_problem() {
  local dir fb patches out
  dir="$TMP_ROOT/absent"; mkdir -p "$dir/emptybin"
  fb="$dir/emptybin"
  patches=$(make_patches_dir "$dir" widget-axi)

  run_patcher "$fb" "$patches" --check
  out=$OUT
  expect_code 0 "$RC" "an uninstalled tool must not fail the detect run"
  [ -z "$out" ] || fail "an uninstalled tool must not print a diagnostic"$'\n'"$out"

  run_patcher "$fb" "$patches" --status
  assert_contains "$OUT" "not-installed" "--status should still account for an uninstalled tool"
  pass "fm-tool-patches: a patch for a tool that is not installed is silent"
}

# The dangerous failure is forcing a stale fix onto source that moved. It must
# refuse, name the version it refused against, and leave the install untouched.
test_a_patch_that_no_longer_applies_refuses_instead_of_forcing() {
  local dir fb patches out installed moved
  dir="$TMP_ROOT/conflict"; mkdir -p "$dir"
  moved='completely
different
upstream
source
'
  fb=$(make_fake_tool "$dir/install" widget-axi 9.9.9 "$moved")
  patches=$(make_patches_dir "$dir" widget-axi)
  installed="$dir/install/lib/node_modules/widget-axi/dist/client.js"

  run_patcher "$fb" "$patches" --check
  out=$OUT
  expect_code 0 "$RC" "a conflicting patch is reported, not an error exit"
  assert_contains "$out" "TOOL_PATCH_CONFLICT: widget-axi/add-the-fix" "a conflict must be reported as a conflict"
  assert_contains "$out" "9.9.9" "the conflict must name the installed version it refused against"

  run_patcher "$fb" "$patches" --apply
  out=$OUT
  assert_contains "$out" "TOOL_PATCH_CONFLICT" "apply must report the conflict rather than forcing"
  assert_file_is "$installed" "$moved" "a conflicting patch was forced onto changed source"
  [ ! -e "$installed.rej" ] || fail "a conflicting patch left reject litter in the install"
  pass "fm-tool-patches: a patch that no longer applies refuses and leaves the install alone"
}

test_pending_is_reported_then_applied_and_silent
test_applying_twice_changes_nothing
test_absent_tool_is_not_a_problem
test_a_patch_that_no_longer_applies_refuses_instead_of_forcing
