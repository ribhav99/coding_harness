#!/usr/bin/env bash
# shellcheck shell=bash
# bin/backends/tmux-panes.sh - LOCAL FORK. tmux session provider that places each
# task as a PANE inside a routed window, instead of one window per task.
#
# Why this exists
# ---------------
# The stock tmux adapter gives every task its own tmux window, so watching four
# agents means cycling through four tabs one at a time. This adapter instead puts
# every task as a tiled pane inside a named window ("workers", "reviews", ...),
# so a whole tab of agents is visible at once - the layout this captain actually
# works in.
#
# Relationship to backends/tmux.sh
# --------------------------------
# This is deliberately NOT a copy. It sources the stock adapter and delegates
# every function whose behavior is unchanged, so upstream fixes to capture,
# submit, composer handling and liveness keep flowing through. Only three
# functions are reimplemented, because only three are window-shaped:
#
#   create_task   split a routed window instead of creating a new one
#   kill          kill-pane instead of kill-window
#   agent_state   pane-id membership instead of window-name membership
#
# Identity
# --------
# The stock adapter identifies a task by tmux window NAME (fm-<id>), and carries
# a workaround for it: window names can be renamed out from under you, so it pins
# automatic-rename and allow-rename off. Pane ids (%12) are server-unique and
# immutable for the pane's lifetime, so this adapter uses them directly and that
# whole class of problem disappears.
#
# Task metadata therefore records window=%<pane-id> rather than
# window=<session>:fm-<id>. fm_backend_validate_task_endpoint has a matching
# tmux-panes branch that binds identity through endpoint_task_id=, the same way
# the herdr, zellij and cmux adapters do.
#
# Routing
# -------
# The target window comes from FM_PANE_WINDOW, set by bin/fm-spawn.sh from its
# --window flag, config/pane-routes, or the task kind. This adapter does not
# decide routing; it only places the pane where it is told, defaulting to
# "workers" so it is never undefined.

# shellcheck source=bin/backends/tmux.sh
if [ -z "${_FM_BACKEND_TMUX_SOURCED:-}" ]; then
  . "$FM_BACKEND_LIB_DIR/backends/tmux.sh" || return 1
  _FM_BACKEND_TMUX_SOURCED=1
fi

FM_PANES_DEFAULT_WINDOW="${FM_PANES_DEFAULT_WINDOW:-workers}"

# ── delegated verbatim to the stock tmux adapter ──────────────────────────────
# These take a tmux target and behave identically whether that target names a
# window or a pane, so there is nothing to reimplement.
fm_backend_tmux_panes_capture()           { fm_backend_tmux_capture "$@"; }
fm_backend_tmux_panes_send_key()          { fm_backend_tmux_send_key "$@"; }
fm_backend_tmux_panes_send_text_submit()  { fm_backend_tmux_send_text_submit "$@"; }
fm_backend_tmux_panes_send_text_line()    { fm_backend_tmux_send_text_line "$@"; }
fm_backend_tmux_panes_send_literal()      { fm_backend_tmux_send_literal "$@"; }
fm_backend_tmux_panes_current_path()      { fm_backend_tmux_current_path "$@"; }
fm_backend_tmux_panes_current_command()   { fm_backend_tmux_current_command "$@"; }
fm_backend_tmux_panes_container_ensure()  { fm_backend_tmux_container_ensure "$@"; }

# ── selector ──────────────────────────────────────────────────────────────────
# A bare selector here is a pane id. Unlike a window name it is already unique
# server-wide, so there is no inventory search to do: just prove it exists.
fm_backend_tmux_panes_resolve_bare_selector() {  # <pane-id>
  local name=$1
  case "$name" in
    %[0-9]*) ;;
    *) echo "error: '$name' is not a tmux pane id" >&2; return 1 ;;
  esac
  tmux display-message -p -t "$name" '#{pane_id}' 2>/dev/null \
    || { echo "error: no pane $name" >&2; return 1; }
}

# ── window routing ────────────────────────────────────────────────────────────
# Ensure <session>:<window> exists, creating it detached if not. Prints nothing.
fm_backend_tmux_panes_window_ensure() {  # <session> <window>
  local ses=$1 win=$2
  tmux list-windows -t "$ses" -F '#{window_name}' 2>/dev/null | grep -qx "$win" && return 0
  tmux new-window -d -t "$ses:" -n "$win" || return 1
  tmux set-window-option -t "$ses:$win" automatic-rename off 2>/dev/null || true
  tmux set-window-option -t "$ses:$win" allow-rename off 2>/dev/null || true
  return 0
}

# The pane with the largest area, so a growing grid splits the roomiest cell
# rather than repeatedly slicing whichever pane happens to be active. Printed as
# a pane id. tmux has no "largest pane" selector, so compute it.
fm_backend_tmux_panes_largest() {  # <session> <window>
  tmux list-panes -t "$1:$2" -F '#{pane_width} #{pane_height} #{pane_id}' 2>/dev/null \
    | awk '{a=$1*$2; if (a>m) {m=a; p=$3}} END{if (p!="") print p}'
}

# True when <session>:<window> holds exactly one pane and that pane is the
# placeholder shell a freshly created window starts with - not a task.
#
# The first task placed in such a window should REPLACE the placeholder rather
# than tile beside it, or every worker tab permanently carries a dead shell.
#
# The TITLE test is the load-bearing one, and it is not optional. Testing only
# "one pane, running a shell" is unsafe and was an actual bug here: a task pane
# whose agent has not finished launching still reports a shell as its foreground
# command, so the second task into a window would classify the FIRST task's live
# pane as a placeholder and kill it. Every pane this adapter creates is titled
# fm-<id>, so requiring a non-fm- title makes a task pane unmatchable regardless
# of what it happens to be running at that instant.
#
# Both conditions must hold, and anything unreadable or unrecognized means "not a
# placeholder", so the failure mode is a spare shell pane rather than a killed
# agent.
fm_backend_tmux_panes_only_idle_shell() {  # <session> <window>
  local ses=$1 win=$2 panes title comm
  panes=$(tmux list-panes -t "$ses:$win" -F '#{pane_id}' 2>/dev/null) || return 1
  [ "$(printf '%s\n' "$panes" | grep -c .)" = 1 ] || return 1

  title=$(tmux display-message -p -t "$ses:$win" '#{pane_title}' 2>/dev/null) || return 1
  case "$title" in
    fm-*) return 1 ;;   # a task pane; never a placeholder
  esac

  comm=$(tmux display-message -p -t "$ses:$win" '#{pane_current_command}' 2>/dev/null) || return 1
  comm=${comm#-}
  case "$comm" in
    zsh|bash|sh|dash|ash|ksh|mksh|tcsh|csh|fish) return 0 ;;
    *) return 1 ;;
  esac
}

# ── create ────────────────────────────────────────────────────────────────────
# Create the task's PANE in <cwd>, inside the routed window, and print its stable
# pane id. Refuses if a pane already carries this task's title, which is the
# pane-world equivalent of the stock adapter's duplicate-window check.
fm_backend_tmux_panes_create_task() {  # <session> <task-label> <cwd> -> prints pane id
  local ses=$1 label=$2 cwd=$3
  local win="${FM_PANE_WINDOW:-$FM_PANES_DEFAULT_WINDOW}" target pane placeholder=0

  case "$win" in
    ''|*[!A-Za-z0-9._-]*) echo "error: invalid pane window name '$win'" >&2; return 1 ;;
  esac

  fm_backend_tmux_panes_window_ensure "$ses" "$win" || {
    echo "error: could not create window $ses:$win" >&2
    return 1
  }

  if tmux list-panes -s -t "$ses" -F '#{pane_title}' 2>/dev/null | grep -qx "$label"; then
    echo "error: a pane titled $label already exists in session $ses" >&2
    return 1
  fi

  fm_backend_tmux_panes_only_idle_shell "$ses" "$win" && placeholder=1

  target=$(fm_backend_tmux_panes_largest "$ses" "$win")
  [ -n "$target" ] || target="$ses:$win"

  pane=$(tmux split-window -dP -F '#{pane_id}' -t "$target" -c "$cwd") || return 1

  # Title the pane so a tiled grid is readable: ~/.tmux.conf renders pane_title
  # in the border. Without this every agent looks identical.
  tmux select-pane -t "$pane" -T "$label" 2>/dev/null || true

  # Replace the placeholder shell only AFTER the task pane exists, so a failure
  # above never leaves the window empty.
  if [ "$placeholder" = 1 ]; then
    tmux list-panes -t "$ses:$win" -F '#{pane_id}' 2>/dev/null \
      | grep -vx "$pane" \
      | while IFS= read -r old; do
          [ -n "$old" ] && tmux kill-pane -t "$old" 2>/dev/null || true
        done
  fi

  tmux select-layout -t "$ses:$win" tiled >/dev/null 2>&1 || true
  printf '%s\n' "$pane"
}

# ── kill ──────────────────────────────────────────────────────────────────────
# Remove one task pane, then re-tile so the survivors reflow into an even grid
# instead of leaving a hole. Empty/malformed targets return non-zero BEFORE
# calling tmux, so tmux can never interpret an empty target as the caller's own
# current pane - the same safety rule as the stock adapter's kill.
fm_backend_tmux_panes_kill() {  # <pane-id>
  local target=${1:-} win
  case "$target" in
    %[0-9]*) ;;
    *) return 1 ;;
  esac
  win=$(tmux display-message -p -t "$target" '#{session_name}:#{window_name}' 2>/dev/null || true)
  tmux kill-pane -t "$target" 2>/dev/null || true
  [ -n "$win" ] && tmux select-layout -t "$win" tiled >/dev/null 2>&1
  return 0
}

# ── liveness ──────────────────────────────────────────────────────────────────
# Recovery-grade agent state for one recorded pane. Same vocabulary and the same
# fail-safe posture as the stock adapter: only `dead` and `missing` authorize
# recovery, because a false dead result could launch a duplicate agent.
#
# The membership proof is simpler and stronger here. The stock adapter must first
# prove the recorded window NAME appears in a successful session inventory,
# because tmux silently falls back to the active window when a named target is
# absent. A pane id cannot be re-pointed that way: it either exists server-wide
# or it does not, so a server-wide pane listing is the whole check.
fm_backend_tmux_panes_agent_state() {  # <pane-id>
  local target=$1 comm panes inventory_status
  case "$target" in
    %[0-9]*) ;;
    *) printf 'unreadable'; return 0 ;;
  esac

  if panes=$(LC_ALL=C tmux list-panes -a -F '#{pane_id}' 2>&1); then
    inventory_status=0
  else
    inventory_status=$?
  fi
  if [ "$inventory_status" -ne 0 ]; then
    case "$panes" in
      *"no server running on "*|*"error connecting to "*" (No such file or directory)"|*"error connecting to "*" (Connection refused)")
        printf 'missing' ;;
      *) printf 'unreadable' ;;
    esac
    return 0
  fi
  if ! printf '%s\n' "$panes" | grep -Fqx "$target"; then
    printf 'missing'
    return 0
  fi

  comm=$(fm_backend_tmux_current_command "$target") || { printf 'unreadable'; return 0; }
  comm=${comm#-}
  case "$comm" in
    *claude*|*codex*|*opencode*|*grok*|*kimi*|pi|pi-signed|pi-launcher|Pi) printf 'alive' ;;
    zsh|bash|sh|dash|ash|ksh|mksh|tcsh|csh|fish) printf 'dead' ;;
    '') printf 'unreadable' ;;
    *) printf 'ambiguous' ;;
  esac
}

fm_backend_tmux_panes_agent_alive() {  # <pane-id>
  case "$(fm_backend_tmux_panes_agent_state "$1")" in
    alive) printf 'alive' ;;
    dead|missing) printf 'dead' ;;
    *) printf 'unknown' ;;
  esac
}
