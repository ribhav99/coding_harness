#!/usr/bin/env bash
# Send one line of literal text to a crewmate endpoint, then Enter.
#   <target> may be an exact task id, a legacy fm-<id> task label resolved
#   through this home's state/<id>.meta, or an explicit well-formed backend
#   target. fm-send refuses unresolved guesses rather than falling back to a
#   tmux window search, because a "successful" send to the wrong endpoint is
#   worse than a loud failure.
# Usage: fm-send.sh <target> --why <captain|handoff|answer> <text...>
#        fm-send.sh <target> --key Enter    special key instead of text
# Key support is backend-specific: tmux supports Escape, Enter, and C-c.
#
# Text submission is verified: the line is typed ONCE, then Enter is sent and
# retried (Enter only, never retyped) until the target backend confirms a
# submit or reports an inconclusive send. If a swallowed Enter is positively
# confirmed, fm-send exits NON-ZERO so the caller knows the steer did not land
# instead of silently leaving an unsubmitted instruction.
# Submission dispatches through the target's recorded backend; the tmux adapter
# shares its composer/submit core with the away-mode daemon via bin/fm-tmux-lib.sh.
# Tune with FM_SEND_RETRIES (default 3) / FM_SEND_SLEEP (0.4).
# Slash commands get a longer pre-Enter settle so completion popups do not
# swallow Enter.
#
# Justification (--why): firstmate may steer a worker only in the three cases
# AGENTS.md section 7 lists, so every text send must name which one it is.
#   --why captain  the captain asked for this exact steer
#   --why handoff  the completion handoff in AGENTS.md section 7
#   --why answer   answering a needs-decision:/blocked: the worker itself raised
# A send with no --why is refused. --why answer is CHECKED: it needs an open,
# unresolved keyed decision in that task's status log (bin/fm-classify-lib.sh's
# status_open_decisions). captain and handoff are not checkable - a hook cannot
# read the captain's intent - but a flag firstmate must consciously choose is
# far stronger than prose, and every send is recorded to state/<id>.steers
# (task id, timestamp, justification, first 80 characters of the message) so a
# drift pattern is visible afterwards rather than invisible. The --key path
# below carries no justification: a key press is an adapter operation (a trust
# dialog, an interrupt), not a message steer.
#
# After a successful text submit fm-send pauses FM_SEND_SETTLE seconds (default 1,
# 0 disables) before returning: submit confirmation only proves the text was
# accepted, but the harness needs a beat to spin up the turn before its busy
# footer appears, so an immediate peek would otherwise see the stale idle pane.
# The pause is fm-send-only; the shared submit core (used by the away-mode daemon,
# which only needs "submitted") does not pay it, and the --key path is unaffected.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# shellcheck source=bin/fm-gate-refuse-lib.sh
. "$SCRIPT_DIR/fm-gate-refuse-lib.sh"
# Fail closed before any fleet mutation: a no-mistakes gate agent must never steer
# a crewmate (see bin/fm-gate-refuse-lib.sh).
fm_refuse_if_gate_agent

if [ -z "${FM_HOME+x}" ] || [ -z "${FM_HOME:-}" ]; then
  echo "error: FM_HOME is not set; fm-send refuses to resolve targets without an explicit firstmate home" >&2
  exit 1
fi

STATE="${FM_STATE_OVERRIDE:-$FM_HOME/state}"
if [ ! -d "$FM_HOME" ]; then
  echo "error: FM_HOME '$FM_HOME' is not a directory; fm-send cannot resolve this home's state" >&2
  exit 1
fi
if [ ! -d "$STATE" ]; then
  echo "error: state dir '$STATE' is missing; fm-send cannot resolve targets for FM_HOME '$FM_HOME'" >&2
  exit 1
fi

# shellcheck source=bin/fm-backend.sh
. "$SCRIPT_DIR/fm-backend.sh"
# shellcheck source=bin/fm-classify-lib.sh
. "$SCRIPT_DIR/fm-classify-lib.sh"

FM_GUARD_CONTINUE_LINE='This is a supervision warning only; the requested message WILL still be sent.' "$SCRIPT_DIR/fm-guard.sh" || true

fm_send_id_from_meta() {  # <meta-file>
  local base
  base=${1##*/}
  printf '%s' "${base%.meta}"
}

fm_send_record_interrupt() {  # <key>
  local key=$1 id gen
  [ "$key" = Escape ] || return 0
  case "$TARGET_HARNESS" in claude*) : ;; *) return 0 ;; esac
  [ -n "$TARGET_META" ] || return 0
  id=$(fm_send_id_from_meta "$TARGET_META")
  [ -f "$STATE/$id.busy-gen" ] || return 0
  gen=$(fm_meta_get "$TARGET_META" busy_gen)
  if [ -n "$gen" ]; then
    "$FM_ROOT/bin/fm-busy-event.sh" apply "$STATE" "$id" idle \
      --gen "$gen" --source fm-interrupt --event interrupt
  else
    "$FM_ROOT/bin/fm-busy-event.sh" apply "$STATE" "$id" idle \
      --current-gen --source fm-interrupt --event interrupt
  fi || {
    echo "error: key '$key' reached $T, but the Claude interrupt state could not be recorded for $id" >&2
    return 1
  }
}

fm_send_resolve_target() {  # <raw-target>
  local raw=$1 meta target backend

  RESOLVED_TARGET=""
  TARGET_BACKEND=""
  TARGET_HARNESS=""
  EXPECTED_LABEL=""
  TARGET_META=""
  TARGET_SELECTOR=""
  RESOLUTION_TRIED=""

  meta=$(fm_backend_meta_for_selector "$raw" "$STATE" 2>/dev/null || true)
  if [ -n "$meta" ]; then
    RESOLUTION_TRIED="meta=$meta; backend=from-meta"
    target=$(fm_backend_target_of_meta "$meta")
    if [ -z "$target" ]; then
      echo "error: no backend target recorded in $meta (tried $RESOLUTION_TRIED)" >&2
      return 1
    fi
    backend=$(fm_backend_of_meta "$meta")
    RESOLVED_TARGET=$target
    TARGET_BACKEND=$backend
    TARGET_META=$meta
    TARGET_HARNESS=$(fm_meta_get "$meta" harness)
    EXPECTED_LABEL=$(fm_backend_expected_label_of_selector "$raw" "$STATE")
    TARGET_SELECTOR=1
    return 0
  fi

  case "$raw" in
    fm-*)
      RESOLUTION_TRIED="meta=$STATE/$raw.meta; legacy-meta=$STATE/${raw#fm-}.meta; backend=none"
      echo "error: no metadata for $raw in $STATE (tried $RESOLUTION_TRIED); pass a well-formed explicit backend target only when targeting outside this firstmate home" >&2
      return 1
      ;;
  esac

  meta=$(fm_backend_meta_for_window "$raw" "$STATE" 2>/dev/null || true)
  if [ -n "$meta" ]; then
    target=$(fm_backend_target_of_meta "$meta")
    if [ -z "$target" ]; then
      echo "error: no backend target recorded in $meta (tried explicit target '$raw' via recorded window/terminal; backend=from-meta)" >&2
      return 1
    fi
    RESOLVED_TARGET=$target
    TARGET_BACKEND=$(fm_backend_of_meta "$meta")
    TARGET_META=$meta
    TARGET_HARNESS=$(fm_meta_get "$meta" harness)
    RESOLUTION_TRIED="explicit target '$raw' matched $meta; backend=$TARGET_BACKEND"
    return 0
  fi

  case "$raw" in
    *:*)
      if ! fm_backend_target_exists tmux "$raw"; then
        echo "error: explicit target '$raw' is not a live tmux endpoint (tried meta=$STATE/$raw.meta; metadata window/terminal lookup; backend=tmux). Use fm-<id> for a recorded task, or pass a target whose backend endpoint can be verified." >&2
        return 1
      fi
      RESOLVED_TARGET=$raw
      TARGET_BACKEND=tmux
      RESOLUTION_TRIED="meta=$STATE/$raw.meta; metadata window/terminal lookup; backend=tmux; endpoint=verified"
      return 0
      ;;
  esac

  echo "error: target '$raw' is not resolvable (tried meta=$STATE/$raw.meta; metadata window/terminal lookup; backend=none). Use fm-$raw for a recorded task/lane, or pass a well-formed explicit backend target such as session:window." >&2
  return 1
}

RAW_TARGET=$1
fm_send_resolve_target "$RAW_TARGET" || exit 1
T=$RESOLVED_TARGET
shift

fm_backend_validate "$TARGET_BACKEND" || exit 1

TARGET_TASK_ID=
if [ -n "$TARGET_SELECTOR" ] && [ -n "$TARGET_META" ]; then
  TARGET_TASK_ID=$(fm_send_id_from_meta "$TARGET_META")
fi

# Append one steer-ledger line. Keyed by task id when one resolves; an explicit
# backend target outside this home has none, so those land in state/.steers with
# the raw target in its place - the record must exist either way.
fm_send_record_steer() {  # <why> <message>
  local why=$1 message=$2 ledger subject
  if [ -n "$TARGET_TASK_ID" ]; then
    ledger="$STATE/$TARGET_TASK_ID.steers"
    subject=$TARGET_TASK_ID
  else
    ledger="$STATE/.steers"
    subject=$RESOLVED_TARGET
  fi
  printf '%s\t%s\t%s\t%s\n' "$subject" "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$why" \
    "$(printf '%s' "$message" | cut -c1-80)" >> "$ledger"
}

# The target's BACKEND comes from selector meta, from matching an explicit target
# back to recorded meta, or from strict explicit-target shape validation.
# Do not add a separate passive liveness preflight here: the active send path
# owns backend readiness. A failed backend send is still surfaced below as a hard
# error with the attempted resolution attached.

if [ "${1:-}" = "--key" ]; then
  if ! fm_backend_send_key "$TARGET_BACKEND" "$T" "$2" "$EXPECTED_LABEL"; then
    echo "error: key '$2' not sent to $T ($TARGET_BACKEND send failed; tried $RESOLUTION_TRIED)" >&2
    exit 1
  fi
  fm_send_record_interrupt "$2" || exit 1
else
  if [ "${1:-}" != "--why" ]; then
    echo "error: fm-send refuses a steer with no justification; pass --why captain|handoff|answer before the message (AGENTS.md section 7 owns when firstmate may steer a worker)" >&2
    exit 1
  fi
  WHY=${2:-}
  case "$WHY" in
    captain|handoff|answer) ;;
    '') echo "error: --why requires a value: captain, handoff, or answer" >&2; exit 1 ;;
    *) echo "error: unknown --why '$WHY'; expected captain, handoff, or answer" >&2; exit 1 ;;
  esac
  shift 2
  if [ "$WHY" = answer ]; then
    if [ -z "$TARGET_TASK_ID" ]; then
      echo "error: --why answer needs a task selector whose status log can be read; '$RAW_TARGET' resolved to no task in this home" >&2
      exit 1
    fi
    if [ -z "$(status_open_decisions "$STATE/$TARGET_TASK_ID.status")" ]; then
      echo "error: --why answer refused: task $TARGET_TASK_ID has no open needs-decision: or blocked: line to answer (an earlier one was resolved, or none was ever raised)" >&2
      exit 1
    fi
  fi
  [ "$#" -gt 0 ] || { echo "error: --why $WHY still needs a message to send" >&2; exit 1; }
  MESSAGE=$*
  # A slash command opens a completion popup; submitting too fast selects
  # nothing, so give the popup time to settle before the (retried) Enter. The
  # backend's verified submit retry still backs the settle up either way.
  case "$MESSAGE" in
    /*) settle=1.2 ;;
    *) settle=0.3 ;;
  esac
  retries=${FM_SEND_RETRIES:-3}
  sleep_s=${FM_SEND_SLEEP:-0.4}
  # Type once, submit, verify. Only exact empty confirms delivery; every other
  # verdict preserves the loud refusal boundary.
  if ! verdict=$(fm_backend_send_text_submit "$TARGET_BACKEND" "$T" "$MESSAGE" "$retries" "$sleep_s" "$settle" "$EXPECTED_LABEL"); then
    echo "error: text not sent to $T ($TARGET_BACKEND send failed; tried $RESOLUTION_TRIED)" >&2
    exit 1
  fi
  case "$verdict" in
    empty)
      ;;
    send-failed)
      echo "error: text not sent to $T ($TARGET_BACKEND send failed; tried $RESOLUTION_TRIED)" >&2
      exit 1
      ;;
    *)
      echo "error: text not submitted to $T (delivery unconfirmed; verdict=${verdict:-unknown}; tried $RESOLUTION_TRIED)" >&2
      exit 1
      ;;
  esac
  # Delivery confirmed: record the steer before returning, so the ledger reflects
  # what actually landed rather than what was attempted.
  fm_send_record_steer "$WHY" "$MESSAGE"
  # Submit landed with exact empty. Confirmation only proves the text was
  # accepted; the harness still needs a beat to spin up the
  # turn before its busy footer shows. Pause so an immediate peek catches the
  # crewmate actually working instead of the stale idle pane. FM_SEND_SETTLE=0
  # disables it. Scoped to this path only, never the shared submit core.
  [ "${FM_SEND_SETTLE:-1}" = 0 ] || sleep "${FM_SEND_SETTLE:-1}"
fi
