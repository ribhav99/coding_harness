#!/usr/bin/env bash
# Tests for harness-aware supervision instruction rendering.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP_ROOT=$(fm_test_tmproot fm-supervision-instructions)
RENDER="$ROOT/bin/fm-supervision-instructions.sh"

test_selected_harness_block_only() {
  local out
  out=$("$RENDER" --harness claude)
  assert_contains "$out" "SUPERVISION OPERATING INSTRUCTIONS - primary harness: claude" "claude heading missing"
  assert_contains "$out" "Mode: Claude Stop-hook-owned supervision." "claude snippet missing"
  assert_not_contains "$out" "Mode: Unknown harness fallback." "renderer printed the unknown snippet too"
  pass "renderer prints exactly the selected harness block"
}

test_unknown_fallback() {
  local out
  out=$("$RENDER" --harness not-real)
  assert_contains "$out" "primary harness: unknown" "unknown heading missing"
  assert_contains "$out" "Mode: Unknown harness fallback." "unknown fallback snippet missing"
  pass "renderer falls back to unknown.md for unverified harness names"
}

test_conditional_stanzas() {
  local home config out
  home="$TMP_ROOT/conditional-home"
  config="$TMP_ROOT/conditional-config"
  mkdir -p "$home/state" "$home/config" "$config"
  out=$(FM_HOME="$home" FM_CONFIG_OVERRIDE="$config" "$RENDER" --harness claude --read-only 1 --afk 1)
  assert_contains "$out" "- Lock: read-only" "read-only stanza missing"
  assert_contains "$out" "- Away mode: active" "afk stanza missing"
  assert_contains "$out" 'Mode: Claude Stop-hook-owned supervision.' "claude snippet missing"
  pass "renderer includes read-only and afk current-state stanzas"
}

test_repair_lines() {
  local home out
  home="$TMP_ROOT/repair-home"
  mkdir -p "$home/state" "$home/config"
  out=$(FM_HOME="$home" "$RENDER" --harness claude --queue-pending 1 --repair-line)
  assert_contains "$out" "After draining queued wakes" "queue-pending prefix missing"
  assert_contains "$out" "Claude Code background task" "claude repair line missing background-task mechanism"

  out=$(FM_HOME="$home" "$RENDER" --harness claude --read-only 1 --repair-line)
  assert_contains "$out" "session holding the fleet lock" "read-only repair line missing"

  out=$(FM_HOME="$home" "$RENDER" --harness claude --afk 1 --repair-line)
  assert_contains "$out" "Away mode owns watcher supervision" "afk repair line missing"

  out=$(FM_HOME="$home" "$RENDER" --harness not-real --repair-line)
  assert_contains "$out" "session-start block for this harness" "unknown-harness repair line missing"
  pass "renderer repair-line mode honors conditional state"
}






test_selected_harness_block_only
test_unknown_fallback
test_conditional_stanzas
test_repair_lines
