#!/usr/bin/env bash
# Spawn a crewmate in a per-task git worktree (LOCAL FORK: was a treehouse pool
# worktree; see bin/fm-worktree.sh).
# Usage: fm-spawn.sh <task-id> <project-dir> [--harness <name>|harness|launch-command] [--model <name>] [--effort <level>] [--backend <name>] [--scout]
#   --harness <name> is the explicit per-spawn harness adapter. The old
#   positional harness arg still works for back-compat.
#   --model <name> and --effort <low|medium|high|xhigh|max> are concrete profile
#   axes chosen by firstmate at intake. They are only threaded into harnesses whose
#   installed CLIs were verified to support that axis; unsupported axes are omitted
#   from that harness's launch rather than guessed.
#   --backend <name> is the explicit runtime session-provider backend for this
#   exact task only. Without it, the script resolves FM_BACKEND, then
#   config/backend, then runtime auto-detection ($TMUX), then tmux. The
#   spawn-capable backends are tmux and the tmux-panes local fork. Default tmux
#   spawns do not write backend= to meta; absent backend= means tmux.
#   A backend spawn refusal (missing dependency or version gate) is terminal for
#   that selected backend; callers must surface it instead of silently retrying.
#   Every single-task invocation holds one task-id-scoped lock across backend
#   creation through metadata publication, so concurrent same-id spawns serialize.
#   With no harness arg, the spawn resolves the CREW harness (config/crew-harness,
#   else detection). A bare adapter name (claude) overrides it for this spawn. A
#   non-flag string containing whitespace is treated as a RAW launch command - the
#   escape hatch for verifying new adapters.
#   --scout records kind=scout in the task's meta (report deliverable, scratch worktree;
#   see AGENTS.md task lifecycle); the default is kind=ship.
#   Spawns refuse to launch unless the resolved task path is a real git worktree
#   root distinct from the primary project checkout.
# Batch dispatch: pass one or more `id=repo` pairs instead of a single <id> <project>, e.g.
#     fm-spawn.sh fix-a-k3=projects/foo add-b-q7=projects/bar [--scout]
#   Each pair re-execs this script in single-task mode, so the single path stays the only
#   source of truth; shared --scout/--harness/--model/--effort/--backend applies to every pair.
#   The loop lives here, in bash, so callers never hand-write a multi-task shell loop
#   (the tool shell is zsh, which does not word-split unquoted $vars and silently
#   breaks ad-hoc `for ... in $pairs` loops).
#   Launch templates live in launch_template() below; placeholders replaced before launch:
#     __BRIEF__    absolute path to data/<task-id>/brief.md
#     __TURNEND__  absolute path to state/<task-id>.turn-ended
#     __OPINPUT__  absolute path to the canonical operational-input encoder
# On success prints: spawned <id> harness=<name> kind=<ship|scout> mode=<mode> yolo=<on|off> window=<backend-target> worktree=<path>
# mode/yolo are resolved per-project from data/projects.md.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  # The whole leading comment block, ending at the first line that is not a
  # comment. Derived rather than a fixed line range, which silently truncated
  # this help mid-sentence every time the header above grew.
  sed -n '2,${/^#/!q;p;}' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"

resolve_directory_input() {
  local name=$1 path=$2 resolved
  case "$path" in
    /*) printf '%s\n' "$path"; return 0 ;;
  esac
  resolved=$(CDPATH='' cd -- "$path" 2>/dev/null && pwd -P) || {
    echo "error: $name directory cannot be resolved: $path" >&2
    return 1
  }
  printf '%s\n' "$resolved"
}

FM_HOME=$(resolve_directory_input FM_HOME "$FM_HOME") || exit 1
if [ -n "${FM_STATE_OVERRIDE:-}" ]; then
  FM_STATE_OVERRIDE=$(resolve_directory_input FM_STATE_OVERRIDE "$FM_STATE_OVERRIDE") || exit 1
fi
if [ -n "${FM_DATA_OVERRIDE:-}" ]; then
  FM_DATA_OVERRIDE=$(resolve_directory_input FM_DATA_OVERRIDE "$FM_DATA_OVERRIDE") || exit 1
fi
STATE="${FM_STATE_OVERRIDE:-$FM_HOME/state}"
DATA="${FM_DATA_OVERRIDE:-$FM_HOME/data}"
PROJECTS="${FM_PROJECTS_OVERRIDE:-$FM_HOME/projects}"
CONFIG="${FM_CONFIG_OVERRIDE:-$FM_HOME/config}"
# shellcheck source=bin/fm-ff-lib.sh
. "$SCRIPT_DIR/fm-ff-lib.sh"
# shellcheck source=bin/fm-wake-lib.sh
. "$SCRIPT_DIR/fm-wake-lib.sh"
# shellcheck source=bin/fm-backend.sh
. "$SCRIPT_DIR/fm-backend.sh"
# shellcheck source=bin/fm-gate-refuse-lib.sh
. "$SCRIPT_DIR/fm-gate-refuse-lib.sh"
# shellcheck source=bin/fm-busy-lib.sh
. "$SCRIPT_DIR/fm-busy-lib.sh"
# shellcheck source=bin/fm-pr-lib.sh
. "$SCRIPT_DIR/fm-pr-lib.sh"
# LOCAL FORK: the task worktree provider that replaces treehouse.
# shellcheck source=bin/fm-worktree.sh
. "$SCRIPT_DIR/fm-worktree.sh"
# Fail closed before any fleet mutation: a no-mistakes gate agent must never spawn
# a direct report (see bin/fm-gate-refuse-lib.sh).
fm_refuse_if_gate_agent
# Skip the watcher guard when re-exec'd for one pair of a batch (FM_SPAWN_NO_GUARD is
# set by the batch loop below), so the guard runs once for the batch, not once per pair.
[ -n "${FM_SPAWN_NO_GUARD:-}" ] || "$FM_ROOT/bin/fm-guard.sh" || true
KIND=ship
HARNESS_ARG=
MODEL=
EFFORT=
BACKEND_ARG=
HARNESS_SET=0
MODEL_SET=0
EFFORT_SET=0
BACKEND_SET=0
POS=()
want_value=
for a in "$@"; do
  if [ -n "$want_value" ]; then
    case "$a" in
      --*) echo "error: --$want_value requires a value" >&2; exit 1 ;;
    esac
    case "$want_value" in
      harness) HARNESS_ARG=$a; HARNESS_SET=1 ;;
      model) MODEL=$a; MODEL_SET=1 ;;
      effort) EFFORT=$a; EFFORT_SET=1 ;;
      backend) BACKEND_ARG=$a; BACKEND_SET=1 ;;
      window) PANE_WINDOW_FLAG=$a ;;   # LOCAL FORK
      *) echo "error: internal parser state for --$want_value" >&2; exit 1 ;;
    esac
    want_value=
    continue
  fi
  case "$a" in
    --scout) KIND=scout ;;
    --harness) want_value=harness ;;
    --harness=*) HARNESS_ARG=${a#--harness=}; HARNESS_SET=1 ;;
    --model) want_value=model ;;
    --model=*) MODEL=${a#--model=}; MODEL_SET=1 ;;
    --effort) want_value=effort ;;
    --effort=*) EFFORT=${a#--effort=}; EFFORT_SET=1 ;;
    --backend) want_value=backend ;;
    --backend=*) BACKEND_ARG=${a#--backend=}; BACKEND_SET=1 ;;
    # LOCAL FORK: which tab this task's pane lands in (backend=tmux-panes only).
    --window) want_value=window ;;
    --window=*) PANE_WINDOW_FLAG=${a#--window=} ;;
    *) POS+=("$a") ;;
  esac
done
[ -z "$want_value" ] || { echo "error: --$want_value requires a value" >&2; exit 1; }
[ "$HARNESS_SET" -eq 0 ] || [ -n "$HARNESS_ARG" ] || { echo "error: --harness requires a non-empty value" >&2; exit 1; }
[ "$MODEL_SET" -eq 0 ] || [ -n "$MODEL" ] || { echo "error: --model requires a non-empty value" >&2; exit 1; }
[ "$EFFORT_SET" -eq 0 ] || [ -n "$EFFORT" ] || { echo "error: --effort requires a non-empty value" >&2; exit 1; }
[ "$BACKEND_SET" -eq 0 ] || [ -n "$BACKEND_ARG" ] || { echo "error: --backend requires a non-empty value" >&2; exit 1; }
case "$EFFORT" in
  ''|low|medium|high|xhigh|max) ;;
  *) echo "error: --effort must be one of low, medium, high, xhigh, max" >&2; exit 1 ;;
esac

# Backend selection (data/fm-backend-design-d7): explicit --backend, else
# FM_BACKEND env, else config/backend, else runtime auto-detection, else
# default tmux (fm_backend_name). fm_backend_validate_spawn refuses unknown or
# non-spawn-capable backends. The resolved value is
# recorded in meta only when it is NOT tmux (fm-teardown.sh and fm-watch.sh's
# window_backend/fm_backend_of_meta already treat an absent backend= as tmux),
# so the default path's meta stays byte-identical.
if [ "$BACKEND_SET" -eq 1 ]; then
  BACKEND=$BACKEND_ARG
else
  BACKEND=$(fm_backend_name)
fi
fm_backend_validate_spawn "$BACKEND" || exit 1
fm_backend_source "$BACKEND" || exit 1
# LOCAL FORK: armed after fm_worktree_create, disarmed after the meta write.
WORKTREE_ABORT_CLEANUP=0
SPAWN_TASK_LOCK=
SPAWN_TASK_LOCK=
SPAWN_TASK_LOCK_HELD=0

spawn_abort_cleanup() {
  local status=$?
  # LOCAL FORK: remove a task worktree created by fm_worktree_create when the
  # spawn aborts before publishing task metadata. Flag-gated, so a SUCCESSFUL
  # spawn never reaches this.
  if [ "${WORKTREE_ABORT_CLEANUP:-0}" = 1 ]; then
    WORKTREE_ABORT_CLEANUP=0
    if [ -n "${WT:-}" ] && [ -n "${PROJ_ABS:-}" ]; then
      fm_worktree_remove "$WT" "$PROJ_ABS" >/dev/null 2>&1 || true
    fi
  fi
  if [ "$SPAWN_TASK_LOCK_HELD" = 1 ]; then
    SPAWN_TASK_LOCK_HELD=0
    fm_lock_release "$SPAWN_TASK_LOCK" || true
  fi
  return "$status"
}
trap spawn_abort_cleanup EXIT

# Batch dispatch (see header): when the first positional is an `id=repo` pair, treat every
# positional as one and spawn each by re-execing this script in single-task mode. We use
# the FM_ROOT path (not $0) so it works whatever cwd or relative path invoked us, and reuse
# the single path verbatim. A failed pair is reported and skipped; the rest still launch;
# exit is non-zero if any pair failed. Single-task invocations never carry an '=' in arg
# one (task ids are bare slugs), so they fall straight through to the logic below.
idpart=${POS[0]:-}
idpart=${idpart%%=*}
if [ "${#POS[@]}" -gt 0 ] && [ "${POS[0]}" != "$idpart" ] && case "$idpart" in */*) false ;; *) true ;; esac; then
  rc=0
  shared_args=()
  [ -z "$HARNESS_ARG" ] || shared_args+=(--harness "$HARNESS_ARG")
  [ -z "$MODEL" ] || shared_args+=(--model "$MODEL")
  [ -z "$EFFORT" ] || shared_args+=(--effort "$EFFORT")
  [ -z "$BACKEND_ARG" ] || shared_args+=(--backend "$BACKEND_ARG")
  for pair in "${POS[@]}"; do
    case "$pair" in
      *=*) : ;;
      *) echo "error: batch dispatch expects every argument as id=repo; got '$pair'" >&2; rc=2; continue ;;
    esac
    if [ "$KIND" = scout ]; then
      if FM_SPAWN_NO_GUARD=1 "$FM_ROOT/bin/fm-spawn.sh" "${pair%%=*}" "${pair#*=}" "${shared_args[@]+"${shared_args[@]}"}" --scout; then :; else echo "batch: FAILED to spawn ${pair%%=*} (${pair#*=})" >&2; rc=1; fi
    else
      if FM_SPAWN_NO_GUARD=1 "$FM_ROOT/bin/fm-spawn.sh" "${pair%%=*}" "${pair#*=}" "${shared_args[@]+"${shared_args[@]}"}"; then :; else echo "batch: FAILED to spawn ${pair%%=*} (${pair#*=})" >&2; rc=1; fi
    fi
  done
  exit "$rc"
fi
ID=${POS[0]}
fm_task_id_creation_valid "$ID" || { echo "error: invalid task id" >&2; exit 2; }
SPAWN_TASK_LOCK="$STATE/.spawn-$ID.lock"
if ! fm_lock_try_acquire "$SPAWN_TASK_LOCK"; then
  echo "error: another spawn is already creating task $ID" >&2
  exit 1
fi
SPAWN_TASK_LOCK_HELD=1
PROJ=${POS[1]}
ARG3=${POS[2]:-}
[ -z "$HARNESS_ARG" ] || ARG3=$HARNESS_ARG

# The verified launch command per adapter. The knowledge half of each adapter
# (busy-state source, exit command, dialogs, quirks) lives in the harness-adapters skill.
launch_template() {
  local harness=$1
  # shellcheck disable=SC2016  # single quotes are deliberate: $(cat ...) expands in the crewmate pane, not here
  case "$harness" in
    # CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false disables claude's interactive
    # predicted-next-prompt ghost text, which renders as dim/faint text inside an
    # otherwise-empty composer and would otherwise read like real typed input when
    # firstmate captures the pane (see the harness-adapters skill). It is a per-launch env
    # prefix scoped to this firstmate-launched agent; it never touches the captain's
    # global config. The CLI's --prompt-suggestions flag is print/SDK-mode only and
    # does NOT suppress the interactive ghost text (verified empirically), so the env
    # var is the correct control. The dim-aware composer reader in fm-tmux-lib.sh is
    # the defense-in-depth backstop for any pane this flag cannot reach.
    claude) printf '%s' 'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude --dangerously-skip-permissions __MODELFLAG____EFFORTFLAG__"$(__OPINPUT__ encode launch-brief < __BRIEF__)"' ;;
    *) return 1 ;;
  esac
}

case "$ARG3" in
  *' '*)  # raw launch command (unverified-adapter escape hatch)
    LAUNCH=$ARG3
    HARNESS=""
    for word in $LAUNCH; do
      case "$word" in [A-Za-z_]*=*) continue ;; *) HARNESS=$(basename "$word"); break ;; esac
    done
    ;;
  '')
    # No explicit harness: resolve from config/crew-harness, else detection. The
    # launch_template lookup below is the unverified-adapter guard: a harness with
    # no template aborts the spawn.
    HARNESS=$("$FM_ROOT/bin/fm-harness.sh" crew)
    LAUNCH=$(launch_template "$HARNESS") || { echo "error: no launch template for harness '$HARNESS' (from config/crew-harness or detection); pass a raw launch command to use an unverified adapter" >&2; exit 1; }
    ;;
  *)
    HARNESS=$ARG3
    LAUNCH=$(launch_template "$HARNESS") || { echo "error: unknown harness '$HARNESS'; pass a raw launch command to use an unverified adapter" >&2; exit 1; }
    ;;
esac

# LOCAL FORK: standing crewmate/scout effort floor from config/crew-effort.
#
# Upstream chooses crew effort per task at intake (AGENTS.md section 4), whose
# generic fallback explicitly says "never max without explicit captain
# preference". This captain HAS stated that preference, and stated it as
# "always" -- so it belongs in a config file the code reads on every spawn,
# not in a prompt that a future session could forget or reason its way out of.
#
# An explicit --effort still wins, so firstmate can go lower for a task where
# that is genuinely right; it just cannot silently omit the axis.
if [ "$EFFORT_SET" -eq 0 ] && [ -f "$CONFIG/crew-effort" ]; then
  CREW_EFFORT=$(tr -d '[:space:]' < "$CONFIG/crew-effort" 2>/dev/null || true)
  if [ -n "$CREW_EFFORT" ]; then
    case "$CREW_EFFORT" in
      low|medium|high|xhigh|max) EFFORT=$CREW_EFFORT ;;
      *) echo "warning: config/crew-effort '$CREW_EFFORT' is not one of low, medium, high, xhigh, max; ignoring" >&2 ;;
    esac
  fi
fi

shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

model_flag_for_harness() {
  local harness=$1 model=$2
  [ -n "$model" ] && [ "$model" != default ] || return 0
  case "$harness" in
    claude)
      printf -- '--model %s ' "$(shell_quote "$model")"
      ;;
  esac
}

effort_flag_for_harness() {
  local harness=$1 effort=$2
  [ -n "$effort" ] && [ "$effort" != default ] || return 0
  case "$harness" in
    claude)
      case "$effort" in
        low|medium|high|xhigh|max) printf -- '--effort %s ' "$(shell_quote "$effort")" ;;
      esac
      ;;
  esac
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

resolved_existing_dir() {
  local path=$1
  [ -d "$path" ] || { echo "error: firstmate home does not exist or is not a directory: $path" >&2; return 1; }
  cd "$path" && pwd -P
}

resolve_project_dir_arg() {
  local path=$1
  case "$path" in
    projects/*) printf '%s/%s\n' "$PROJECTS" "${path#projects/}" ;;
    *) printf '%s\n' "$path" ;;
  esac
}

PROJ_ABS="$(cd "$(resolve_project_dir_arg "$PROJ")" && pwd)"
WT=""
BRIEF="$DATA/$ID/brief.md"
[ -f "$BRIEF" ] || { echo "error: no brief at $BRIEF" >&2; exit 1; }

# PROJ_ABS can still carry a symlinked path component (e.g. macOS's /tmp ->
# /private/tmp) when it came from the ship/scout branch's logical `pwd` above.
# The backend's own current-path read (tmux's pane_current_path) can
# report the OS-level, physically-resolved cwd, so comparing it against a
# still-symlinked PROJ_ABS can misfire both ways: false-negative (the poll
# below never notices the pane left the project) or false-positive (the
# isolation guard refuses a spawn that never actually tangled). Canonicalize
# once here so every downstream comparison uses the same physical form.
PROJ_ABS_REAL=$(cd "$PROJ_ABS" 2>/dev/null && pwd -P) || PROJ_ABS_REAL="$PROJ_ABS"

# Session-provider container-ensure + task creation (bin/backends/tmux.sh). Both
# adapter branches converge on the same $T ("target") string that every
# downstream operation (send/capture/kill) already treats as opaque per-backend
# routing (fm_backend_resolve_selector).
validate_spawn_worktree() {  # <source> <inspect-target>
  local source=$1 inspect_target=$2 wt_real proj_real wt_top wt_top_real
  wt_real=
  if ! wt_real=$(cd "$WT" 2>/dev/null && pwd -P); then
    wt_real=
  fi
  proj_real=$PROJ_ABS_REAL
  wt_top=$(git -C "$WT" rev-parse --show-toplevel 2>/dev/null || true)
  wt_top_real=
  if ! wt_top_real=$(cd "$wt_top" 2>/dev/null && pwd -P); then
    wt_top_real=
  fi
  if [ -z "$wt_real" ] || [ -z "$wt_top_real" ] || [ "$wt_real" != "$wt_top_real" ] || [ "$wt_real" = "$proj_real" ]; then
    echo "error: $source did not yield an isolated worktree (resolved '$WT'; worktree root '${wt_top:-none}'; primary '$PROJ_ABS'); refusing to launch to avoid tangling the primary checkout. Inspect target $inspect_target" >&2
    exit 1
  fi
}

# LOCAL FORK: create the task worktree BEFORE the endpoint exists, so the pane
# can be opened directly inside it.
#
# Upstream created the pane in the PROJECT directory, sent the literal text
# `treehouse get` into it, then polled pane_current_path for up to 60 seconds
# waiting for treehouse's subshell to cd -- and needed two consecutive agreeing
# reads, because a brand-new pane can transiently report an unrelated stale path
# that would otherwise be recorded as the worktree in state/<id>.meta. That whole
# race exists only because treehouse hands out a worktree by opening a subshell
# inside it. `git worktree add` simply returns a path, so we create it first and
# hand it to the backend as the pane's cwd. The pane is never in the project
# directory at any point, and there is nothing to poll for.
#
# validate_spawn_worktree still runs: it is the isolation assertion (a real
# worktree root, distinct from the primary checkout) and is unchanged.
WT=$(fm_worktree_create "$PROJ_ABS" "$ID") || {
  echo "error: could not create a task worktree for $ID under $PROJ_ABS" >&2
  exit 1
}
# Arm abort cleanup: from here until the task metadata is published, any exit
# must remove this worktree so a failed launch leaves no orphan directory or
# stale git registration. Safe only in that window, because the agent has not
# been handed the worktree yet and it provably holds no work. Disarmed right
# after the meta write; every later removal goes through teardown's fail-closed
# landed-work checks.
WORKTREE_ABORT_CLEANUP=1
validate_spawn_worktree "git worktree add" "$WT"

# LOCAL FORK: which tab a tmux-panes task's pane lands in. Precedence:
#   1. --window <name>            explicit, per task - what firstmate passes at
#                                 intake after reading config/pane-routes
#   2. $FM_PANE_WINDOW            environment override
#   3. config/pane-routes         "<kind>: <window>" lines, or "default: <window>"
#   4. built-in default           scout -> reviews, everything else -> workers
#
# Deliberately mechanical. Routing INTENT ("PR reviews go to tab 3") is a
# judgment call and belongs to firstmate reading config/pane-routes at intake,
# exactly as config/crew-dispatch.json works for harness selection. This function
# only resolves a concrete name and never parses task intent.
spawn_resolve_pane_window() {
  local routes="$CONFIG/pane-routes" val
  if [ -n "${PANE_WINDOW_FLAG:-}" ]; then printf '%s\n' "$PANE_WINDOW_FLAG"; return 0; fi
  if [ -n "${FM_PANE_WINDOW:-}" ]; then printf '%s\n' "$FM_PANE_WINDOW"; return 0; fi
  if [ -f "$routes" ]; then
    val=$(sed -n "s/^[[:space:]]*${KIND}[[:space:]]*:[[:space:]]*\([A-Za-z0-9._-][A-Za-z0-9._-]*\).*/\1/p" "$routes" 2>/dev/null | head -1)
    [ -n "$val" ] || val=$(sed -n 's/^[[:space:]]*default[[:space:]]*:[[:space:]]*\([A-Za-z0-9._-][A-Za-z0-9._-]*\).*/\1/p' "$routes" 2>/dev/null | head -1)
    if [ -n "$val" ]; then printf '%s\n' "$val"; return 0; fi
  fi
  case "$KIND" in
    scout) printf 'reviews\n' ;;
    *)     printf 'workers\n' ;;
  esac
}

W="fm-$ID"
case "$BACKEND" in
  tmux)
    SES=$(fm_backend_tmux_container_ensure)
    T="$SES:$W"
    # #134 robustness (tmux): fm_backend_tmux_create_task captures a stable window
    # id and pins the window name (automatic-rename/allow-rename off) so a captain's
    # non-default tmux config cannot rename the window away from fm-<id>.
    # LOCAL FORK: the pane opens directly in $WT, the worktree created above, not
    # in $PROJ_ABS. Nothing cd's it afterwards, so WT_TARGET is now only a stable
    # handle for later steps rather than a worktree-detection target.
    WID=$(fm_backend_tmux_create_task "$SES" "$W" "$WT") || exit 1
    WT_TARGET="$WID"
    ;;
  tmux-panes)
    # LOCAL FORK. One tiled PANE inside a routed window instead of one window
    # per task. The endpoint handle recorded in meta is the pane id (%12), which
    # is server-unique and immutable - a stronger identity than a window name,
    # which is why this branch needs none of the rename-pinning above.
    SES=$(fm_backend_tmux_panes_container_ensure)
    FM_PANE_WINDOW=$(spawn_resolve_pane_window)
    export FM_PANE_WINDOW
    PANE_ID=$(fm_backend_tmux_panes_create_task "$SES" "$W" "$WT") || exit 1
    T="$PANE_ID"
    WT_TARGET="$PANE_ID"
    ;;
esac
# #134 robustness: the stock tmux adapter needs a worktree-detection target
# distinct from $T - its rename-safe stable window id, set as WT_TARGET=$WID in
# the tmux branch above. Every other adapter addresses its pane by the id already
# in $T, so default WT_TARGET to $T - nothing below may reference an unbound
# WT_TARGET under set -u.
: "${WT_TARGET:=$T}"
spawn_send_text_line() {  # <target> <text>
  case "$BACKEND" in
    tmux) fm_backend_tmux_send_text_line "$1" "$2" ;;
    tmux-panes) fm_backend_tmux_panes_send_text_line "$1" "$2" ;;
  esac
}
spawn_send_literal() {  # <target> <text>
  case "$BACKEND" in
    tmux) fm_backend_tmux_send_literal "$1" "$2" ;;
    tmux-panes) fm_backend_tmux_panes_send_literal "$1" "$2" ;;
  esac
}
spawn_send_key() {  # <target> <key>
  case "$BACKEND" in
    tmux) fm_backend_tmux_send_key "$1" "$2" ;;
    tmux-panes) fm_backend_tmux_panes_send_key "$1" "$2" ;;
  esac
}

# LOCAL FORK: upstream's worktree acquisition stood here -- send `treehouse get`
# into the pane, then poll pane_current_path for up to 60 seconds waiting for the
# subshell's cd, requiring two consecutive agreeing reads to defend against a
# brand-new pane transiently reporting an unrelated stale path (which would
# otherwise be recorded as the worktree in state/<id>.meta).
#
# All of it is gone. The worktree is created by fm_worktree_create BEFORE the
# endpoint, and the pane is opened directly inside it, so there is no cd to wait
# for and no window in which the pane reports the wrong path. validate_spawn_worktree
# now runs up there too, against the path git returned rather than a polled guess.
#
# Deleted along with it: up to 60 seconds of worst-case spawn latency per task.
# PROJ_ABS_REAL is still live -- it is what validate_spawn_worktree compares the
# worktree against.

# Per-task temp root: /tmp/fm-<id>/ with Go's build temp nested at gotmp/. Go won't
# create GOTMPDIR, so mkdir before it is used; fm-teardown removes the whole root.
# Nested (not a bare /tmp/fm-<id>/gotmp) so other per-task temp can live alongside
# later, and teardown cleans one deterministic path. GOTMPDIR (not TMPDIR) is the
# targeted knob: TMPDIR is too broad (affects every program's temp, not just Go's).
TASK_TMP="/tmp/fm-$ID"
mkdir -p "$TASK_TMP/gotmp"

# Per-harness turn-end hook where enabled: a file that touches
# state/<id>.turn-ended when the agent finishes a turn. Worktree-resident hooks
# and token pointers stay out of git's view so they never block teardown's dirty
# check or leak into a commit.
mkdir -p "$STATE"
STATE_REAL=$(cd "$STATE" && pwd -P)
TURNEND="$STATE_REAL/$ID.turn-ended"
exclude_path() {
  local rel=$1 EXCL
  EXCL=$(git -C "$WT" rev-parse --git-path info/exclude 2>/dev/null || true)
  [ -n "$EXCL" ] || return 0
  mkdir -p "$(dirname "$EXCL")"
  grep -qxF "$rel" "$EXCL" 2>/dev/null || echo "$rel" >> "$EXCL"
}
# Arm the semantic busy-state contract (bin/fm-busy-lib.sh) for the claude
# adapter's verified semantic source. The launch brief sent below IS a submitted
# turn, so the seed record is busy/fm-spawn. The minted gen is embedded into the
# adapter's wiring so an event from a superseded incarnation is rejected as stale.
BUSY_GEN=
case "$HARNESS" in
  claude*)
    BUSY_GEN=$("$FM_ROOT/bin/fm-busy-event.sh" arm "$STATE_REAL" "$ID") || {
      echo "error: failed to arm the busy-state contract for $ID" >&2
      exit 1
    }
    # Semantic busy-state hooks (bin/fm-busy-lib.sh): UserPromptSubmit opens
    # a turn; Stop (normal completion), StopFailure (API-error turn end),
    # and SessionEnd (process shutdown) all close it, so an abnormal end can
    # never leave a stale busy record. Claude fires no hook for a manual
    # interrupt, so the firstmate-controlled interruption procedure
    # (harness-adapters) records idle/fm-interrupt itself. Stop keeps the
    # turn-ended NOTIFICATION touch for the watcher. Every hook command
    # tolerates a refused event (|| true) so a stale-gen writer can never
    # break Claude's own lifecycle.
    mkdir -p "$WT/.claude"
    busy_cmd_prefix="$(shell_quote "$FM_ROOT/bin/fm-busy-event.sh") apply $(shell_quote "$STATE_REAL") $(shell_quote "$ID")"
    busy_suffix="--gen $(shell_quote "$BUSY_GEN") --source claude-hook"
    j_submit=$(json_escape "$busy_cmd_prefix busy $busy_suffix --event user-prompt-submit 2>/dev/null || true")
    j_stop=$(json_escape "touch $(shell_quote "$TURNEND"); $busy_cmd_prefix idle $busy_suffix --event stop 2>/dev/null || true")
    j_stopfail=$(json_escape "$busy_cmd_prefix idle $busy_suffix --event stop-failure 2>/dev/null || true")
    j_sessionend=$(json_escape "$busy_cmd_prefix idle $busy_suffix --event session-end 2>/dev/null || true")
    cat > "$WT/.claude/settings.local.json" <<EOF
{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"$j_submit"}]}],"Stop":[{"hooks":[{"type":"command","command":"$j_stop"}]}],"StopFailure":[{"hooks":[{"type":"command","command":"$j_stopfail"}]}],"SessionEnd":[{"hooks":[{"type":"command","command":"$j_sessionend"}]}]}}
EOF
    exclude_path '.claude/settings.local.json'
    ;;
esac

# Per-project delivery mode + yolo flag (bin/fm-project-mode.sh; the project-management skill and AGENTS.md task lifecycle).
# Recorded in meta so fm-teardown's safety check and the validate/merge stages can
# branch on them. Mode governs ship tasks; a scout's deliverable is a report, not a
# merge, so scout teardown ignores mode.
PROJ_NAME=$(basename "$PROJ_ABS")
read -r MODE YOLO <<EOF
$("$FM_ROOT/bin/fm-project-mode.sh" "$PROJ_NAME")
EOF

META_WINDOW=$T
{
  echo "window=$META_WINDOW"
  echo "endpoint_task_id=$ID"
  echo "worktree=$WT"
  echo "project=$PROJ_ABS"
  echo "harness=$HARNESS"
  echo "kind=$KIND"
  echo "mode=$MODE"
  echo "yolo=$YOLO"
  echo "tasktmp=$TASK_TMP"
  echo "model=${MODEL:-default}"
  echo "effort=${EFFORT:-default}"
  [ -z "${BUSY_GEN:-}" ] || echo "busy_gen=$BUSY_GEN"
  # backend= is written only for a non-default (non-tmux) backend, so the
  # default path's meta stays byte-identical (absent backend= means tmux;
  # data/fm-backend-design-d7's P1 compatibility contract).
  [ "$BACKEND" = tmux ] || echo "backend=$BACKEND"
} > "$STATE/$ID.meta"
# LOCAL FORK: the worktree is now recorded in task metadata, so teardown owns it.
WORKTREE_ABORT_CLEANUP=0

sq_brief=$(shell_quote "$BRIEF")
sq_turnend=$(shell_quote "$TURNEND")
sq_opinput=$(shell_quote "$FM_ROOT/bin/fm-operational-input.sh")
MODELFLAG=$(model_flag_for_harness "$HARNESS" "$MODEL")
EFFORTFLAG=$(effort_flag_for_harness "$HARNESS" "$EFFORT")
LAUNCH=${LAUNCH//__MODELFLAG__/$MODELFLAG}
LAUNCH=${LAUNCH//__EFFORTFLAG__/$EFFORTFLAG}
LAUNCH=${LAUNCH//__BRIEF__/$sq_brief}
LAUNCH=${LAUNCH//__TURNEND__/$sq_turnend}
LAUNCH=${LAUNCH//__OPINPUT__/$sq_opinput}
# Crewmate panes are created by a long-lived tmux server that does not
# inherit firstmate's current environment, so a bare `claude` in the pane falls
# back to the default ~/.claude store even when firstmate itself runs under a
# different CLAUDE_CONFIG_DIR (for example a work-vs-personal subscription split).
# Forward firstmate's own resolved store onto the claude launch so the crewmate
# uses the same credential/config firstmate is authenticated with. Only when set;
# an unset value is the single-store default and needs no prefix.
if [ "$HARNESS" = claude ] && [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  LAUNCH="CLAUDE_CONFIG_DIR=$(shell_quote "$CLAUDE_CONFIG_DIR") $LAUNCH"
fi
# Export GOTMPDIR into the crewmate's pane shell so the agent and every child
# process (go build, go test, ...) inherit it. Sent before the launch command so
# the env is set when the agent starts; the brief sleep lets the export land.
spawn_send_text_line "$T" "export GOTMPDIR=$TASK_TMP/gotmp"
sleep 0.3
spawn_send_literal "$T" "$LAUNCH"
sleep 0.3
spawn_send_key "$T" Enter
echo "spawned $ID harness=$HARNESS kind=$KIND mode=$MODE yolo=$YOLO window=$META_WINDOW worktree=$WT"
