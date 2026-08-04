#!/usr/bin/env bash
# Swap a finished implementation session for a cold review session, as ONE
# operation: close the implementation task and stand its PR review up in a fresh
# worktree with a fresh agent.
#
# Usage: fm-review-handoff.sh <implementation-task-id>
#
# Why one script rather than two commands: the session that wrote the code is the
# worst reviewer of it - it is anchored on its own choices - so the review has to
# happen in a session that never saw them. But teardown-then-spawn as two steps
# can half-happen, and a half-done swap leaves the work with NO session at all
# and nothing recorded that says a review is owed. This runs both, in order, and
# refuses before touching anything if the second half cannot succeed.
#
# Order and safety:
#   1. Read the implementation task's recorded pr= and project.
#   2. Resolve the review worktree path and REFUSE if it already exists as
#      anything other than this task's own completed handoff.
#   3. Tear the implementation task down through bin/fm-teardown.sh, which owns
#      the complete uncommitted/unlanded-work test. A teardown refusal stops the
#      handoff with nothing changed - it is never bypassed and --force is never
#      passed. That refusal is the whole point: unlanded work must not be
#      discarded to make room for a review.
#   4. Create the review worktree at the PR head and spawn a review session in
#      it, briefed to run the full-review skill against that PR.
#
# Idempotent on retry. Step 3 is a no-op once the implementation task's metadata
# is gone, and step 4 is a no-op once the review task's metadata exists, so
# re-running after a partial failure completes the swap rather than duplicating
# it or refusing outright.
#
# Naming: the review worktree follows the TARGET PROJECT's own stated worktree
# convention where it states one - for a project whose memory states
# `<repo>-wo-<n>-<slug>`, a review worktree is `<repo>-pr-<n>-<slug>` - and
# firstmate's own scheme where it does not. bin/fm-naming-lib.sh owns that
# decision; this script only supplies the review task id, pr-<n>-<slug>, whose
# slug is the implementation task id with any leading wo-<n>- stripped.
#
# Records the review session in this home's state exactly like any other task
# (state/<review-id>.meta via fm-spawn), so ordinary supervision sees it.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"
STATE="${FM_STATE_OVERRIDE:-$FM_HOME/state}"
DATA="${FM_DATA_OVERRIDE:-$FM_HOME/data}"

# shellcheck source=bin/fm-backend.sh
. "$SCRIPT_DIR/fm-backend.sh"
# shellcheck source=bin/fm-tangle-lib.sh
. "$SCRIPT_DIR/fm-tangle-lib.sh"
# shellcheck source=bin/fm-naming-lib.sh
. "$SCRIPT_DIR/fm-naming-lib.sh"
# shellcheck source=bin/fm-worktree.sh
. "$SCRIPT_DIR/fm-worktree.sh"
# shellcheck source=bin/fm-gate-refuse-lib.sh
. "$SCRIPT_DIR/fm-gate-refuse-lib.sh"
fm_refuse_if_gate_agent

usage() {
  sed -n '2,${/^#/!q;p;}' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  ''|-h|--help) usage; [ -n "${1:-}" ] || exit 2; exit 0 ;;
esac

ID=$1
case "$ID" in
  ''|*[!A-Za-z0-9._-]*) echo "error: invalid task id '$ID'" >&2; exit 2 ;;
esac

META="$STATE/$ID.meta"
REVIEW_STATE="$STATE/.review-handoff-$ID"

# The review task id, and through it the review worktree name: pr-<n>-<slug>.
# The slug reuses the implementation task's own, so a review worktree sits next
# to the work it reviews and reads as the same piece of work a week later.
review_id_for() {  # <pr-number> <impl-task-id>
  local number=$1 slug=$2
  case "$slug" in
    wo-[0-9]*) slug=${slug#wo-}; slug=${slug#*-} ;;
  esac
  case "$slug" in
    ''|[0-9]*) printf 'pr-%s' "$number"; return 0 ;;
  esac
  printf 'pr-%s-%s' "$number" "$slug"
}

pr_number_of() {  # <pr-url>
  local url=${1%/}
  url=${url##*/}
  case "$url" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s' "$url"
}

# Everything the second half needs, resolved up front and cached, because after
# teardown the implementation metadata is gone. The cache is what makes a retry
# after a partial failure finish the swap instead of refusing for lack of inputs.
if [ -f "$REVIEW_STATE" ]; then
  # shellcheck disable=SC1090
  . "$REVIEW_STATE"
else
  [ -f "$META" ] || {
    echo "error: no metadata for task $ID at $META; nothing to hand off" >&2
    exit 1
  }
  PR_URL=$(fm_meta_get "$META" pr)
  [ -n "$PR_URL" ] || {
    echo "error: task $ID has no recorded pr=; run bin/fm-pr-check.sh <id> <PR url> first so the review has a PR to read" >&2
    exit 1
  }
  PR_NUMBER=$(pr_number_of "$PR_URL") || {
    echo "error: recorded pr= for $ID is not a PR URL ending in a number: $PR_URL" >&2
    exit 1
  }
  PROJECT=$(fm_meta_get "$META" project)
  [ -d "$PROJECT" ] || {
    echo "error: task $ID records project '$PROJECT', which is not a directory" >&2
    exit 1
  }
  REVIEW_ID=$(review_id_for "$PR_NUMBER" "$ID")
  [ ! -e "$STATE/$REVIEW_ID.meta" ] || {
    echo "error: a review session for PR $PR_NUMBER already exists as task $REVIEW_ID; tear that down first" >&2
    exit 1
  }
  REVIEW_WT=$(fm_worktree_path "$PROJECT" "$REVIEW_ID") || exit 1
  [ ! -e "$REVIEW_WT" ] || {
    echo "error: review worktree path already exists: $REVIEW_WT" >&2
    echo "       remove it (or finish the review already in it) before handing off $ID" >&2
    exit 1
  }
  mkdir -p "$STATE"
  {
    printf 'PR_URL=%s\n' "$PR_URL"
    printf 'PR_NUMBER=%s\n' "$PR_NUMBER"
    printf 'PROJECT=%s\n' "$PROJECT"
    printf 'REVIEW_ID=%s\n' "$REVIEW_ID"
    printf 'REVIEW_WT=%s\n' "$REVIEW_WT"
  } > "$REVIEW_STATE"
fi

# --- half one: close the implementation session ----------------------------
# fm-teardown owns the complete landed-work test. Never --force: a refusal here
# means the implementation worktree still holds work that has not landed, and
# discarding it to free the slot for a review is exactly the mistake teardown
# exists to prevent. Already-gone metadata is the retry path, not an error.
if [ -f "$META" ]; then
  if ! "$SCRIPT_DIR/fm-teardown.sh" "$ID"; then
    echo "error: cleanup of implementation task $ID refused; the review handoff changed nothing" >&2
    echo "       resolve what teardown reported, then rerun this command" >&2
    exit 1
  fi
fi

# --- half two: stand the review session up ---------------------------------
if [ -e "$STATE/$REVIEW_ID.meta" ]; then
  echo "review-handoff $ID complete (review session $REVIEW_ID already running)"
  rm -f "$REVIEW_STATE"
  exit 0
fi

BRIEF_DIR="$DATA/$REVIEW_ID"
BRIEF="$BRIEF_DIR/brief.md"
if [ ! -f "$BRIEF" ]; then
  mkdir -p "$BRIEF_DIR"
  cat > "$BRIEF" <<EOF
You are an autonomous worker managed by firstmate. Work on your own; do not wait for a human.

Review pull request $PR_URL.
You did not write this code and have not seen it before. That is the point: read it cold.

Run the \`full-review\` skill against that PR and follow it to completion.

You are in an isolated git worktree checked out at the PR's head. Do not push to
the PR's branch and do not merge it.

Write your review outcome to \`$DATA/$REVIEW_ID/report.md\`: the verdict, every
finding you are confident in, and the evidence for each. That report is the
deliverable that survives this session.

Report by appending one line to $STATE/$REVIEW_ID.status:
   \`echo "done: {your review verdict in one line}" >> $STATE/$REVIEW_ID.status\` when the review is delivered - this is how firstmate learns you finished.
   \`echo "needs-decision: {the options}" >> $STATE/$REVIEW_ID.status\` if something is genuinely ambiguous or is not yours to decide - then STOP and wait for the answer rather than guessing.
EOF
fi

# The review worktree starts at the PR head, not the default branch, so the
# reviewer reads the code as proposed. A fetch is required: the branch may exist
# only on the forge. fm-spawn creates the worktree itself, at the ref this
# override names, so the isolation assertion and abort cleanup stay one owner.
if ! git -C "$PROJECT" fetch --quiet origin "+refs/pull/$PR_NUMBER/head:refs/fm-review/$REVIEW_ID" 2>/dev/null; then
  echo "error: could not fetch PR $PR_NUMBER's head into $PROJECT; the review worktree was not created" >&2
  exit 1
fi

if ! FM_WORKTREE_BASE_REF="refs/fm-review/$REVIEW_ID" \
    "$SCRIPT_DIR/fm-spawn.sh" "$REVIEW_ID" "$PROJECT" --scout; then
  echo "error: the review session for PR $PR_NUMBER could not be launched" >&2
  echo "       rerun this command to retry the launch; the implementation task is already closed" >&2
  git -C "$PROJECT" update-ref -d "refs/fm-review/$REVIEW_ID" 2>/dev/null || true
  exit 1
fi

rm -f "$REVIEW_STATE"
echo "review-handoff $ID complete (review session $REVIEW_ID reviewing $PR_URL in $REVIEW_WT)"
