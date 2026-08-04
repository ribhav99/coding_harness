#!/usr/bin/env bash
# Shared marker-or-plain-checkout predicate for tracked hooks that must act only
# in a genuine firstmate primary home.
# This file is sourced by hook entrypoints and has no side effects on source.

# Return 0 when $1 is a genuine primary root whose effective state dir is $2.
# Only a plain checkout is primary, never a linked task worktree.
#
# LOCAL FORK: both rev-parse calls pin --path-format=absolute. Upstream compared
# the raw outputs, which are only guaranteed to agree when $root IS the repo top
# level: from a SUBDIRECTORY git answers --git-dir with an absolute path and
# --git-common-dir with a relative one ("../.git"), so the string compare failed
# and every caller silently went inert. This home lives in a subdirectory of the
# coding_harness repo, so that was the difference between guarded and unguarded.
# Normalizing preserves the check's actual intent exactly - a linked worktree
# still reports .git/worktrees/<name> vs .git and is still rejected. Matches
# bin/fm-ff-lib.sh, which already uses this flag. Needs git >= 2.31; an older git
# errors out and falls through to the same inert result as before.
fm_primary_scope_matches() {
  local root=$1 state=$2 git_dir git_common_dir
  git_dir=$(git -C "$root" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  git_common_dir=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ "$git_dir" = "$git_common_dir" ] || return 1
  [ -f "$root/AGENTS.md" ] || return 1
  [ -d "$root/bin" ] || return 1
  [ -d "$state" ] || return 1
}
