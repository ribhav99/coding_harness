#!/usr/bin/env bash
# bin/fm-review-flow.sh - the automatic post-PR review flow, and the teardown
# refusal that protects a worktree with a live review in it.
#
# The flow is a four-stage state machine over one ship task (fm-pr-check.sh owns
# stage 1). What these tests pin is the part that is easy to get wrong: stage
# ORDERING, idempotence, and the fact that killing the implementing agent is
# gated on the review session actually existing first.
#
# TMUX ISOLATION. Like every suite here except the one real-tmux smoke test, this
# one fakes tmux entirely - the stub is synthetic and never execs a real binary.
# Three independent guards keep it that way, because a stub that silently falls
# off PATH would otherwise address the HOST's live panes:
#   1. TMUX_TMPDIR is redirected into the throwaway temp root, so any real tmux
#      that somehow ran would bind a brand-new empty server, never the host's.
#   2. require_stub_tmux aborts the run unless `tmux` resolves inside the test's
#      own fakebin.
#   3. Fixture pane ids live in a high range (%80x) that will not collide with a
#      host server's low, sequentially allocated ids.
#
# Matrix:
#   (a) no pr= recorded                       -> REFUSE, nothing recorded
#   (b) kind=scout                            -> REFUSE (ship PRs only)
#   (c) first advance, live implementer       -> self-review sent once, stage recorded
#   (d) second advance while implementer busy -> no re-send, no review session
#   (e) advance while busy state is unknown   -> REFUSE (never start mid-turn)
#   (f) advance when implementer is idle      -> review session in the ROUTED window,
#                                                in the task's OWN worktree, then the
#                                                implementer's pane is killed
#   (g) advance again at stage=reviewing      -> no second review session
#   (h) review launch fails                   -> implementer NOT killed, stage unchanged
#   (h2) launch fails AFTER the pane exists   -> pane recorded anyway, no orphan
#   (i) implementer endpoint already gone     -> self-review skipped, flow still converges
#   (j) --status                              -> reports stage, changes nothing
#   (k) pane-routes "review:" overrides "scout:"
#   (l) teardown with a live review pane      -> REFUSE
#   (m) teardown once the review pane is gone -> the review guard allows it
#   (n) teardown --force with a live review   -> allowed (explicit discard authority)
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

FLOW="$ROOT/bin/fm-review-flow.sh"
TEARDOWN="$ROOT/bin/fm-teardown.sh"
TMP_ROOT=$(fm_test_tmproot fm-review-flow)

# Guard 1: no real tmux server this process could ever reach is the host's.
export TMUX_TMPDIR="$TMP_ROOT/tmux-tmpdir"
mkdir -p "$TMUX_TMPDIR"
unset TMUX

IMPL_PANE='%801'
REVIEW_PANE='%809'

# A tmux stand-in covering exactly the verbs the tmux-panes adapter and the real
# fm-send.sh submit core use. Panes that "exist" come from FM_FAKE_PANES; a
# pane's foreground command comes from FM_FAKE_CMD_<n> (default zsh), which is
# what agent-state classification reads. The composer frame and cursor row are
# the shape fm-send.sh reads to confirm a submit.
make_stubs() {  # <dir> -> echoes fakebin dir
  local dir=$1 fb="$1/fakebin"
  mkdir -p "$fb"
  cat > "$fb/tmux" <<'SH'
#!/usr/bin/env bash
set -u
# Panes that exist: the fixture's own set, plus any this run actually created.
# FM_FAKE_UNSENDABLE_PANE is the exception - a pane that exists for creation but
# refuses input, so a launch that fails AFTER the endpoint exists can be tested.
pane_known() {
  local want=$1 p
  [ "$want" = "${FM_FAKE_UNSENDABLE_PANE:-}" ] && return 1
  for p in ${FM_FAKE_PANES:-}; do [ "$p" = "$want" ] && return 0; done
  [ -f "$FM_TMUX_LOG.panes" ] && grep -Fqx "$want" "$FM_TMUX_LOG.panes" && return 0
  return 1
}
case "${1:-}" in
  has-session|new-session|set-window-option|select-layout) : ;;
  list-windows)
    printf '%s\n' ${FM_FAKE_WINDOWS:-workers} ;;
  new-window)
    printf 'new-window %s\n' "$*" >> "$FM_TMUX_LOG" ;;
  select-pane)
    printf 'select-pane %s\n' "$*" >> "$FM_TMUX_LOG" ;;
  capture-pane)
    # An empty bordered composer: what fm-send.sh reads as "nothing pending".
    printf '╭────╮\n│    │\n╰────╯\n' ;;
  list-panes)
    shift
    all=0; fmt=
    while [ $# -gt 0 ]; do
      case "$1" in
        -a) all=1; shift ;;
        -s) shift ;;
        -t) shift 2 ;;
        -F) fmt=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    case "$fmt" in
      '#{pane_title}') printf '%s\n' ${FM_FAKE_PANE_TITLES:-} ;;
      '#{pane_width} #{pane_height} #{pane_id}')
        for p in ${FM_FAKE_PANES:-}; do printf '80 24 %s\n' "$p"; done ;;
      *)
        if [ "$all" = 1 ]; then
          for p in ${FM_FAKE_PANES:-}; do printf '%s\n' "$p"; done
        else
          for p in ${FM_FAKE_WINDOW_PANES:-}; do printf '%s\n' "$p"; done
        fi ;;
    esac ;;
  split-window)
    [ "${FM_FAKE_SPLIT_FAIL:-0}" = 1 ] && exit 1
    printf 'split-window %s\n' "$*" >> "$FM_TMUX_LOG"
    printf '%s\n' "${FM_FAKE_NEW_PANE:-%809}" >> "$FM_TMUX_LOG.panes"
    printf '%s\n' "${FM_FAKE_NEW_PANE:-%809}" ;;
  send-keys)
    shift
    literal=0; target=
    while [ $# -gt 0 ]; do
      case "$1" in
        -t) target=$2; shift 2 ;;
        -l) literal=1; shift ;;
        *) break ;;
      esac
    done
    printf 'send-keys target=%s literal=%s arg=%s\n' "$target" "$literal" "${1:-}" >> "$FM_TMUX_LOG" ;;
  kill-pane)
    shift
    target=
    while [ $# -gt 0 ]; do
      case "$1" in -t) target=$2; shift 2 ;; *) shift ;; esac
    done
    printf 'kill-pane target=%s\n' "$target" >> "$FM_TMUX_LOG" ;;
  display-message)
    shift
    target=; fmt=
    while [ $# -gt 0 ]; do
      case "$1" in
        -p) shift ;;
        -t) target=$2; shift 2 ;;
        *) fmt=$1; shift ;;
      esac
    done
    case "$fmt" in
      '#{pane_id}')
        pane_known "$target" || exit 1
        printf '%s\n' "$target" ;;
      '#{cursor_y}') printf '1\n' ;;
      '#{pane_current_command}')
        n=${target#%}
        var="FM_FAKE_CMD_${n}"
        printf '%s\n' "${!var:-zsh}" ;;
      '#{pane_title}') printf '%s\n' "${FM_FAKE_PANE_TITLE:-shell}" ;;
      '#{session_name}:#{window_name}') printf 'fmtest:workers\n' ;;
      '#S') printf 'fmtest\n' ;;
      *) printf '\n' ;;
    esac ;;
esac
exit 0
SH
  chmod +x "$fb/tmux"
  cat > "$fb/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$fb/sleep"
  printf '%s\n' "$fb"
}

# Guard 2: refuse to run anything unless the stub really is the tmux on PATH.
require_stub_tmux() {  # <fakebin>
  local fb=$1 resolved
  resolved=$(PATH="$fb:$PATH" command -v tmux || true)
  [ "$resolved" = "$fb/tmux" ] \
    || fail "test isolation: tmux resolved to '${resolved:-<none>}', not the stub at $fb/tmux"
}

# A home with one PR-ready ship task whose implementing agent sits in IMPL_PANE.
setup_task() {  # <name> [kind] -> echoes home dir
  local name=$1 kind=${2:-ship}
  local home="$TMP_ROOT/$name" wt="$TMP_ROOT/$name-wt"
  mkdir -p "$home/state" "$home/config" "$wt"
  printf 'claude\n' > "$home/config/crew-harness"
  printf 'max\n' > "$home/config/crew-effort"
  printf 'ship: workers\nscout: reviews\ndefault: workers\n' > "$home/config/pane-routes"
  fm_write_meta "$home/state/$name.meta" \
    "window=$IMPL_PANE" \
    "endpoint_task_id=$name" \
    "worktree=$wt" \
    "project=$wt" \
    "harness=claude" \
    "kind=$kind" \
    "mode=direct-PR" \
    "yolo=off" \
    "backend=tmux-panes" \
    "pr=https://github.com/o/r/pull/7"
  printf '%s\n' "$home"
}

# The semantic busy record the flow's stage-3 gate reads. Absent record = unknown.
write_busy() {  # <home> <id> <busy|idle>
  printf 'g1\n' > "$1/state/$2.busy-gen"
  printf 'v1 gen=g1 seq=1 state=%s source=claude-hook event=stop ts=1700000000\n' "$3" \
    > "$1/state/$2.busy-state"
}

run_flow() {  # <home> <id> [extra args...] -> sets RC, OUT, ERR_TEXT
  local home=$1 id=$2
  shift 2
  local fb out err
  fb=$(make_stubs "$home")
  require_stub_tmux "$fb"
  out="$home/flow.out"; err="$home/flow.err"
  PATH="$fb:$PATH" \
    FM_HOME="$home" FM_STATE_OVERRIDE="$home/state" FM_CONFIG_OVERRIDE="$home/config" \
    FM_TMUX_LOG="${FM_TMUX_LOG:-$home/tmux.log}" \
    FM_FAKE_PANES="${FM_FAKE_PANES:-$IMPL_PANE}" \
    FM_SEND_SETTLE=0 \
    "$FLOW" "$id" "$@" > "$out" 2> "$err"
  RC=$?
  OUT=$(cat "$out")
  ERR_TEXT=$(cat "$err")
}

record_field() {  # <home> <id> <key>
  grep "^$3=" "$1/state/$2.review-flow" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

test_refuses_without_pr() {
  local home
  home=$(setup_task no-pr)
  grep -v '^pr=' "$home/state/no-pr.meta" > "$home/m" && mv "$home/m" "$home/state/no-pr.meta"
  run_flow "$home" no-pr
  [ "$RC" -ne 0 ] || fail "a task with no recorded pr= must refuse"
  assert_contains "$ERR_TEXT" "no recorded pr=" "refusal should name the missing PR record"
  assert_absent "$home/state/no-pr.review-flow" "a refused advance must record nothing"
  pass "fm-review-flow: refuses before fm-pr-check.sh has recorded the PR"
}

test_refuses_scout() {
  local home
  home=$(setup_task scouty scout)
  run_flow "$home" scouty
  [ "$RC" -ne 0 ] || fail "a scout task must not get a review flow"
  assert_contains "$ERR_TEXT" "ship tasks only" "refusal should scope the flow to ship tasks"
  assert_absent "$home/state/scouty.review-flow" "a refused scout advance must record nothing"
  pass "fm-review-flow: covers PR-based ship tasks only"
}

test_first_advance_sends_self_review_once() {
  local home log first second
  home=$(setup_task selfrev)
  log="$home/tmux.log"; : > "$log"
  FM_TMUX_LOG="$log" run_flow "$home" selfrev
  expect_code 0 "$RC" "the first advance should send the self-review"
  assert_contains "$OUT" "stage=self-review" "output should report the recorded stage"
  [ "$(record_field "$home" selfrev self_review)" = sent ] || fail "self_review should record as sent"
  first=$(grep -c 'literal=1' "$log" || true)
  [ "$first" -ge 1 ] || fail "the self-review text should have been typed into the implementer's pane"
  assert_grep "target=$IMPL_PANE" "$log" "the self-review must go to the implementing agent's own pane"

  # (d) a second advance while the implementer is still working must not re-send.
  : > "$log"
  write_busy "$home" selfrev busy
  FM_TMUX_LOG="$log" run_flow "$home" selfrev
  expect_code 0 "$RC" "advancing while the implementer is busy is a wait, not an error"
  assert_contains "$OUT" "waiting=self-review-in-progress" "a busy implementer should report waiting"
  second=$(grep -c 'literal=1' "$log" || true)
  [ "$second" = 0 ] || fail "the self-review must never be sent twice"
  assert_no_grep "split-window" "$log" "no review session may start while the implementer is busy"
  pass "fm-review-flow: sends the self-review exactly once and waits out that turn"
}

test_unknown_busy_state_refuses() {
  local home log
  home=$(setup_task unknownbusy)
  log="$home/tmux.log"; : > "$log"
  printf 'stage=self-review\nself_review=sent\n' > "$home/state/unknownbusy.review-flow"
  # No busy record at all: bin/fm-busy-lib.sh reports unknown, never idle.
  FM_TMUX_LOG="$log" run_flow "$home" unknownbusy
  [ "$RC" -ne 0 ] || fail "an unknown busy state must refuse to start the review"
  assert_contains "$ERR_TEXT" "may still be committing" "refusal should name the overlap hazard"
  assert_no_grep "split-window" "$log" "no review session may start on an unknown busy state"
  assert_no_grep "kill-pane" "$log" "the implementer must not be killed on a refused advance"
  [ "$(record_field "$home" unknownbusy stage)" = self-review ] || fail "a refused advance must not change the stage"
  pass "fm-review-flow: refuses to start the review unless the implementer is provably not mid-turn"
}

test_idle_starts_review_then_retires_implementer() {
  local home log wt
  home=$(setup_task idlerev)
  wt="$TMP_ROOT/idlerev-wt"
  log="$home/tmux.log"; : > "$log"
  printf 'stage=self-review\nself_review=sent\n' > "$home/state/idlerev.review-flow"
  write_busy "$home" idlerev idle
  FM_TMUX_LOG="$log" run_flow "$home" idlerev
  expect_code 0 "$RC" "an idle implementer should advance the flow"
  assert_contains "$OUT" "stage=reviewing" "output should report the review session"

  assert_grep "split-window" "$log" "a review session should have been created"
  assert_grep "-c $wt" "$log" "the review session must run in the task's OWN recorded worktree"
  assert_grep "target=$REVIEW_PANE literal=1 arg=CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude --dangerously-skip-permissions --effort 'max' '/full-review this pr'" \
    "$log" "the review session's launch must carry the standing crew flags and only the /full-review line"
  assert_grep "-T fm-idlerev-review" "$log" "the review pane should be labelled for its task"
  assert_grep "kill-pane target=$IMPL_PANE" "$log" "the implementing agent's pane must be closed once the review exists"

  [ "$(record_field "$home" idlerev review_target)" = "$REVIEW_PANE" ] || fail "the review endpoint should be recorded"
  [ "$(record_field "$home" idlerev review_window)" = reviews ] || fail "the review must route to the reviews window"
  [ "$(record_field "$home" idlerev implementer_retired)" = 1 ] || fail "retirement should be recorded"
  # The worktree the review runs in is untouched by retirement.
  assert_present "$wt" "retiring the implementer must never remove its worktree"

  # (g) re-running at the terminal stage must not start a second review session.
  : > "$log"
  FM_TMUX_LOG="$log" run_flow "$home" idlerev
  expect_code 0 "$RC" "re-running at stage=reviewing should be a no-op"
  assert_contains "$OUT" "note=already-reviewing" "a second call should report the existing review"
  assert_no_grep "split-window" "$log" "a task must never get a second review session"
  pass "fm-review-flow: starts one routed review in the task's worktree, then retires the implementer"
}

test_failed_launch_leaves_implementer_alive() {
  local home log
  home=$(setup_task failedlaunch)
  log="$home/tmux.log"; : > "$log"
  printf 'stage=self-review\nself_review=sent\n' > "$home/state/failedlaunch.review-flow"
  write_busy "$home" failedlaunch idle
  FM_TMUX_LOG="$log" FM_FAKE_SPLIT_FAIL=1 run_flow "$home" failedlaunch
  [ "$RC" -ne 0 ] || fail "a failed review launch must report failure"
  assert_contains "$ERR_TEXT" "left alive" "the failure should say the implementer was spared"
  assert_no_grep "kill-pane" "$log" "a failed review launch must never kill the implementing agent"
  [ "$(record_field "$home" failedlaunch stage)" = self-review ] || fail "a failed launch must not advance the stage"
  pass "fm-review-flow: a failed review launch is inert - the implementer survives, the stage stands"
}

test_launch_failure_after_create_still_records_the_pane() {
  local home log
  home=$(setup_task orphanguard)
  log="$home/tmux.log"; : > "$log"
  printf 'stage=self-review\nself_review=sent\n' > "$home/state/orphanguard.review-flow"
  write_busy "$home" orphanguard idle
  # The pane is created but refuses input: the launch fails AFTER the endpoint exists.
  FM_TMUX_LOG="$log" FM_FAKE_UNSENDABLE_PANE="$REVIEW_PANE" run_flow "$home" orphanguard
  [ "$RC" -ne 0 ] || fail "an undeliverable launch must report failure"
  assert_grep "split-window" "$log" "the review endpoint should have been created"
  assert_no_grep "kill-pane" "$log" "the implementer must survive a launch that never reached its pane"
  # The pane exists, so teardown must be able to see it: an unrecorded pane would
  # be an orphan that the live-review guard could not protect.
  [ "$(record_field "$home" orphanguard review_target)" = "$REVIEW_PANE" ] \
    || fail "a created review endpoint must be recorded even when its launch fails"
  [ "$(record_field "$home" orphanguard implementer_retired)" = 0 ] \
    || fail "retirement must not be claimed when the launch failed"
  pass "fm-review-flow: an endpoint that exists is always recorded, so a failed launch leaves no orphan"
}

test_missing_endpoint_skips_self_review() {
  local home log
  home=$(setup_task goneagent)
  log="$home/tmux.log"; : > "$log"
  FM_TMUX_LOG="$log" FM_FAKE_PANES=" " run_flow "$home" goneagent
  expect_code 0 "$RC" "a dead implementer should not wedge the flow"
  [ "$(record_field "$home" goneagent self_review)" = skipped-endpoint-gone ] \
    || fail "a gone endpoint should record the skip rather than claim a send"
  assert_no_grep "literal=1" "$log" "nothing may be typed at an endpoint that does not exist"
  pass "fm-review-flow: a dead implementer skips the self-review instead of wedging"
}

test_status_is_read_only() {
  local home log
  home=$(setup_task statusonly)
  log="$home/tmux.log"; : > "$log"
  FM_TMUX_LOG="$log" run_flow "$home" statusonly --status
  expect_code 0 "$RC" "--status should succeed"
  assert_contains "$OUT" "stage=none" "an untouched task should report no stage"
  assert_absent "$home/state/statusonly.review-flow" "--status must not create a record"
  [ ! -s "$log" ] || fail "--status must not touch the terminal"
  pass "fm-review-flow: --status reports without changing anything"
}

test_review_route_overrides_scout_route() {
  local home log
  home=$(setup_task routed)
  printf 'ship: workers\nscout: reviews\nreview: audits\ndefault: workers\n' > "$home/config/pane-routes"
  log="$home/tmux.log"; : > "$log"
  printf 'stage=self-review\nself_review=sent\n' > "$home/state/routed.review-flow"
  write_busy "$home" routed idle
  FM_TMUX_LOG="$log" run_flow "$home" routed
  expect_code 0 "$RC" "an explicit review route should still launch"
  [ "$(record_field "$home" routed review_window)" = audits ] || fail "an explicit review: route should win over scout:"
  pass "fm-review-flow: routes through config/pane-routes, review: ahead of scout:"
}

# --- teardown interaction ---------------------------------------------------

# A landed ship task whose worktree is clean and fully pushed, so the ONLY thing
# that can refuse teardown is the live-review guard.
setup_landed_task() {  # <name> -> echoes home dir
  local name=$1
  local home="$TMP_ROOT/$name" wt="$TMP_ROOT/$name-wt" origin="$TMP_ROOT/$name-origin"
  mkdir -p "$home/state" "$home/config" "$home/projects"
  fm_git_identity
  git init -q --bare "$origin"
  fm_git_init_commit "$wt" >/dev/null 2>&1
  git -C "$wt" remote add origin "$origin" >/dev/null 2>&1
  git -C "$wt" push -q origin HEAD >/dev/null 2>&1
  git -C "$wt" fetch -q origin >/dev/null 2>&1
  fm_write_meta "$home/state/$name.meta" \
    "window=$IMPL_PANE" \
    "endpoint_task_id=$name" \
    "worktree=$wt" \
    "project=$wt" \
    "harness=claude" \
    "kind=ship" \
    "mode=direct-PR" \
    "yolo=off" \
    "backend=tmux-panes" \
    "pr=https://github.com/o/r/pull/7"
  printf '%s\n' "$home"
}

run_teardown() {  # <home> <id> [extra args...] -> sets RC, ERR_TEXT
  local home=$1 id=$2
  shift 2
  local fb out err
  fb=$(make_stubs "$home")
  require_stub_tmux "$fb"
  out="$home/td.out"; err="$home/td.err"
  PATH="$fb:$PATH" \
    FM_HOME="$home" FM_STATE_OVERRIDE="$home/state" FM_CONFIG_OVERRIDE="$home/config" \
    FM_TMUX_LOG="$home/tmux.log" \
    FM_FAKE_PANES="${FM_FAKE_PANES:-$IMPL_PANE $REVIEW_PANE}" \
    FM_FAKE_CMD_809="${FM_FAKE_CMD_809:-2.1.220}" \
    "$TEARDOWN" "$id" "$@" > "$out" 2> "$err"
  RC=$?
  ERR_TEXT=$(cat "$out" "$err")
}

write_review_record() {  # <home> <id> [target]
  printf 'stage=reviewing\nself_review=sent\nreview_backend=tmux-panes\nreview_target=%s\nreview_window=reviews\nreview_label=fm-%s-review\nimplementer_retired=1\n' \
    "${3:-$REVIEW_PANE}" "$2" > "$1/state/$2.review-flow"
}

test_teardown_refuses_live_review() {
  local home
  home=$(setup_landed_task tdlive)
  write_review_record "$home" tdlive
  run_teardown "$home" tdlive
  [ "$RC" -ne 0 ] || fail "teardown must refuse while a review session is running in the worktree"
  assert_contains "$ERR_TEXT" "review session" "the refusal should name the live review"
  assert_present "$TMP_ROOT/tdlive-wt" "a refused teardown must leave the worktree in place"
  pass "fm-teardown: refuses to remove a worktree with a live review session in it"
}

test_teardown_allows_finished_review() {
  local home
  home=$(setup_landed_task tdgone)
  write_review_record "$home" tdgone
  # The review pane is gone: the record is stale and must not block cleanup.
  FM_FAKE_PANES="$IMPL_PANE" run_teardown "$home" tdgone
  assert_not_contains "$ERR_TEXT" "review session" "a finished review must not block teardown"
  pass "fm-teardown: a finished review's stale record never blocks cleanup"
}

test_teardown_force_overrides_live_review() {
  local home
  home=$(setup_landed_task tdforce)
  write_review_record "$home" tdforce
  run_teardown "$home" tdforce --force
  assert_not_contains "$ERR_TEXT" "REFUSED" "--force is the explicit discard path and still applies"
  pass "fm-teardown: --force remains the one explicit override for a live review"
}

test_refuses_without_pr
test_refuses_scout
test_first_advance_sends_self_review_once
test_unknown_busy_state_refuses
test_idle_starts_review_then_retires_implementer
test_failed_launch_leaves_implementer_alive
test_launch_failure_after_create_still_records_the_pane
test_missing_endpoint_skips_self_review
test_status_is_read_only
test_review_route_overrides_scout_route
test_teardown_refuses_live_review
test_teardown_allows_finished_review
test_teardown_force_overrides_live_review
