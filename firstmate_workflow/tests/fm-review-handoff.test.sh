#!/usr/bin/env bash
# The review brief fm-review-handoff.sh writes for a cold review session.
#
# That brief is the only place the reviewer is told how to report, and firstmate
# has no other way to learn what happened to a review. Two reports matter, for
# different reasons, and dropping either one is silent:
#
#   1. the verdict, as soon as the review exists - without it a finished review
#      is indistinguishable from a hung session;
#   2. the outcome after the captain's decisions are acted on and the comments
#      are actually posted - without it firstmate cannot announce the result to
#      whoever asked for the review (AGENTS.md section 7, "Announcing a finished
#      review"), because a posted review and one still awaiting the captain look
#      exactly the same from the outside.
#
# These drive the real script end to end and assert on the brief it produces,
# which is the script's output artifact rather than its source.
set -u

# shellcheck source=tests/lib.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fm_git_identity fmtest fmtest@example.invalid

HANDOFF="$ROOT/bin/fm-review-handoff.sh"
TMP_ROOT=$(fm_test_tmproot fm-review-handoff)

# One sandbox: a project clone with an origin, a task worktree holding no
# unlanded work (so teardown allows the swap), and the PR head published on the
# origin as refs/pull/<n>/head so the review worktree can be cut from it.
make_case() {  # <name> <pr-number> -> echoes case dir
  local name=$1 pr=$2 case_dir fakebin t
  case_dir="$TMP_ROOT/$name"
  fakebin="$case_dir/fakebin"
  mkdir -p "$case_dir/state" "$case_dir/data" "$fakebin"

  # The swap's side effects - returning the worktree, closing the window, PR
  # lookups - are not what these tests are about; stub them so the run is
  # hermetic and reaches the brief.
  for t in treehouse tmux gh gh-axi tasks-axi; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$fakebin/$t"
    chmod +x "$fakebin/$t"
  done

  git init -q --bare "$case_dir/origin.git"
  git -C "$case_dir/origin.git" symbolic-ref HEAD refs/heads/main
  git clone -q "$case_dir/origin.git" "$case_dir/_seed" 2>/dev/null
  git -C "$case_dir/_seed" commit -q --allow-empty -m "origin baseline"
  git -C "$case_dir/_seed" push -q origin main
  git -C "$case_dir/_seed" push -q origin "main:refs/pull/$pr/head"
  rm -rf "$case_dir/_seed"

  git clone -q "$case_dir/origin.git" "$case_dir/project"
  git -C "$case_dir/project" remote set-head origin main 2>/dev/null || true
  git -C "$case_dir/project" worktree add -q -b fm/task-x1 "$case_dir/wt" main
  touch "$case_dir/state/.last-watcher-beat"

  fm_write_meta "$case_dir/state/task-x1.meta" \
    "window=firstmate:fm-task-x1" \
    "endpoint_task_id=task-x1" \
    "worktree=$case_dir/wt" \
    "project=$case_dir/project" \
    "kind=ship" \
    "mode=direct-PR" \
    "pr=https://github.com/o/r/pull/$pr"

  printf '%s\n' "$case_dir"
}

run_handoff() {  # <case-dir> -> sets RC
  local case_dir=$1
  set +e
  PATH="$case_dir/fakebin:$PATH" FM_HOME="$case_dir" FM_ROOT_OVERRIDE="$ROOT" \
    "$HANDOFF" task-x1 >"$case_dir/handoff.out" 2>&1
  RC=$?
  set -e
}

RC=0

test_the_brief_requires_a_report_after_the_comments_are_posted() {
  local case_dir brief
  case_dir=$(make_case posted 77)
  run_handoff "$case_dir"
  expect_code 0 "$RC" "the handoff should complete"$'\n'"$(cat "$case_dir/handoff.out")"

  brief="$case_dir/data/pr-77-task-x1/brief.md"
  [ -f "$brief" ] || fail "no review brief was written at $brief"
  assert_contains "$(cat "$brief")" "Report a SECOND time" \
    "the brief must ask for a report after the captain's decisions are acted on"
  assert_contains "$(cat "$brief")" "done: POSTED" \
    "the brief must name the status line firstmate watches for"
  assert_contains "$(cat "$brief")" "approved with comments" \
    "the brief must name the outcome vocabulary the announcement uses"
  pass "fm-review-handoff: the brief requires a report once the comments are posted"
}

# Guard against the second report being added by REPLACING the first: a reviewer
# that only reports at the end looks hung for the whole review.
test_the_brief_still_requires_the_verdict_up_front() {
  local case_dir brief
  case_dir=$(make_case verdict 91)
  run_handoff "$case_dir"
  expect_code 0 "$RC" "the handoff should complete"$'\n'"$(cat "$case_dir/handoff.out")"

  brief="$case_dir/data/pr-91-task-x1/brief.md"
  [ -f "$brief" ] || fail "no review brief was written at $brief"
  assert_contains "$(cat "$brief")" "as soon as the review EXISTS" \
    "the brief must still require the verdict the moment the review exists"
  assert_contains "$(cat "$brief")" "needs-decision:" \
    "the brief must still offer the ask-instead-of-guess path"
  pass "fm-review-handoff: the up-front verdict report survives alongside the posted report"
}

test_the_brief_requires_a_report_after_the_comments_are_posted
test_the_brief_still_requires_the_verdict_up_front
