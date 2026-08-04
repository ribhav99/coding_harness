#!/usr/bin/env bash
# shellcheck shell=bash
# bin/fm-naming-lib.sh - read a target project's own worktree and branch naming
# convention out of its committed agent memory, so firstmate's spawned work is
# named the way that project already names work by hand.
#
# Why read it rather than configure it: a project that cares about this states it
# in its own AGENTS.md/CLAUDE.md, which is the file every contributor and every
# agent already reads. A second copy in firstmate's config would be a duplicate
# that drifts. A project that states nothing keeps firstmate's own scheme.
#
# What is detected, and nothing more. Both detectors look for a BACKTICKED
# placeholder template in <project>/AGENTS.md or <project>/CLAUDE.md:
#
#   worktree  a template starting `<repo>-` or `<project>-`
#             e.g. bnl-packpilot's `<repo>-wo-<n>-<slug>`
#   branch    a template starting `<author>/`
#             e.g. bnl-packpilot's `<author>/wo-<n>-<slug>`
#
# Only the PREFIX SHAPE is read, never the rest of the template. Everything after
# the prefix is the task id firstmate already has: a task named wo-253-hospital
# renders bnl-packpilot-wo-253-hospital and ribhav/wo-253-hospital, matching that
# project's convention exactly, because firstmate's task ids are already the
# work-item slug. Trying to parse `<n>` and `<slug>` back out would be a guess;
# the id is the fact.
#
# <author> resolves from FM_AUTHOR, else the first whitespace-separated token of
# the project's `git config user.name`, lowercased and stripped to
# [a-z0-9-] - "Ribhav Kapur" -> "ribhav", matching the convention's own examples.
# An unresolvable author means the branch convention is not applied, because a
# wrong author prefix is worse than firstmate's own namespace.
#
# Sourced by bin/fm-worktree.sh and bin/fm-brief.sh. Also runnable directly for
# diagnosis: `fm-naming-lib.sh worktree-prefixed|branch-namespace <project>`.

# The project memory files consulted, most specific first. A missing file is not
# an error - it just states no convention.
_fm_naming_memory_files() {  # <project-abs>
  printf '%s/AGENTS.md\n%s/CLAUDE.md\n' "$1" "$1"
}

# Print every backticked token in the project's memory, one per line.
_fm_naming_templates() {  # <project-abs>
  local f
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    # Backticked spans only; a template never contains a backtick or whitespace.
    # shellcheck disable=SC2016  # a literal backtick pattern, not an expansion
    grep -o '`[^`[:space:]]*`' "$f" 2>/dev/null | tr -d '`'
  done < <(_fm_naming_memory_files "$1")
}

# 0 when the project states a worktree convention whose names begin with the
# repository directory name, so a task worktree is <repo>-<task-id> rather than
# firstmate's own <repo>-fm-<task-id>.
fm_naming_worktree_is_prefixed() {  # <project-abs>
  local t
  while IFS= read -r t; do
    case "$t" in
      '<repo>-'*|'<project>-'*) return 0 ;;
    esac
  done < <(_fm_naming_templates "$1")
  return 1
}

# Print the branch namespace this project states, or nothing when it states none
# or the author cannot be resolved. A stated `<author>/...` convention yields the
# resolved author; firstmate's own `fm` namespace is the caller's fallback.
fm_naming_branch_namespace() {  # <project-abs>
  local proj=$1 t author
  local stated=1
  while IFS= read -r t; do
    case "$t" in
      '<author>/'*) stated=0; break ;;
    esac
  done < <(_fm_naming_templates "$proj")
  [ "$stated" -eq 0 ] || return 0
  author=${FM_AUTHOR:-}
  if [ -z "$author" ]; then
    author=$(git -C "$proj" config user.name 2>/dev/null) || author=
    author=${author%% *}
  fi
  author=$(printf '%s' "$author" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
  [ -n "$author" ] || return 0
  printf '%s' "$author"
}

# The branch a task should use in <project>: "<namespace>/<task-id>".
fm_naming_branch() {  # <project-abs> <task-id>
  local ns
  ns=$(fm_naming_branch_namespace "$1")
  printf '%s/%s' "${ns:-fm}" "$2"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -eu
  case "${1:-}" in
    worktree-prefixed) fm_naming_worktree_is_prefixed "${2:?project}" && echo yes || echo no ;;
    branch-namespace)  ns=$(fm_naming_branch_namespace "${2:?project}"); echo "${ns:-fm}" ;;
    branch)            fm_naming_branch "${2:?project}" "${3:?task-id}"; echo ;;
    *)
      echo "usage: fm-naming-lib.sh worktree-prefixed|branch-namespace <project>" >&2
      echo "       fm-naming-lib.sh branch <project> <task-id>" >&2
      exit 2
      ;;
  esac
fi
