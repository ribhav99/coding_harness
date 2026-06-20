#!/usr/bin/env bash
# Install (or refresh) the harness's skills so they are reachable as
# `/<skill-name>` from Claude Code. The real skill files always stay in this
# repo under coding_harness/skills/<category>/<name>.md; everything below is
# just symlinks pointing back at them.
#
# Two destinations are kept in sync:
#   1. ~/.claude/skills/<name>/SKILL.md   — absolute symlinks; makes every
#      skill usable in ANY Claude Code session anywhere on the machine.
#   2. <repo>/.claude/skills/<name>/SKILL.md — repo-relative symlinks
#      (../../../skills/<category>/<name>.md); travels with the repo, so the
#      skills work in this project even on a fresh clone on another machine.
#
# Because both are symlinks, edits to the source under skills/ are picked up
# immediately — no copy step to keep in sync.
#
# Idempotent: re-run after any rename, addition, or removal. For each
# destination the script wipes only its own previous entries (anything whose
# SKILL.md resolves into this kit); hand-added / third-party skills sitting in
# the same directory are left untouched.
#
# Usage:  bash scripts/install-skills.sh

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$HARNESS_ROOT/skills"

# refresh_skills_dir <dst-skills-dir> <abs|rel>
#   abs — SKILL.md target is the absolute source path (for the global dir).
#   rel — SKILL.md target is ../../../skills/<category>/<name>.md, which is
#         only valid when <dst> is this repo's own .claude/skills/.
refresh_skills_dir() {
  local dst="$1" mode="$2"
  local removed=0 installed=0
  local entry name target abs_target link_dir
  local skill_file category dst_dir link_target

  mkdir -p "$dst"

  # --- 1. Remove any prior harness-pointing entries (stale renames, etc.) ---
  for entry in "$dst"/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue

    # If the entry itself is a symlink pointing into this kit, remove it.
    if [ -L "$entry" ]; then
      target="$(readlink "$entry")"
      case "$target" in
        "$HARNESS_ROOT"/*) rm "$entry"; removed=$((removed+1)); continue ;;
      esac
    fi

    # If the entry is a directory whose SKILL.md is a symlink into this kit,
    # remove the whole directory (this is the shape Claude Code expects).
    if [ -d "$entry" ] && [ -L "$entry/SKILL.md" ]; then
      target="$(readlink "$entry/SKILL.md")"
      # Resolve relative targets against the directory holding the symlink so
      # we can tell whether they point into this kit (works even when the leaf
      # file was renamed away, i.e. the symlink is currently broken).
      case "$target" in
        /*) abs_target="$target" ;;
        *)  link_dir="$(cd "$entry" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)" || link_dir=""
            [ -n "$link_dir" ] && abs_target="$link_dir/$(basename "$target")" || abs_target="" ;;
      esac
      case "$abs_target" in
        "$HARNESS_ROOT"/*) rm -r "$entry"; removed=$((removed+1)) ;;
      esac
    fi
  done

  # --- 2. Install fresh symlinks for every current skill -------------------
  for skill_file in "$SKILLS_SRC"/*/*.md; do
    [ -f "$skill_file" ] || continue
    name="$(basename "$skill_file" .md)"
    category="$(basename "$(dirname "$skill_file")")"
    dst_dir="$dst/$name"
    mkdir -p "$dst_dir"
    if [ "$mode" = "rel" ]; then
      link_target="../../../skills/$category/$name.md"
    else
      link_target="$skill_file"
    fi
    ln -sf "$link_target" "$dst_dir/SKILL.md"
    installed=$((installed+1))
  done

  echo "  $dst — removed $removed stale, installed $installed"
}

echo "Refreshing skill symlinks (source of truth: $SKILLS_SRC)"
refresh_skills_dir "$HOME/.claude/skills" abs          # usable anywhere
refresh_skills_dir "$HARNESS_ROOT/.claude/skills" rel  # travels with the repo

# --- Show what's now available ---------------------------------------------
echo
echo "Skills now available as /<name> (globally + in this repo):"
for skill_file in "$SKILLS_SRC"/*/*.md; do
  [ -f "$skill_file" ] || continue
  echo "  - $(basename "$skill_file" .md)"
done | sort
