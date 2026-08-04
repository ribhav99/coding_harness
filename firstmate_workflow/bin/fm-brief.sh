#!/usr/bin/env bash
# Scaffold a crewmate brief at data/<task-id>/brief.md under the active
# firstmate home.
# Usage: fm-brief.sh <task-id> <repo-name> {--issue <number>|--work-order <slug>}
#        fm-brief.sh <task-id> <repo-name> --scout
#
# A ship brief carries ONE instruction: the work item to read and implement.
# Firstmate does not restate the task, so there is no {TASK} placeholder to fill;
# the issue or work order is the specification, and the worker reads it itself.
# Exactly one source flag is required, and the flag is how firstmate tells the
# worker which tracker this project uses:
#   --issue <number>     GitHub: read it with `gh issue view <number>`
#   --work-order <slug>  Software Factory: read that work order on Software Factory
# Ship briefs are single-shaped - implement, commit, push, open a PR - so the
# scaffold refuses any project whose registry delivery mode is not direct-PR
# rather than emitting push/PR steps a local-only project must not follow.
#   --scout writes the scout contract instead: the deliverable is a report at
#   data/<task-id>/report.md (no branch, no push, no PR) and the worktree is scratch.
#   Scout briefs still carry the full investigation contract and its {TASK} placeholder.
# Ship briefs do not restate worktree isolation: bin/fm-spawn.sh's
# validate_spawn_worktree already refuses to launch outside an isolated worktree,
# so the assertion cannot reach an agent that needed it.
# The scout scaffold's status protocol distinguishes the configured
# declared-external-wait verb (FM_CLASSIFY_PAUSED_VERB, default "paused") from
# "blocked:": pause for a known external wait expected to clear on its own,
# blocked when firstmate must act.
# Every brief keeps two status appends, the worker's only channel back to
# firstmate (bin/fm-crew-state.sh): the terminal `done:` line, which is how
# firstmate learns the task finished at all, and `needs-decision:`, which stops
# the worker on a genuine ambiguity instead of letting it guess and ship.
# Refuses to overwrite an existing brief.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bin/fm-naming-lib.sh
. "$SCRIPT_DIR/fm-naming-lib.sh"

usage() {
  awk '
    NR == 1 { next }
    /^#/ { sub(/^# ?/, ""); print; next }
    { exit }
  ' "$0"
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

# shellcheck source=bin/fm-marker-lib.sh
. "$SCRIPT_DIR/fm-marker-lib.sh"
# shellcheck source=bin/fm-classify-lib.sh
. "$SCRIPT_DIR/fm-classify-lib.sh"
PAUSED_VERB=${FM_CLASSIFY_PAUSED_VERB:-$FM_CLASSIFY_PAUSED_VERB_DEFAULT}

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

FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME=$(resolve_directory_input FM_HOME "${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}") || exit 1
if [ -n "${FM_DATA_OVERRIDE:-}" ]; then
  DATA=$(resolve_directory_input FM_DATA_OVERRIDE "$FM_DATA_OVERRIDE") || exit 1
else
  DATA="$FM_HOME/data"
fi
if [ -n "${FM_STATE_OVERRIDE:-}" ]; then
  STATE=$(resolve_directory_input FM_STATE_OVERRIDE "$FM_STATE_OVERRIDE") || exit 1
else
  STATE="$FM_HOME/state"
fi
KIND=ship
SOURCE_KIND=
SOURCE_REF=
POS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --scout) KIND=scout ;;
    --issue|--work-order)
      [ "$#" -ge 2 ] || { echo "error: $1 requires a value" >&2; exit 1; }
      [ -z "$SOURCE_KIND" ] || { echo "error: --issue and --work-order are mutually exclusive" >&2; exit 1; }
      SOURCE_KIND=${1#--}
      SOURCE_REF=$2
      shift
      ;;
    *) POS+=("$1") ;;
  esac
  shift
done
ID=${POS[0]}

if [ -n "$SOURCE_KIND" ] && [ "$KIND" != ship ]; then
  echo "error: --issue and --work-order apply only to ship briefs" >&2
  exit 1
fi

if [ "$KIND" = ship ] && [ -z "$SOURCE_KIND" ]; then
  echo "error: a ship brief requires --issue <number> or --work-order <slug>" >&2
  exit 1
fi

# A non-numeric issue would render an unreadable `gh issue view` instruction.
if [ "$SOURCE_KIND" = issue ]; then
  case "$SOURCE_REF" in
    ''|*[!0-9]*)
      echo "error: --issue requires a numeric GitHub issue number (got '$SOURCE_REF')" >&2
      exit 1
      ;;
  esac
fi

BRIEF="$DATA/$ID/brief.md"
[ -e "$BRIEF" ] && { echo "error: $BRIEF already exists" >&2; exit 1; }
mkdir -p "$DATA/$ID"

shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

STATUS_FILE=$(shell_quote "$STATE/$ID.status")

REPO=${POS[1]}

if [ "$KIND" = scout ]; then
cat > "$BRIEF" <<EOF
You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
{TASK}

# Setup
You are in a disposable git worktree of $REPO, at a detached HEAD on a clean default branch.
This is a SCOUT task: the deliverable is a written report, not a PR.
The worktree is your laboratory - install, run, edit, and make scratch commits freely; all of it is discarded at teardown.
The report is the only thing that survives, so anything worth keeping must be in it.

# Rules
1. Never push to any remote and never open a PR.
2. Stay inside this worktree; the only files you may write outside it are the report and the status file below.
3. Use gh-axi for GitHub operations and chrome-devtools-axi for browser operations.
4. Report status by appending one line:
   \`echo "{state}: {one short line}" >> $STATUS_FILE\`
   States: working, needs-decision, blocked, $PAUSED_VERB, done, failed.
   Each append wakes firstmate, so report sparingly: only phase changes a supervisor
   would act on and the needs-decision/blocked/paused/done/failed states. No step-by-step
   FYI progress lines; firstmate reads your pane for that.
   Use \`$PAUSED_VERB: {why}\` - distinct from \`blocked:\` - ONLY when you are deliberately idling on a
   known external wait you expect to clear on its own (an upstream release, a rate-limit reset):
   firstmate then leaves your idle pane alone and rechecks it on a long cadence instead of
   treating it as a possible wedge. Use \`blocked:\` when you are stuck and need help.
5. If you hit the same obstacle twice, append \`blocked: {why}\` and stop; firstmate will help.
6. If a decision belongs to a human (product choices, destructive actions),
   append \`needs-decision: {summary of options}\` and stop. Firstmate will reply with the decision.
   When firstmate replies or a blocker clears and you resume, append \`resolved: {how it was decided or unblocked}\` (add the same \`[key=<slug>]\` if you opened it with one) so the decision or blocker is durably closed and does not keep resurfacing.
7. Never stop, restart, or update the shared \`no-mistakes\` daemon - it is one instance serving
   every lane/home, so restarting it kills other lanes' in-flight pipeline runs. On ANY no-mistakes
   daemon error, append \`blocked: {the daemon error}\` and stop; only firstmate manages the daemon.

# Definition of done
Write your findings to \`$DATA/$ID/report.md\`.
The report must stand alone: what you did, what you found, the evidence (commands run, output, file:line references), and what you recommend.
Before reporting done, read and follow \`$FM_ROOT/.agents/skills/decision-hold-lifecycle/SKILL.md\` and pass its shared completion gate for the report and any visual review.
When the report is complete, append \`done: {one-line conclusion}\` to the status file and stop.
If your findings reveal work that should ship (e.g. you reproduced a bug and the fix is clear), say so in the report; firstmate may promote this task in place, and you would then receive mode-specific ship instructions as a follow-up message.
EOF
echo "scaffolded: $BRIEF (scout; replace {TASK})"
exit 0
fi

# Ship task: one instruction - the work item to read and implement.
# The brief is single-shaped (implement, commit, push, open a PR), so a project
# on any other delivery mode must not receive it. Refuse rather than hand a
# local-only project push and PR steps it is forbidden to follow.
read -r MODE _ <<EOF
$("$FM_ROOT/bin/fm-project-mode.sh" "$REPO")
EOF

if [ "$MODE" != direct-PR ]; then
  echo "error: $REPO resolves to delivery mode '$MODE'; ship briefs are direct-PR only" >&2
  rmdir "$DATA/$ID" 2>/dev/null || true
  exit 1
fi

# The branch follows the project's own stated convention where it states one,
# and firstmate's fm/<id> namespace where it does not (bin/fm-naming-lib.sh).
# An unclonable or unregistered repo simply yields the fm/ fallback.
TASK_BRANCH=$(fm_naming_branch "${FM_PROJECTS_OVERRIDE:-$FM_HOME/projects}/$REPO" "$ID")

case "$SOURCE_KIND" in
  issue)
    WORK_ITEM="GitHub issue #$SOURCE_REF"
    READ_STEP="Read it first: \`gh issue view $SOURCE_REF\`."
    ;;
  *)
    WORK_ITEM="Software Factory work order $SOURCE_REF"
    READ_STEP="Read this work order on Software Factory."
    ;;
esac

cat > "$BRIEF" <<EOF
You are an autonomous worker managed by firstmate. Work on your own; do not wait for a human.

Implement $WORK_ITEM in $REPO.
$READ_STEP

You are in an isolated git worktree at a detached HEAD; work on branch \`$TASK_BRANCH\`.
When it is implemented, commit, push that branch, and open a PR with \`gh\`.

Report by appending one line to $STATUS_FILE:
   \`echo "done: PR {url}" >> $STATUS_FILE\` once the PR is open - this is how firstmate learns you finished.
   \`echo "needs-decision: {the options}" >> $STATUS_FILE\` if something is genuinely ambiguous or is not yours to decide - then STOP and wait for the answer rather than guessing.
EOF
echo "scaffolded: $BRIEF ($WORK_ITEM)"
