#!/usr/bin/env bash
# Install (or refresh) the harness's skills into ~/.claude/skills/ so they
# are reachable as `/<skill-name>` in any Claude Code session anywhere on the
# machine.
#
# Mechanism per Claude Code's skill loader: each skill must live at
#   ~/.claude/skills/<skill-name>/SKILL.md
# We symlink, so edits to the source under coding_harness/skills/ are picked
# up immediately — no copy step to keep in sync.
#
# Idempotent: re-run after any rename, addition, or removal. The script wipes
# only its own previous entries (anything in ~/.claude/skills/ whose SKILL.md
# resolves into this kit); non-harness skills in ~/.claude/skills/ are left
# untouched.
#
# Usage:  bash scripts/install-skills.sh

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$HARNESS_ROOT/skills"
SKILLS_DST="$HOME/.claude/skills"

mkdir -p "$SKILLS_DST"

# --- 1. Remove any prior harness-pointing entries (stale renames, etc.) ----
removed=0
for entry in "$SKILLS_DST"/*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name="$(basename "$entry")"

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
    # Resolve relative target against the directory holding the symlink.
    case "$target" in
      /*) abs_target="$target" ;;
      *)  abs_target="$(cd "$entry" && cd "$(dirname "$target")" && pwd)/$(basename "$target")" ;;
    esac
    case "$abs_target" in
      "$HARNESS_ROOT"/*) rm -r "$entry"; removed=$((removed+1)) ;;
    esac
  fi
done
echo "removed $removed prior harness entries from $SKILLS_DST"

# --- 2. Install fresh symlinks for every current skill ---------------------
installed=0
for skill_file in "$SKILLS_SRC"/*/*.md; do
  [ -f "$skill_file" ] || continue
  name="$(basename "$skill_file" .md)"
  dst_dir="$SKILLS_DST/$name"
  mkdir -p "$dst_dir"
  ln -sf "$skill_file" "$dst_dir/SKILL.md"
  installed=$((installed+1))
done
echo "installed $installed skills into $SKILLS_DST"

# --- 3. Show what's now available ------------------------------------------
echo
echo "Skills now globally available as /<name>:"
ls -1 "$SKILLS_DST" | while read -r name; do
  if [ -L "$SKILLS_DST/$name/SKILL.md" ]; then
    target="$(readlink "$SKILLS_DST/$name/SKILL.md")"
    case "$target" in
      "$HARNESS_ROOT"/*) echo "  - $name" ;;
    esac
  fi
done
