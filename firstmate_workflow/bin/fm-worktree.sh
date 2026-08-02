#!/usr/bin/env bash
# shellcheck shell=bash
# bin/fm-worktree.sh - the task worktree provider.
#
# LOCAL FORK. Upstream firstmate delegates task worktrees to treehouse, which
# maintains a POOL of reusable worktrees: `treehouse get` leases an idle one,
# resets it to the default branch, and hands it back warm with dependencies and
# build caches intact; `treehouse return` puts it back in the pool.
#
# This fork does not use treehouse. Worktrees here are created and destroyed per
# task with plain git, as siblings of the project checkout:
#
#     /path/to/fitness_agent            <- the project
#     /path/to/fitness_agent-fm-a3k9    <- task a3k9's worktree
#
# matching the hand-rolled convention already in use (fitness_agent-marketing).
#
# What this deliberately gives up, and why that is fine here:
#   - No pool, so every worktree starts COLD. No venv, no node_modules, no build
#     cache. Accepted: the projects driven from this home have few tracked files,
#     and the captain does not want environment management in the loop.
#   - No leases, so nothing survives with no process holding it. Nothing in this
#     fork needs a durable reservation (that was for secondmate homes).
#   - No conflict detection beyond git's own. Two tasks cannot collide because
#     the path is keyed by task id, and `git worktree add` refuses a path that
#     already exists.
#
# What it keeps, because these are load-bearing:
#   - DETACHED HEAD. Git refuses to check out a branch that is already checked
#     out in another worktree, so a shared branch would make parallel tasks fail
#     at random. The crewmate creates its own fm/<id> branch once inside.
#   - Isolation from the primary checkout. fm-spawn.sh's validate_spawn_worktree
#     still asserts the resolved path is a real worktree root distinct from the
#     project, and still refuses to launch otherwise.
#
# Sourced by fm-spawn.sh and fm-teardown.sh. Also runnable directly for
# diagnosis: `fm-worktree.sh path|create|remove ...`.

# fm_default_branch comes from the tangle guard. Resolve this file's own
# directory from BASH_SOURCE (the real consumers -- fm-spawn.sh and
# fm-teardown.sh -- are bash), falling back to $0 so a direct
# `bash bin/fm-worktree.sh ...` still works. A zsh `source` of this file sets
# neither usefully, so the guard makes it a no-op when the caller already has
# the function; a zsh caller that does not should source fm-tangle-lib.sh first.
if ! command -v fm_default_branch >/dev/null 2>&1; then
  _fm_wt_self=${BASH_SOURCE[0]:-$0}
  _fm_wt_dir=$(cd "$(dirname "$_fm_wt_self")" 2>/dev/null && pwd) || _fm_wt_dir=""
  if [ -z "$_fm_wt_dir" ] || [ ! -f "$_fm_wt_dir/fm-tangle-lib.sh" ]; then
    echo "error: fm-worktree.sh cannot locate fm-tangle-lib.sh (looked in '${_fm_wt_dir:-?}')" >&2
    echo "       source bin/fm-tangle-lib.sh before this file." >&2
    return 1 2>/dev/null || exit 1
  fi
  # shellcheck source=bin/fm-tangle-lib.sh
  . "$_fm_wt_dir/fm-tangle-lib.sh"
  unset _fm_wt_self _fm_wt_dir
fi

# fm_worktree_path <project-abs> <task-id> -> absolute sibling worktree path.
#
# Resolves the project's PHYSICAL path first. That matters when a project is a
# symlink under projects/ pointing at a checkout that lives elsewhere - the case
# where firstmate drives a repo the captain already had on disk instead of
# cloning its own copy. Without this the worktree would be derived from the
# symlink's own parent (projects/) and land inside the firstmate home; with it,
# worktrees sit next to the REAL checkout, matching the captain's existing
# <project>-<branch> convention. Falls back to the given path when it cannot be
# resolved, so a non-existent path still yields a deterministic name for tests.
fm_worktree_path() {
  local proj=$1 id=$2 parent base real
  [ -n "$proj" ] && [ -n "$id" ] || return 1
  case "$id" in
    ''|*[!A-Za-z0-9._-]*) echo "error: unsafe task id '$id'" >&2; return 1 ;;
  esac
  proj=${proj%/}
  if real=$(cd "$proj" 2>/dev/null && pwd -P); then
    proj=$real
  fi
  parent=$(dirname "$proj")
  base=$(basename "$proj")
  printf '%s/%s-fm-%s\n' "$parent" "$base" "$id"
}

# fm_worktree_base_ref <project-abs> -> the ref a fresh task worktree starts at.
# Prefers origin/<default> (what a PR will be opened against) and falls back to
# the local default branch when there is no remote-tracking ref. Deliberately
# does NOT fetch: fm-fleet-sync.sh owns clone freshness at session start, and a
# fetch here would put network latency in the spawn path.
fm_worktree_base_ref() {
  local proj=$1 default
  default=$(fm_default_branch "$proj") || return 1
  if git -C "$proj" rev-parse --verify --quiet "refs/remotes/origin/$default" >/dev/null 2>&1; then
    printf 'origin/%s\n' "$default"
  else
    printf '%s\n' "$default"
  fi
}

# fm_worktree_create <project-abs> <task-id> -> creates the worktree, prints its
# absolute path. Fails loudly and creates nothing on any refusal.
fm_worktree_create() {
  local proj=$1 id=$2 wt base_ref out
  [ -d "$proj" ] || { echo "error: project directory does not exist: $proj" >&2; return 1; }
  git -C "$proj" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { echo "error: not a git repository: $proj" >&2; return 1; }

  wt=$(fm_worktree_path "$proj" "$id") || return 1
  if [ -e "$wt" ]; then
    echo "error: worktree path already exists: $wt" >&2
    echo "       refusing to reuse it; remove it first or pick another task id." >&2
    return 1
  fi

  # Clear registrations whose directory is already gone, so a previously deleted
  # worktree cannot block this path with a stale entry. Only removes entries git
  # itself considers prunable; never touches a live worktree.
  git -C "$proj" worktree prune >/dev/null 2>&1 || true

  base_ref=$(fm_worktree_base_ref "$proj") || {
    echo "error: could not resolve a default branch for $proj" >&2
    return 1
  }

  # --detach: never check out a branch here. See the header.
  if ! out=$(git -C "$proj" worktree add --detach "$wt" "$base_ref" 2>&1); then
    echo "error: git worktree add failed for $wt at $base_ref" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi

  printf '%s\n' "$wt"
}

# fm_worktree_remove <worktree-abs> <project-abs> -> remove the worktree and
# drop its registration. Echoes git's stderr on failure and returns non-zero so
# the caller can apply its own stale-lock recovery.
#
# --force is intentional and safe ONLY because every caller has already passed
# teardown's fail-closed landed-work checks. Never call this to "clean up" a
# worktree whose work has not landed.
fm_worktree_remove() {
  local wt=$1 proj=$2 out
  [ -n "$wt" ] || { echo "error: fm_worktree_remove: empty worktree path" >&2; return 1; }
  [ -n "$proj" ] || { echo "error: fm_worktree_remove: empty project path" >&2; return 1; }
  if [ ! -e "$wt" ]; then
    git -C "$proj" worktree prune >/dev/null 2>&1 || true
    return 0
  fi
  if ! out=$(git -C "$proj" worktree remove --force "$wt" 2>&1); then
    printf '%s\n' "$out" >&2
    return 1
  fi
  git -C "$proj" worktree prune >/dev/null 2>&1 || true
  return 0
}

# Direct CLI entry point, for diagnosis only. Does not run on source.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -eu
  case "${1:-}" in
    path)   fm_worktree_path "${2:?project}" "${3:?task-id}" ;;
    base)   fm_worktree_base_ref "${2:?project}" ;;
    create) fm_worktree_create "${2:?project}" "${3:?task-id}" ;;
    remove) fm_worktree_remove "${2:?worktree}" "${3:?project}" ;;
    *)
      echo "usage: fm-worktree.sh path|base|create <project> [<task-id>]" >&2
      echo "       fm-worktree.sh remove <worktree> <project>" >&2
      exit 2
      ;;
  esac
fi
