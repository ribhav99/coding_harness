#!/usr/bin/env bash
# Tear down a finished task: remove its worktree, kill the recorded runtime
# endpoint, clear volatile state, refresh/prune the project's clone for PR-based
# ship tasks, then print a backlog-refresh reminder.
# REFUSES if the worktree holds work that has not LANDED, because cleanup
# hard-resets/removes the worktree and kills its processes. Work has landed when it is
# reachable from any remote-tracking branch (a fork counts as a remote, so
# upstream-contribution PRs pushed to a fork satisfy this in any mode), OR - for a
# normal ship task whose commits are not so reachable - when its PR is merged and
# GitHub reports a PR head that contains the current local work, or its content is
# already present in the up-to-date default branch. This recognizes the common
# squash-merge-then-delete-branch flow, where the branch's own commits live nowhere
# on a remote yet the change is fully in main.
# The PR itself is resolved from the task's recorded pr= when present, or - when
# no pr= was ever recorded (e.g. a yolo-authorized merge on a repo with no PR CI,
# where the usual "checks green" fm-pr-check.sh trigger never fires) - by looking
# up a merged PR whose head branch matches the worktree's branch, fetching its head
# via refs/pull/<n>/head when the branch itself was deleted. So a missing pr= never
# by itself causes a false refusal of landed work.
# A gh lookup error falls back to the content check; if that is also inconclusive,
# teardown refuses rather than risk discarding unlanded work.
# Uncommitted changes are never landed.
# local-only projects additionally accept work merged into the local default
# branch (firstmate performs that merge after configured approval) as a fallback
# for the common case where there is no remote at all.
# Scout tasks (kind=scout in meta) carve out of that check: their worktree is
# declared scratch and the report at data/<task-id>/report.md is the work
# product. Teardown proceeds only once the report exists and the shared
# unresolved-decision completion gate verifies its captain-held inventory.
# Before destructive cleanup, teardown validates task check artifacts and any
# matching quarantine entries as ordinary single-link files on the state
# device. It refuses and preserves task state when that proof fails; otherwise
# it removes the task's check, trust record, PR sidecar, publication record, and
# quarantine entries with the rest of the volatile state.
# Usage: fm-teardown.sh <task-id> [--force]
#   --force skips ordinary-task dirty and landed-work checks and skips scout
#   report checks. Only use it when the captain has explicitly said to discard
#   the work.
#
# Transient / stale worktree git lock recovery (teardown-lock-race): a crew process
# killed mid-git-operation can leave a .git/worktrees/<wt>/index.lock (or, for a
# non-linked worktree, .git/index.lock) that makes the worktree removal fail
# with Unable to create '...index.lock': File exists. That lock is usually transient
# (the dying process finishes or exits within seconds) and must never be force-deleted
# while a live git process might still own it - the fix is patience, not rm.
#
# On that failure signature only, teardown_worktree_release:
#   1. Retries up to FM_TREEHOUSE_RETURN_LOCK_RETRIES times (default 3), waiting
#      FM_TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS (default 1s; falls back to the older
#      FM_STALE_WORKTREE_LOCK_RETRY_WAIT_SECS name when the new one is unset) between
#      attempts. Retries key off the error text, not whether the lock file still
#      exists after the failed attempt - a lock that self-clears mid-check still
#      deserves a retry of the removal.
#   2. Other removal failures still abort immediately and loudly (no retry).
#   3. If every retry still hits the lock signature and the lock remains, it is removed
#      and the removal tried once more ONLY when the lock is provably stale per
#      bin/fm-lock-lib.sh's fm_lock_is_provably_stale, passing the worktree dir as the
#      companion directory and FM_STALE_WORKTREE_LOCK_AGE_SECS (default 30s) as the age
#      threshold. That shared proof owns the exact lsof-holder, mtime-age, and fail-safe
#      rules.
#   4. If retries exhaust and the lock is not provably stale, teardown fails as loudly
#      as a normal removal failure and notes that the lock persisted across the retry
#      window. A missing `lsof`, or a lock that fails any stale check, is treated as
#      NOT provably stale (fail safe): the lock is left untouched.
# The same proof is used when non-force safety inspection cannot run because the lock
# is present; teardown clears only a provably stale lock, then re-runs the safety
# checks before any destructive removal. Teardown output notes every wait, retry, and
# removal so the operator can see what happened.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"
STATE="${FM_STATE_OVERRIDE:-$FM_HOME/state}"
DATA="${FM_DATA_OVERRIDE:-$FM_HOME/data}"
CONFIG="${FM_CONFIG_OVERRIDE:-$FM_HOME/config}"
# shellcheck source=bin/fm-tasks-axi-lib.sh
. "$SCRIPT_DIR/fm-tasks-axi-lib.sh"
# shellcheck source=bin/fm-backend.sh
. "$SCRIPT_DIR/fm-backend.sh"
# shellcheck source=bin/fm-lock-lib.sh
. "$SCRIPT_DIR/fm-lock-lib.sh"
# shellcheck source=bin/fm-gate-refuse-lib.sh
. "$SCRIPT_DIR/fm-gate-refuse-lib.sh"
# shellcheck source=bin/fm-pr-lib.sh
. "$SCRIPT_DIR/fm-pr-lib.sh"
# LOCAL FORK: the plain-git task worktree provider.
# shellcheck source=bin/fm-worktree.sh
. "$SCRIPT_DIR/fm-worktree.sh"
if [ "$#" -lt 1 ] || ! fm_task_id_path_safe "$1"; then
  echo "error: invalid teardown request" >&2
  exit 2
fi
ID=$1
FORCE=${2:-}
# Fail closed before any fleet mutation: a no-mistakes gate agent must never tear
# down a worktree (see bin/fm-gate-refuse-lib.sh).
fm_refuse_if_gate_agent
FM_LOCK_LOG_PREFIX=teardown

META="$STATE/$ID.meta"
[ -f "$META" ] || { echo "error: no meta for task $ID at $META" >&2; exit 1; }
# This is the first cleanup authorization check. It is metadata-only and must
# complete before fm-guard, a backend command, file removal, branch deletion,
# worktree return, registry change, or process termination can run.
fm_backend_validate_task_endpoint "$META" "$ID" || exit 1
BACKEND=$FM_BACKEND_VALIDATED_BACKEND
T=$FM_BACKEND_VALIDATED_TARGET
WT=$(fm_meta_get "$META" worktree)
PROJ=$(fm_meta_get "$META" project)
"$FM_ROOT/bin/fm-guard.sh" || true
PR_URL=$(grep '^pr=' "$META" | tail -1 | cut -d= -f2- || true)
# tasktmp is recorded by fm-spawn for tasks that set up a per-task temp root
# (/tmp/fm-<id>/); absent for tasks spawned before that change, so tolerate empty.
TASK_TMP=$(grep '^tasktmp=' "$META" | cut -d= -f2- || true)
BUSY_GEN=$(fm_meta_get "$META" busy_gen)
if [ -z "$BUSY_GEN" ]; then
  BUSY_GEN=$(cat "$STATE/$ID.busy-gen" 2>/dev/null || true)
fi
KIND=$(grep '^kind=' "$META" | cut -d= -f2- || true)
[ -n "$KIND" ] || KIND=ship
MODE=$(grep '^mode=' "$META" | cut -d= -f2- || true)
[ -n "$MODE" ] || MODE=no-mistakes
default_branch() {
  local ref branch
  ref=$(git -C "$PROJ" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
  if [ -n "$ref" ]; then
    echo "${ref#origin/}"
    return 0
  fi
  for branch in main master; do
    if git -C "$PROJ" show-ref --verify --quiet "refs/heads/$branch"; then
      echo "$branch"
      return 0
    fi
  done
  return 1
}

meta_value() {
  local meta=$1 key=$2
  fm_meta_get "$meta" "$key"
}

retire_busy_state() {
  local state_dir=$1 id=$2 gen=${3:-}
  if [ -n "$gen" ]; then
    "$SCRIPT_DIR/fm-busy-event.sh" retire "$state_dir" "$id" --gen "$gen"
  elif [ -f "$state_dir/$id.busy-gen" ]; then
    "$SCRIPT_DIR/fm-busy-event.sh" retire "$state_dir" "$id" --current-gen
  fi
}

validate_pr_poll_cleanup() {
  local state_dir=$1 id=$2 quarantine state_device artifact has_artifact=0
  fm_task_id_path_safe "$id" || return 0
  quarantine="$state_dir/.pr-check-quarantine"
  if [ "$id" = _noncanonical ] \
    && { [ -e "$quarantine/_noncanonical.diagnostic.pending-noncanonical" ] \
      || [ -L "$quarantine/_noncanonical.diagnostic.pending-noncanonical" ] \
      || [ -e "$quarantine/_noncanonical.diagnostic.noncanonical" ] \
      || [ -L "$quarantine/_noncanonical.diagnostic.noncanonical" ]; }; then
    echo "REFUSED: legacy PR-check quarantine migration is incomplete; preserving task state." >&2
    return 1
  fi
  for artifact in "$state_dir/$id.check.sh" "$state_dir/$id.pr-poll" \
    "$state_dir/$id.pr-poll-registration" "$state_dir/$id.pr-poll-retirement" \
    "$state_dir/$id.check-trust"; do
    [ -e "$artifact" ] || [ -L "$artifact" ] || continue
    has_artifact=1
  done
  if [ -e "$quarantine" ] || [ -L "$quarantine" ]; then
    has_artifact=1
  fi
  [ "$has_artifact" -eq 1 ] || return 0
  [ -d "$state_dir" ] && [ ! -L "$state_dir" ] || return 1
  state_device=$(fm_pr_file_device "$state_dir") || return 1
  for artifact in "$state_dir/$id.check.sh" "$state_dir/$id.pr-poll" \
    "$state_dir/$id.pr-poll-registration" "$state_dir/$id.pr-poll-retirement" \
    "$state_dir/$id.check-trust"; do
    [ -e "$artifact" ] || [ -L "$artifact" ] || continue
    if [ ! -f "$artifact" ] || [ -L "$artifact" ] \
      || [ "$(fm_pr_file_device "$artifact")" != "$state_device" ] \
      || [ "$(fm_pr_file_link_count "$artifact")" != 1 ]; then
      echo "REFUSED: unsafe task PR-check artifact; preserving task state." >&2
      return 1
    fi
  done
  if [ -e "$state_dir/$id.pr-poll-retirement" ] \
    || [ -L "$state_dir/$id.pr-poll-retirement" ]; then
    fm_pr_poll_retirement_state_valid "$state_dir" "$id" || {
      echo "REFUSED: invalid PR-poll retirement receipt; preserving task state." >&2
      return 1
    }
  fi
  [ -e "$quarantine" ] || [ -L "$quarantine" ] || return 0
  if [ ! -d "$state_dir" ] || [ -L "$state_dir" ] \
    || [ ! -d "$quarantine" ] || [ -L "$quarantine" ]; then
    echo "REFUSED: unsafe PR-check quarantine path $quarantine; preserving task state." >&2
    return 1
  fi
  if [ "$(fm_pr_file_device "$quarantine")" != "$state_device" ] \
    || [ "$(fm_pr_file_mode "$quarantine")" != 700 ]; then
    echo "REFUSED: PR-check quarantine is not on the task state device; preserving task state." >&2
    return 1
  fi
  for artifact in "$quarantine/$id."*; do
    [ -e "$artifact" ] || [ -L "$artifact" ] || continue
    if ! fm_pr_private_file_valid "$artifact" 600 "$state_device"; then
      echo "REFUSED: unsafe task quarantine entry; preserving task state." >&2
      return 1
    fi
  done
}

remove_pr_poll_artifacts() {
  local state_dir=$1 id=$2 quarantine artifact
  validate_pr_poll_cleanup "$state_dir" "$id" || return 1
  fm_pr_poll_retirement_recover_one "$state_dir" "$id" "$SCRIPT_DIR/fm-pr-poll.sh" || return 1
  rm -f "$state_dir/$id.check.sh" "$state_dir/$id.pr-poll" \
    "$state_dir/$id.pr-poll-registration" "$state_dir/$id.pr-poll-retirement" \
    "$state_dir/$id.check-trust" || return 1
  if fm_task_id_path_safe "$id"; then
    quarantine="$state_dir/.pr-check-quarantine"
    if [ -d "$quarantine" ] && [ ! -L "$quarantine" ]; then
      for artifact in "$quarantine/$id."*; do
        [ -e "$artifact" ] || [ -L "$artifact" ] || continue
        rm -f -- "$artifact" || return 1
      done
      rmdir "$quarantine" 2>/dev/null || true
    fi
  fi
}

# Resolve the PR number for a worktree branch. Echoes the number on a
# single match and returns 0; returns non-zero on no match or any lookup failure,
# so the caller treats it as "no PR found" (fail-safe).
#
# LOCAL FORK: upstream ran `gh-axi pr list` here and parsed the leading field of
# a COMMA-delimited TOON row. Plain gh emits a TAB-delimited table, so swapping
# the binary alone would leave the old sed matching nothing -- and because this
# function is fail-safe by design, that failure is SILENT: teardown would decide
# there is no PR and then refuse to tear down work that had in fact landed. So
# the swap also moves to `--json number --jq`, which gh resolves with its own
# embedded jq (no external jq dependency) and which emits the bare number.
pr_number_from_branch() {
  local branch=$1 out n
  [ -n "$branch" ] && [ "$branch" != HEAD ] || return 1
  out=$( cd "$WT" && gh pr list --state all --head "$branch" --limit 1 --json number --jq '.[0].number' 2>/dev/null ) || return 1
  n=$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
  [ -n "$n" ] || return 1
  printf '%s' "$n"
}

pr_number_from_target() {
  local target=$1 n
  case "$target" in
    '' ) return 1 ;;
    *"/pull/"*)
      n=${target##*/pull/}
      n=${n%%[!0-9]*}
      ;;
    [0-9]*)
      n=${target%%[!0-9]*}
      ;;
    *) return 1 ;;
  esac
  [ -n "$n" ] || return 1
  printf '%s' "$n"
}

ensure_commit_object() {
  local target=$1 commit=$2 n
  git -C "$WT" cat-file -e "$commit^{commit}" 2>/dev/null && return 0
  n=$(pr_number_from_target "$target") || return 1
  git -C "$WT" remote get-url origin >/dev/null 2>&1 || return 1
  git -C "$WT" fetch --quiet origin "refs/pull/$n/head" >/dev/null 2>&1 || return 1
  git -C "$WT" cat-file -e "$commit^{commit}" 2>/dev/null
}

patch_id_for_commit() {
  local commit=$1
  git -C "$WT" show --pretty=medium --no-ext-diff "$commit" 2>/dev/null \
    | git patch-id --stable 2>/dev/null \
    | awk 'NR == 1 { print $1 }'
}

unpushed_patches_are_in_pr_head() {
  local pr_head=$1 current base pr_patch_ids commit patch_id unpushed
  current=$(git -C "$WT" rev-parse --verify HEAD 2>/dev/null) || return 1
  base=$(git -C "$WT" merge-base "$current" "$pr_head" 2>/dev/null) || return 1
  pr_patch_ids=$(
    git -C "$WT" log --format=%H "$base..$pr_head" -- 2>/dev/null \
      | while IFS= read -r commit; do
          patch_id_for_commit "$commit"
        done \
      | sed '/^$/d' \
      | sort -u
  ) || return 1
  [ -n "$pr_patch_ids" ] || return 1
  unpushed=$(git -C "$WT" log --format=%H HEAD --not --remotes -- 2>/dev/null) || return 1
  [ -n "$unpushed" ] || return 1
  while IFS= read -r commit; do
    [ -n "$commit" ] || continue
    patch_id=$(patch_id_for_commit "$commit") || return 1
    [ -n "$patch_id" ] || return 1
    printf '%s\n' "$pr_patch_ids" | grep -qxF "$patch_id" || return 1
  done <<EOF
$unpushed
EOF
}

# Is the worktree's PR merged for local work contained in that PR? Resolves the
# PR from the recorded pr= URL first, then from the branch name, and asks GitHub
# for both the PR state and head. Returns non-zero when the PR is not merged, the
# current work is not contained in the PR head, no PR is found, or any gh error
# occurs - the caller then falls back to the content check.
pr_is_merged() {
  local branch=$1 target view state head current
  if [ -n "$PR_URL" ]; then
    target=$PR_URL
  else
    target=$(pr_number_from_branch "$branch") || return 1
  fi
  [ -n "$target" ] || return 1
  view=$(cd "$WT" && gh pr view "$target" --json state,headRefOid -q '.state + "\t" + .headRefOid' 2>/dev/null) || return 1
  state=${view%%$'\t'*}
  head=${view#*$'\t'}
  [ "$state" != "$view" ] || return 1
  case "$state" in
    MERGED|merged) ;;
    *) return 1 ;;
  esac
  [ -n "$head" ] || return 1
  ensure_commit_object "$target" "$head" || return 1
  current=$(git -C "$WT" rev-parse --verify HEAD 2>/dev/null) || return 1
  git -C "$WT" merge-base --is-ancestor "$current" "$head" 2>/dev/null && return 0
  unpushed_patches_are_in_pr_head "$head"
}

# Is the branch's content already present in the up-to-date default branch? Fetches
# first, then 3-way merges the default branch with HEAD: when HEAD introduces nothing
# the default branch does not already contain (e.g. its change landed via squash) the
# merged tree equals the default branch's tree. This isolates branch-only changes, so
# unrelated commits the default branch gained past the merge-base do not count as
# "added". Returns non-zero when inconclusive (no default ref, or a merge conflict),
# so the caller refuses rather than guesses.
content_in_default() {
  local name ref default_tree merged_tree
  name=$(default_branch) || return 1
  if git -C "$WT" remote get-url origin >/dev/null 2>&1; then
    git -C "$WT" fetch --quiet origin "+refs/heads/$name:refs/remotes/origin/$name" >/dev/null 2>&1 || return 1
    ref="refs/remotes/origin/$name"
  elif git -C "$WT" rev-parse --quiet --verify "refs/heads/$name" >/dev/null 2>&1; then
    ref="refs/heads/$name"
  else
    return 1
  fi
  default_tree=$(git -C "$WT" rev-parse --quiet --verify "$ref^{tree}" 2>/dev/null) || return 1
  [ -n "$default_tree" ] || return 1
  merged_tree=$(git -C "$WT" merge-tree --write-tree "$ref" HEAD 2>/dev/null) || return 1
  merged_tree=$(printf '%s\n' "$merged_tree" | head -1)
  [ "$merged_tree" = "$default_tree" ]
}

# Has the worktree's committed work actually LANDED, though its commits are not
# reachable from any remote-tracking branch? True when a merged PR proves the
# current local work is contained in the PR head, OR the content is already in the
# default branch (fallback, which also covers the no-PR and gh-error paths). False
# only for genuinely unlanded work.
work_is_landed() {
  local branch=$1
  pr_is_merged "$branch" && return 0
  content_in_default
}

backlog_refresh_reminder() {
  local pr done_cmd report_path
  if fm_tasks_axi_backend_available "$CONFIG"; then
    case "$KIND" in
      scout)
        report_path="data/$ID/report.md"
        done_cmd="tasks-axi done $ID --report $report_path"
        ;;
      *)
        if [ "$MODE" = local-only ]; then
          done_cmd="tasks-axi done $ID --note \"local main\""
        else
          pr=$PR_URL
          if [ -n "$pr" ]; then
            done_cmd="tasks-axi done $ID --pr $pr"
          else
            done_cmd="tasks-axi done $ID --pr PR_URL"
          fi
        fi
        ;;
    esac
    printf '%s\n' "Backlog: $ID just finished. Run $done_cmd, then run tasks-axi ready for dependency-cleared candidates, check date gates, and dispatch only work whose blockers are gone and date is due."
  else
    printf '%s\n' "Backlog: $ID just finished. Update data/backlog.md - move $ID to Done, keep Done to the 10 most recent, then re-scan Queued and dispatch only work whose blockers are gone and date is due."
  fi
}

inspectable_git_worktree() {
  local target=$1 top
  [ -n "$target" ] || return 1
  [ -d "$target" ] || return 1
  top=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$top" ] || return 1
  [ -d "$top" ] || return 1
  git -C "$top" rev-parse --git-dir >/dev/null 2>&1
}

canonical_existing_dir() {
  local target=$1
  [ -n "$target" ] || return 1
  [ -d "$target" ] || return 1
  ( cd "$target" && pwd -P )
}

retry_wait_secs_is_valid() {
  [[ "$1" =~ ^([0-9]+([.][0-9]*)?|[.][0-9]+)$ ]]
}

STALE_WORKTREE_LOCK_AGE_SECS=${FM_STALE_WORKTREE_LOCK_AGE_SECS:-30}
# Bounded patience window for transient index.lock after killing a crew process.
# New knobs are preferred; FM_STALE_WORKTREE_LOCK_RETRY_WAIT_SECS remains an alias
# for the per-attempt wait so existing tests and operators keep working.
TREEHOUSE_RETURN_LOCK_RETRIES=${FM_TREEHOUSE_RETURN_LOCK_RETRIES:-3}
TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS=${FM_TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS:-${FM_STALE_WORKTREE_LOCK_RETRY_WAIT_SECS:-1}}
if ! retry_wait_secs_is_valid "$TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS"; then
  echo "teardown: invalid treehouse return lock retry wait '$TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS'; using 1s" >&2
  TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS=1
fi
# Compatibility alias used by the safety-check wait path and older call sites.
STALE_WORKTREE_LOCK_RETRY_WAIT_SECS=$TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS
TEARDOWN_TREEHOUSE_LOCK_REFUSED=2
TEARDOWN_WORKTREE_SAFETY_LOCK_BLOCKED=3

# True when git stderr shows the transient index.lock "File exists" race.
# Other return failures must not enter the retry path.
treehouse_return_is_index_lock_error() {
  local text=$1
  printf '%s\n' "$text" | grep -Eq "Unable to create ['\"].*index\\.lock['\"]: File exists"
}

# Absolute path to the git index lock for a worktree/repo dir, or empty when it
# cannot be resolved (dir missing or not a git worktree at all).
worktree_git_lock_path() {
  local dir=$1 lock abs_dir
  [ -n "$dir" ] && [ -d "$dir" ] || return 1
  lock=$(git -C "$dir" rev-parse --git-path index.lock 2>/dev/null) || return 1
  [ -n "$lock" ] || return 1
  case "$lock" in
    /*) printf '%s\n' "$lock" ;;
    *)
      abs_dir=$(canonical_existing_dir "$dir") || return 1
      printf '%s/%s\n' "$abs_dir" "$lock"
      ;;
  esac
}

# The lock-staleness proof (lsof holder check, mtime age, fail-safe defaults)
# is owned by bin/fm-lock-lib.sh's fm_lock_is_provably_stale, sourced above.
# Teardown passes the worktree dir as the companion directory and its own
# STALE_WORKTREE_LOCK_AGE_SECS threshold.

worktree_safety_blocked_by_lock() {
  local reason=$1 lock
  lock=$(worktree_git_lock_path "$WT") || lock=""
  [ -n "$lock" ] && [ -e "$lock" ] || return 1
  echo "teardown: cannot inspect worktree $WT for $reason while git lock $lock is present; checking whether the lock is stale" >&2
  return 0
}

cleanup_stale_lock_for_safety_check() {
  local dir=$1 lock
  lock=$(worktree_git_lock_path "$dir") || lock=""
  [ -n "$lock" ] && [ -e "$lock" ] || return 0

  echo "teardown: worktree safety check blocked by git lock $lock; waiting ${STALE_WORKTREE_LOCK_RETRY_WAIT_SECS}s and retrying (owning process may be exiting)" >&2
  sleep "$STALE_WORKTREE_LOCK_RETRY_WAIT_SECS"

  if [ ! -e "$lock" ]; then
    echo "teardown: worktree safety check lock cleared on its own; retrying safety checks" >&2
    return 0
  fi

  if fm_lock_is_provably_stale "$lock" "$dir" "$STALE_WORKTREE_LOCK_AGE_SECS"; then
    rm -f "$lock"
    echo "teardown: removed provably-stale git lock $lock (age >= ${STALE_WORKTREE_LOCK_AGE_SECS}s, no live holder) and retrying worktree safety checks" >&2
    return 0
  fi

  echo "teardown: worktree safety check blocked by git lock $lock that is not provably stale (may belong to a live process); leaving it in place" >&2
  return "$TEARDOWN_TREEHOUSE_LOCK_REFUSED"
}

# Release a task worktree, tolerating a transient or stale git index.lock left by
# a killed crew process. See the script header.
#
# LOCAL FORK: upstream ran `treehouse return --force`, which put the worktree
# back into a pool. This fork has no pool, so release means DELETE, via
# fm_worktree_remove (bin/fm-worktree.sh). The retry machinery below is unchanged
# and still correct: treehouse_return_is_index_lock_error matches GIT's own
# "Unable to create '...index.lock': File exists" text, which the old provider merely
# surfaced, and `git worktree remove` fails with exactly the same message.
#
# The name is kept so the three call sites and the tests stay recognisable
# against upstream.
teardown_worktree_release() {
  local dir=$1 cd_dir=$2 label=$3 post_cleanup_check=${4:-}
  local out lock attempt=0 max_retries lock_desc

  # Capture stdout+stderr so non-lock failures stay visible and lock failures can
  # be matched by signature even when the lock file is already gone mid-check.
  if out=$( fm_worktree_remove "$dir" "$cd_dir" 2>&1 ); then
    [ -n "$out" ] && printf '%s\n' "$out"
    return 0
  fi
  [ -n "$out" ] && printf '%s\n' "$out" >&2

  if ! treehouse_return_is_index_lock_error "$out"; then
    return 1
  fi

  lock=$(worktree_git_lock_path "$dir") || lock=""
  if [ -n "$lock" ]; then
    lock_desc=$lock
  else
    lock_desc="index.lock"
  fi

  max_retries=$TREEHOUSE_RETURN_LOCK_RETRIES
  case "$max_retries" in ''|*[!0-9]*) max_retries=3 ;; esac

  while [ "$attempt" -lt "$max_retries" ]; do
    attempt=$(( attempt + 1 ))
    echo "teardown: $label return failed with transient git lock ($lock_desc); waiting ${TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS}s and retrying ($attempt/${max_retries})" >&2
    sleep "$TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS"

    if out=$( fm_worktree_remove "$dir" "$cd_dir" 2>&1 ); then
      [ -n "$out" ] && printf '%s\n' "$out"
      echo "teardown: $label return succeeded on retry; lock cleared on its own" >&2
      return 0
    fi
    [ -n "$out" ] && printf '%s\n' "$out" >&2

    if ! treehouse_return_is_index_lock_error "$out"; then
      echo "teardown: $label return failed with a non-lock error after retry; aborting" >&2
      return 1
    fi
  done

  # Refresh lock path after the patience window; it may have appeared, moved, or
  # cleared while we waited.
  lock=$(worktree_git_lock_path "$dir") || lock=""
  if [ -n "$lock" ] && [ -e "$lock" ]; then
    lock_desc=$lock
    if fm_lock_is_provably_stale "$lock" "$dir" "$STALE_WORKTREE_LOCK_AGE_SECS"; then
      rm -f "$lock"
      echo "teardown: removed provably-stale git lock $lock (age >= ${STALE_WORKTREE_LOCK_AGE_SECS}s, no live holder) and retrying $label return" >&2
      if [ -n "$post_cleanup_check" ]; then
        if ! "$post_cleanup_check"; then
          echo "teardown: $label return aborted after stale-lock cleanup because safety checks failed" >&2
          return 1
        fi
      fi
      if out=$( fm_worktree_remove "$dir" "$cd_dir" 2>&1 ); then
        [ -n "$out" ] && printf '%s\n' "$out"
        echo "teardown: $label return succeeded after stale-lock cleanup" >&2
        return 0
      fi
      [ -n "$out" ] && printf '%s\n' "$out" >&2
      echo "teardown: $label return still failing after stale-lock cleanup" >&2
      return 1
    fi

    echo "teardown: $label return failed: git lock $lock_desc persisted across ${max_retries} retries (waiting ${TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS}s each) and is not provably stale (may belong to a live process); leaving it in place" >&2
    return "$TEARDOWN_TREEHOUSE_LOCK_REFUSED"
  fi

  echo "teardown: $label return failed: git index.lock signature persisted across ${max_retries} retries (waiting ${TREEHOUSE_RETURN_LOCK_RETRY_WAIT_SECS}s each) even after the lock file disappeared" >&2
  return 1
}

validate_worktree_teardown_safety() {
  local dirty_raw dirty unpushed_raw unpushed DEFAULT unmerged_raw unmerged branch
  [ -d "$WT" ] || return 0
  [ "$FORCE" != "--force" ] || return 0
  [ "$KIND" != scout ] || return 0

  if ! dirty_raw=$(git -C "$WT" status --porcelain 2>/dev/null); then
    if worktree_safety_blocked_by_lock "uncommitted changes"; then
      return "$TEARDOWN_WORKTREE_SAFETY_LOCK_BLOCKED"
    fi
    echo "REFUSED: cannot inspect worktree $WT for uncommitted changes." >&2
    echo "Restore the git index state, or get the captain's explicit OK to discard, then --force." >&2
    return 1
  fi
  dirty=$(printf '%s\n' "$dirty_raw" | grep -vE '^\?\? \.claude/' | head -1 || true)

  if ! unpushed_raw=$(git -C "$WT" log --oneline HEAD --not --remotes -- 2>/dev/null); then
    if worktree_safety_blocked_by_lock "commits not on a remote"; then
      return "$TEARDOWN_WORKTREE_SAFETY_LOCK_BLOCKED"
    fi
    echo "REFUSED: cannot inspect worktree $WT for commits not on a remote." >&2
    echo "Restore the git index state, or get the captain's explicit OK to discard, then --force." >&2
    return 1
  fi
  unpushed=$(printf '%s\n' "$unpushed_raw" | head -5)

  if [ -n "$unpushed" ] && [ "$MODE" = local-only ]; then
    DEFAULT=$(default_branch) || { echo "REFUSED: cannot determine default branch for $PROJ; expected origin/HEAD, main, or master." >&2; return 1; }
    if ! unmerged_raw=$(git -C "$WT" log --oneline HEAD --not "$DEFAULT" -- 2>/dev/null); then
      if worktree_safety_blocked_by_lock "commits not on $DEFAULT"; then
        return "$TEARDOWN_WORKTREE_SAFETY_LOCK_BLOCKED"
      fi
      echo "REFUSED: cannot inspect worktree $WT for commits not on $DEFAULT." >&2
      echo "Restore the git index state, or get the captain's explicit OK to discard, then --force." >&2
      return 1
    fi
    unmerged=$(printf '%s\n' "$unmerged_raw" | head -5)
    if [ -n "$dirty" ] || [ -n "$unmerged" ]; then
      echo "REFUSED: local-only worktree $WT has work not yet merged into $DEFAULT and not on any remote." >&2
      [ -n "$dirty" ] && echo "uncommitted changes present" >&2
      [ -n "$unmerged" ] && printf 'commits not yet on %s:\n%s\n' "$DEFAULT" "$unmerged" >&2
      echo "Merge the branch into local $DEFAULT first (bin/fm-merge-local.sh after the captain approves), or push to a fork/remote, or get the captain's explicit OK to discard, then --force." >&2
      return 1
    fi
  elif [ -n "$dirty" ]; then
    echo "REFUSED: worktree $WT has uncommitted changes." >&2
    echo "uncommitted changes present" >&2
    echo "Commit them (or get the captain's explicit OK to discard, then --force)." >&2
    return 1
  elif [ -n "$unpushed" ]; then
    branch=${TEARDOWN_WORKTREE_BRANCH_FOR_SAFETY:-}
    if [ -z "$branch" ]; then
      branch=$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)
      TEARDOWN_WORKTREE_BRANCH_FOR_SAFETY=$branch
    fi
    if ! work_is_landed "$branch"; then
      echo "REFUSED: worktree $WT has work not on any remote and not landed." >&2
      printf 'unpushed commits:\n%s\n' "$unpushed" >&2
      echo "Push the branch, land its PR, or get the captain's explicit OK to discard, then --force." >&2
      return 1
    fi
  fi
}

validate_pr_poll_cleanup "$STATE" "$ID" || exit 1

if [ "$KIND" = scout ] && [ "$FORCE" != "--force" ]; then
  REPORT="$DATA/$ID/report.md"
  if [ ! -f "$REPORT" ]; then
    echo "REFUSED: scout task $ID has no report at $REPORT." >&2
    echo "The report is the work product. Have the crewmate write it, or use --force after explicit discard approval." >&2
    exit 1
  fi
  if ! FM_HOME="$FM_HOME" FM_STATE_OVERRIDE="$STATE" FM_DATA_OVERRIDE="$DATA" \
      FM_CONFIG_OVERRIDE="$CONFIG" "$SCRIPT_DIR/fm-decision-hold.sh" verify "$ID" >/dev/null; then
    echo "REFUSED: scout task $ID has not passed the unresolved-decision completion gate." >&2
    echo "Inventory its report and any visual review through bin/fm-decision-hold.sh before teardown." >&2
    exit 1
  fi
fi

if [ -d "$WT" ] && [ "$FORCE" != "--force" ]; then
  if validate_worktree_teardown_safety; then
    :
  else
    safety_rc=$?
    if [ "$safety_rc" -eq "$TEARDOWN_WORKTREE_SAFETY_LOCK_BLOCKED" ]; then
      cleanup_stale_lock_for_safety_check "$WT" || exit 1
      validate_worktree_teardown_safety || exit 1
    else
      exit 1
    fi
  fi
fi

# Best-effort: drop the local task branch so the shared repo does not accumulate refs.
if [ -d "$WT" ]; then
  branch=$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)
  if [ "$branch" != "HEAD" ]; then
    if git -C "$WT" checkout --detach -q 2>/dev/null; then
      git -C "$WT" branch -D "$branch" >/dev/null 2>&1 || true
    fi
  fi
  # Remove our hook file so nothing can fire signals for a dead task.
  rm -f "$WT/.claude/settings.local.json"
  # Kills remaining processes in the worktree (including the agent) and removes it.
  # teardown_worktree_release tolerates transient and stale git locks left by a
  # killed crew process; see the script header for retry and stale-lock proof.
  post_lock_cleanup_check=
  if [ "$FORCE" != "--force" ] && [ "$KIND" != scout ]; then
    post_lock_cleanup_check=validate_worktree_teardown_safety
  fi
  teardown_worktree_release "$WT" "$PROJ" "worktree" "$post_lock_cleanup_check" || {
    echo "error: worktree release failed for $WT; teardown aborted" >&2
    exit 1
  }
fi

fm_backend_kill "$BACKEND" "$T" "" "fm-$ID" 2>/dev/null || true
# Remove the per-task temp root (/tmp/fm-<id>/, incl. its gotmp/) recorded by spawn.
# Read before the state-file rm below; empty (pre-fix tasks without tasktmp=) is a no-op.
[ -n "$TASK_TMP" ] && rm -rf "$TASK_TMP"
remove_pr_poll_artifacts "$STATE" "$ID" || exit 1
retire_busy_state "$STATE" "$ID" "$BUSY_GEN" || exit 1
rm -f "$STATE/$ID.status" "$STATE/$ID.turn-ended" "$STATE/$ID.meta"
# LOCAL FORK: a ship brief is a short pointer at the issue or work order it
# implements, so it holds nothing once the PR has landed and is reconstructible
# from that work item. Drop it rather than accumulate one directory per task
# forever. Scout records are deliverables and are kept: data/<id>/report.md is
# the entire point of a scout task. This line is reached
# only after every landed-work and endpoint check above has passed.
if [ "$KIND" = ship ] && [ -n "$DATA" ] && [ -n "$ID" ] && [ -d "$DATA/$ID" ]; then
  rm -rf -- "${DATA:?}/${ID:?}"
fi
if [ "$KIND" != scout ] && [ "$MODE" != local-only ]; then
  "$FM_ROOT/bin/fm-fleet-sync.sh" "$PROJ" || true
fi
echo "teardown $ID complete (window $T, worktree $WT)"
backlog_refresh_reminder
