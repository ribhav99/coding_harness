#!/usr/bin/env bash
# fm-review-flow.sh - advance a finished ship task's automatic post-PR review.
#
# LOCAL FORK (FORK-NOTES.md delta 9). Upstream has no automatic review stage, so
# a PR got reviewed only when a session remembered to review it. This script
# makes the review a deterministic, idempotent step of the task lifecycle
# instead (AGENTS.md section 7), so it happens every time.
#
# A PR-based ship task runs through four stages. bin/fm-pr-check.sh owns stage 1;
# this script owns stages 2-4 and advances AT MOST ONE stage per call, so two
# stages can never run at once:
#
#   1. (bin/fm-pr-check.sh)  the PR is recorded in state/<id>.meta as pr=.
#   2. self-review   the IMPLEMENTING agent is sent one line asking it to review
#                    its own work, in its own live session and its own worktree.
#                    Not a new session and not a new worktree.
#   3. reviewing     once that turn has PROVABLY ended, a review session starts
#                    in the routed review window, with the task's own recorded
#                    worktree as its cwd and the single line `/full-review this
#                    pr` as its initial prompt. It allocates no worktree.
#   4. retire        immediately after the review session exists, the
#                    implementing agent's endpoint is killed. Its worktree,
#                    branch, and any uncommitted work are never touched:
#                    bin/fm-teardown.sh remains the only thing that removes a
#                    worktree, and its landed-work test still governs that.
#
# Usage:
#   fm-review-flow.sh <task-id>            advance one stage; print the result
#   fm-review-flow.sh <task-id> --status   print the current stage, change nothing
#
# Call it after fm-pr-check.sh, then again on each turn-end wake for that task
# until it prints stage=reviewing. Re-running is always safe: a stage already
# recorded is never redone, so the self-review line is sent exactly once and at
# most one review session ever exists per task.
#
# Why a separate step rather than a tail of fm-pr-check.sh. fm-pr-check.sh is the
# load-bearing step - it records the canonical pr= and atomically publishes the
# watcher's merge poll - and bin/fm-pr-merge.sh calls it AGAIN at merge time, so
# a launch wired into it would re-fire the review flow on every merge. Keeping
# the launch separate also keeps a failed launch inert: the PR record and the
# task's own lifecycle are already complete before this script runs.
#
# Why the review session is a plain session and not a tracked task. It has no
# brief, produces no deliverable, and must run INSIDE the finished task's
# worktree - which bin/fm-spawn.sh would refuse to reuse, because it allocates a
# fresh worktree per task and asserts isolation from the primary checkout. A
# second task record would also put a non-deliverable in the backlog and in
# supervision's fleet inventory. What the flow does need durably - which stage
# it reached, and where the review session lives - is one private sidecar record
# at state/<id>.review-flow, keyed by the implementing task's own id.
#
# Record fields (state/<id>.review-flow, mode 0600, atomically replaced):
#   stage=self-review|reviewing   the last stage COMPLETED by this script
#   self_review=sent|skipped-endpoint-gone
#   review_backend=<backend>      backend that owns the review endpoint
#   review_target=<endpoint>      the review session's endpoint handle
#   review_window=<name>          window the review session was routed into
#   review_label=<label>          pane/window label of the review session
#   implementer_retired=0|1       whether stage 4 completed
#
# Fail-closed gates, in the order they are checked:
#   - the task must be a ship task with a recorded pr=; scout and secondmate
#     tasks have no review flow (AGENTS.md section 7 scopes it to ship PRs).
#   - stage 3 runs only when the implementing agent is provably NOT mid-turn.
#     bin/fm-busy-lib.sh is the owner of that verdict, and it reports unknown -
#     never idle - for missing, stale, or untrusted busy data. Only `idle` (turn
#     ended) or `dead` (endpoint already gone) advance; `busy` waits and `unknown`
#     refuses, because starting the review while the implementer may still be
#     committing is exactly what stage ordering exists to prevent.
#   - the recorded worktree must still be an existing directory.
#   - stage 4 runs only after the review endpoint provably exists. A failed
#     launch leaves the implementing agent alive and the stage unchanged, so the
#     call can simply be retried.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"
STATE="${FM_STATE_OVERRIDE:-$FM_HOME/state}"
CONFIG="${FM_CONFIG_OVERRIDE:-$FM_HOME/config}"

usage() {
  # The whole leading comment block, ending at the first line that is not a
  # comment - the same derivation bin/fm-spawn.sh uses, so help cannot truncate
  # when the header grows.
  sed -n '2,${/^#/!q;p;}' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

# shellcheck source=bin/fm-backend.sh
. "$SCRIPT_DIR/fm-backend.sh"
# shellcheck source=bin/fm-busy-lib.sh
. "$SCRIPT_DIR/fm-busy-lib.sh"
# shellcheck source=bin/fm-gate-refuse-lib.sh
. "$SCRIPT_DIR/fm-gate-refuse-lib.sh"
# Fail closed before any fleet mutation: a no-mistakes gate agent must never
# steer a crewmate, kill an endpoint, or launch a session.
fm_refuse_if_gate_agent

# The one line the implementing agent is asked to act on in stage 2. It names no
# status vocabulary on purpose: the agent's turn-end signal is already what wakes
# firstmate, so the self-review needs no new protocol of its own.
SELF_REVIEW_TEXT=${FM_SELF_REVIEW_TEXT:-'Self-review before this ships: re-read your complete diff against the base branch, check it against every acceptance criterion in your brief, fix and push anything that is wrong, then say plainly whether it is ready to ship.'}

# The review session's entire instruction. The full-review skill discovers the
# branch, base, and PR itself, so nothing else belongs here.
REVIEW_PROMPT=${FM_REVIEW_PROMPT:-'/full-review this pr'}

ID=
STATUS_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --status) STATUS_ONLY=1 ;;
    -*) echo "error: unknown flag '$1'" >&2; exit 2 ;;
    *)
      [ -z "$ID" ] || { echo "error: unexpected extra argument '$1'" >&2; exit 2; }
      ID=$1
      ;;
  esac
  shift
done

case "$ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "error: usage: fm-review-flow.sh <task-id> [--status]" >&2
    exit 2
    ;;
esac

META="$STATE/$ID.meta"
RECORD="$STATE/$ID.review-flow"

shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

record_get() {  # <key>
  fm_meta_get "$RECORD" "$1"
}

# Every write replaces the whole record atomically on the state device, so a
# crash can never leave a half-written stage behind.
record_write() {  # <key=value>...
  local tmp
  tmp=$(mktemp "$STATE/.fm-review-flow.XXXXXX") || return 1
  if ! printf '%s\n' "$@" > "$tmp" || ! chmod 0600 "$tmp" || ! mv -f -- "$tmp" "$RECORD"; then
    rm -f -- "$tmp"
    return 1
  fi
}

STAGE=$(record_get stage)
SELF_REVIEW=$(record_get self_review)
REVIEW_BACKEND=$(record_get review_backend)
REVIEW_TARGET=$(record_get review_target)
REVIEW_WINDOW=$(record_get review_window)
REVIEW_LABEL=$(record_get review_label)
RETIRED=$(record_get implementer_retired)

print_state() {  # <trailing-token>...
  printf 'review-flow %s stage=%s' "$ID" "${STAGE:-none}"
  [ -z "$REVIEW_TARGET" ] || printf ' review_target=%s' "$REVIEW_TARGET"
  [ -z "$REVIEW_WINDOW" ] || printf ' review_window=%s' "$REVIEW_WINDOW"
  [ -z "$RETIRED" ] || printf ' implementer_retired=%s' "$RETIRED"
  [ "$#" -eq 0 ] || printf ' %s' "$@"
  printf '\n'
}

if [ "$STATUS_ONLY" -eq 1 ]; then
  print_state
  exit 0
fi

# ── preconditions ────────────────────────────────────────────────────────────

if [ ! -f "$META" ] || [ -L "$META" ]; then
  echo "error: task $ID has no regular endpoint metadata at $META" >&2
  exit 1
fi

KIND=$(fm_meta_get "$META" kind)
case "${KIND:-ship}" in
  ship) ;;
  *)
    echo "error: task $ID is kind=${KIND}; the review flow covers PR-based ship tasks only" >&2
    exit 1
    ;;
esac

PR=$(fm_meta_get "$META" pr)
if [ -z "$PR" ]; then
  echo "error: task $ID has no recorded pr=; run bin/fm-pr-check.sh <id> <pr-url> first" >&2
  exit 1
fi

BACKEND=$(fm_backend_of_meta "$META")
TARGET=$(fm_backend_target_of_meta "$META")
HARNESS=$(fm_meta_get "$META" harness)
WT=$(fm_meta_get "$META" worktree)

# ── stage 3 terminal ─────────────────────────────────────────────────────────
# Reached the end: never start a second review session for the same task.

if [ "$STAGE" = reviewing ]; then
  print_state 'note=already-reviewing'
  exit 0
fi

# ── stage 2: send the implementing agent its own self-review ─────────────────

if [ -z "$STAGE" ]; then
  if [ -z "$TARGET" ]; then
    echo "error: task $ID records no endpoint; cannot send its self-review" >&2
    exit 1
  fi
  if fm_backend_target_exists "$BACKEND" "$TARGET" "fm-$ID" 2>/dev/null; then
    # A failed steer is deliberately NOT recorded: fm-send.sh may have typed the
    # line without confirming submission, so the pane needs a look before any
    # retry (AGENTS.md section 8's failed-steer trigger) rather than a second
    # blind send from here.
    if ! "$SCRIPT_DIR/fm-send.sh" "$ID" "$SELF_REVIEW_TEXT"; then
      echo "error: task $ID could not be sent its self-review; nothing was recorded - inspect the pane before retrying" >&2
      exit 1
    fi
    SELF_REVIEW=sent
  else
    # No live agent to review its own work. Record the stage as reached anyway so
    # the flow still converges on the review session rather than wedging here.
    SELF_REVIEW=skipped-endpoint-gone
  fi
  STAGE=self-review
  record_write "stage=$STAGE" "self_review=$SELF_REVIEW" || {
    echo "error: task $ID self-review was delivered but its record could not be written" >&2
    exit 1
  }
  print_state "self_review=$SELF_REVIEW" 'next=advance-again-on-turn-end'
  exit 0
fi

# ── stage 3 gate: the implementer must not still be mid-turn ─────────────────

VERDICT=$(fm_busy_classify_live "$BACKEND" "$TARGET" "$HARNESS" "$ID" "$STATE" "fm-$ID")
BUSY_STATE=${VERDICT%% *}
BUSY_SOURCE=${VERDICT#* }
case "$BUSY_STATE" in
  idle|dead) ;;
  busy)
    print_state "waiting=self-review-in-progress source=$BUSY_SOURCE"
    exit 0
    ;;
  *)
    echo "error: task $ID busy state is $BUSY_STATE ($BUSY_SOURCE); refusing to start the review while the implementer may still be committing" >&2
    exit 1
    ;;
esac

# ── stage 3: start the review session in the task's own worktree ─────────────

if [ -z "$WT" ] || [ ! -d "$WT" ]; then
  echo "error: task $ID records worktree '${WT:-<none>}', which is not an existing directory; the review must run there" >&2
  exit 1
fi

# LOCAL FORK: which window the review session lands in. Same config file as
# fm-spawn.sh's spawn_resolve_pane_window, so review routing stays configured in
# exactly one place:
#   1. $FM_REVIEW_WINDOW    environment override
#   2. config/pane-routes   "review: <window>", else the existing "scout: <window>"
#   3. built-in default     reviews
# `default:` is deliberately NOT consulted: it routes ordinary work to the
# workers window, which is precisely where a review must not go.
route_value() {  # <routes-file> <key>
  sed -n "s/^[[:space:]]*$2[[:space:]]*:[[:space:]]*\([A-Za-z0-9._-][A-Za-z0-9._-]*\).*/\1/p" "$1" 2>/dev/null | head -1
}

review_resolve_window() {
  local routes="$CONFIG/pane-routes" val
  if [ -n "${FM_REVIEW_WINDOW:-}" ]; then printf '%s\n' "$FM_REVIEW_WINDOW"; return 0; fi
  if [ -f "$routes" ]; then
    val=$(route_value "$routes" review)
    [ -n "$val" ] || val=$(route_value "$routes" scout)
    if [ -n "$val" ]; then printf '%s\n' "$val"; return 0; fi
  fi
  printf 'reviews\n'
}

# The review session's launch command. Deliberately NOT shared with
# fm-spawn.sh's launch_template: that template's whole payload is a brief file
# routed through the operational-input carrier, plus per-task turn-end wiring and
# extensions. A review session has none of those - it is a plain session taking
# one literal prompt - so what is reused here is only each adapter's verified
# binary and permission flag, and the shared effort mapping below.
review_effort_flag() {  # <harness> <effort>
  local harness=$1 effort=$2
  [ -n "$effort" ] && [ "$effort" != default ] || return 0
  case "$harness" in
    claude)
      case "$effort" in
        low|medium|high|xhigh|max) printf -- '--effort %s ' "$(shell_quote "$effort")" ;;
      esac
      ;;
    codex)
      case "$effort" in
        low|medium|high|xhigh) printf -- '-c %s ' "$(shell_quote "model_reasoning_effort=\"$effort\"")" ;;
      esac
      ;;
    grok)
      case "$effort" in
        low|medium|high) printf -- '--reasoning-effort %s ' "$(shell_quote "$effort")" ;;
      esac
      ;;
    pi|pi-signed)
      case "$effort" in
        low|medium|high|xhigh|max) printf -- '--thinking %s ' "$(shell_quote "$effort")" ;;
      esac
      ;;
  esac
}

# kimi is deliberately absent: it rejects a positional prompt and needs
# fm-spawn.sh's readiness gate plus a pointer submit, machinery a plain session
# has no business reproducing. An unsupported harness refuses cleanly below.
review_launch_command() {  # <harness> <effort>
  local harness=$1 effort=$2 flag prompt
  flag=$(review_effort_flag "$harness" "$effort")
  prompt=$(shell_quote "$REVIEW_PROMPT")
  case "$harness" in
    claude) printf '%s' "CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude --dangerously-skip-permissions ${flag}${prompt}" ;;
    codex) printf '%s' "codex ${flag}--dangerously-bypass-approvals-and-sandbox ${prompt}" ;;
    opencode) printf '%s' "OPENCODE_CONFIG_CONTENT='{\"permission\":{\"*\":\"allow\"}}' opencode --prompt ${prompt}" ;;
    pi|pi-signed) printf '%s' "$harness ${flag}${prompt}" ;;
    grok) printf '%s' "grok --always-approve ${flag}${prompt}" ;;
    *) return 1 ;;
  esac
}

REVIEW_HARNESS=$("$SCRIPT_DIR/fm-harness.sh" crew 2>/dev/null || true)
[ -n "$REVIEW_HARNESS" ] || REVIEW_HARNESS=$HARNESS
REVIEW_EFFORT=
if [ -f "$CONFIG/crew-effort" ]; then
  REVIEW_EFFORT=$(tr -d '[:space:]' < "$CONFIG/crew-effort" 2>/dev/null || true)
  case "$REVIEW_EFFORT" in
    low|medium|high|xhigh|max) ;;
    *) REVIEW_EFFORT= ;;
  esac
fi

LAUNCH=$(review_launch_command "$REVIEW_HARNESS" "$REVIEW_EFFORT") || {
  echo "error: no review launch command for harness '$REVIEW_HARNESS'; the implementing agent was left alive" >&2
  exit 1
}
# Same reason as fm-spawn.sh: the pane is created by a long-lived multiplexer
# process that does not inherit firstmate's environment, so a bare `claude` would
# fall back to the default store even when firstmate runs under a different one.
if [ "$REVIEW_HARNESS" = claude ] && [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  LAUNCH="CLAUDE_CONFIG_DIR=$(shell_quote "$CLAUDE_CONFIG_DIR") $LAUNCH"
fi

REVIEW_WINDOW=$(review_resolve_window)
REVIEW_LABEL="fm-$ID-review"
REVIEW_BACKEND=$BACKEND

fm_backend_source "$REVIEW_BACKEND" || {
  echo "error: backend '$REVIEW_BACKEND' could not be loaded; the implementing agent was left alive" >&2
  exit 1
}

# Only the two tmux adapters are wired for a review session. They are the ones
# whose create/send/kill primitives take a plain cwd and a window name, and the
# tmux-panes arm is the hand-verified path. herdr, zellij, orca, and cmux each
# bind a session to a workspace or an owned worktree, so a review session there
# needs its own verification before it is dispatched - refuse rather than guess
# (AGENTS.md section 4: never dispatch on an unverified adapter).
case "$REVIEW_BACKEND" in
  tmux)
    REVIEW_SESSION=$(fm_backend_tmux_container_ensure) || {
      echo "error: could not resolve the tmux session for task $ID's review; the implementing agent was left alive" >&2
      exit 1
    }
    REVIEW_TARGET=$(fm_backend_tmux_create_task "$REVIEW_SESSION" "$REVIEW_LABEL" "$WT") || {
      echo "error: could not create a review window for task $ID; the implementing agent was left alive" >&2
      exit 1
    }
    ;;
  tmux-panes)
    REVIEW_SESSION=$(fm_backend_tmux_panes_container_ensure) || {
      echo "error: could not resolve the tmux session for task $ID's review; the implementing agent was left alive" >&2
      exit 1
    }
    # The adapter refuses a duplicate pane title, so this is a second, independent
    # backstop against two review sessions for one task.
    REVIEW_TARGET=$(FM_PANE_WINDOW="$REVIEW_WINDOW" fm_backend_tmux_panes_create_task "$REVIEW_SESSION" "$REVIEW_LABEL" "$WT") || {
      echo "error: could not create a review pane for task $ID in window $REVIEW_WINDOW; the implementing agent was left alive" >&2
      exit 1
    }
    ;;
  *)
    echo "error: backend '$REVIEW_BACKEND' has no verified review-session launch; the implementing agent was left alive" >&2
    exit 1
    ;;
esac

review_send_literal() {  # <target> <text>
  case "$REVIEW_BACKEND" in
    tmux) fm_backend_tmux_send_literal "$1" "$2" ;;
    tmux-panes) fm_backend_tmux_panes_send_literal "$1" "$2" ;;
  esac
}
review_send_key() {  # <target> <key>
  case "$REVIEW_BACKEND" in
    tmux) fm_backend_tmux_send_key "$1" "$2" ;;
    tmux-panes) fm_backend_tmux_panes_send_key "$1" "$2" ;;
  esac
}

write_review_record() {  # <implementer-retired>
  record_write \
    "stage=$STAGE" \
    "self_review=$SELF_REVIEW" \
    "review_backend=$REVIEW_BACKEND" \
    "review_target=$REVIEW_TARGET" \
    "review_window=$REVIEW_WINDOW" \
    "review_label=$REVIEW_LABEL" \
    "implementer_retired=$1"
}

# Record the review session the moment its endpoint exists, BEFORE the prompt is
# delivered and before the implementer is retired. Ordering is load-bearing
# twice over: bin/fm-teardown.sh reads this record to refuse removing a worktree
# with a live review in it, so any failure after the endpoint exists must still
# leave a findable review session rather than an orphan pane no one knows about.
STAGE=reviewing
RETIRED=0
write_review_record "$RETIRED" || {
  echo "error: task $ID review session started at $REVIEW_TARGET but its record could not be written; the implementing agent was left alive" >&2
  exit 1
}

# Prove the new endpoint is addressable before typing into it. The adapters'
# send helpers probe internally but signal it only through `set -e`, which a
# conditional context suppresses - so the check has to be explicit here, or a
# launch could be reported as delivered to a pane that never took it.
if ! fm_backend_target_exists "$REVIEW_BACKEND" "$REVIEW_TARGET" "$REVIEW_LABEL" 2>/dev/null; then
  echo "error: task $ID review endpoint $REVIEW_TARGET is not addressable after creation; the implementing agent was left alive" >&2
  exit 1
fi
if ! review_send_literal "$REVIEW_TARGET" "$LAUNCH"; then
  echo "error: task $ID review session exists at $REVIEW_TARGET but its launch command could not be typed; the implementing agent was left alive" >&2
  exit 1
fi
sleep 0.3
if ! review_send_key "$REVIEW_TARGET" Enter; then
  echo "error: task $ID review session exists at $REVIEW_TARGET but its launch command could not be submitted; the implementing agent was left alive" >&2
  exit 1
fi

# ── stage 4: retire the implementing agent ───────────────────────────────────
# Session and pane only. Nothing here touches the worktree, the branch, or any
# uncommitted work - bin/fm-teardown.sh owns worktree removal and its
# landed-work test still governs it.

if [ -n "$TARGET" ] && [ "$BUSY_STATE" != dead ]; then
  fm_backend_kill "$BACKEND" "$TARGET" "$(fm_meta_get "$META" zellij_tab_id)" "fm-$ID" 2>/dev/null || true
fi
RETIRED=1
write_review_record "$RETIRED" || {
  echo "warning: task $ID implementer was retired but the record could not be updated" >&2
}

print_state "review_harness=$REVIEW_HARNESS" "worktree=$WT"
