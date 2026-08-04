# Startup-memory `/stow` verification

Audience: maintainer verification.

This record supports the active bounded-memory and whole-file curation guarantees for Firstmate's internal `/stow` skill.
[`docs/configuration.md`](../configuration.md) owns the current operator-facing setting and estimate.
The internal skill owns curation and completion-receipt behavior.
Task chronology, fixture paths, and delivery evidence remain outside this record.

## Synthetic real-agent pass

No live Firstmate memory, project data, credential content, or external system was placed in either fixture or prompt.
The following exact Bash shell body created the sanitized fixtures, invoked the model-qualified skill twice per home, and captured reports, hashes, and file modes:

```bash
set -eu
VERIFY_ROOT=$(mktemp -d "$PWD/.stow-verification.XXXXXX")
RUNTIME_ROOT="$VERIFY_ROOT/runtime-root"
PRIMARY="$VERIFY_ROOT/primary"
mkdir -p "$RUNTIME_ROOT" "$PRIMARY/config" "$PRIMARY/data" \
printf '%s\n' 350 >"$PRIMARY/config/startup-memory-budget"

file_mode() {
  if [ "$(uname)" = Darwin ]; then
    stat -f %Lp "$1"
  else
    stat -c %a "$1"
  fi
}

record_shared_state() {
  label=$1
  path=$2
  printf '%s sha256=%s mode=%s\n' "$label" \
    "$(shasum -a 256 "$path" | awk '{print $1}')" \
    "$(file_mode "$path")"
}

cat >"$PRIMARY/data/captain.md" <<'EOF'
# Captain

## Current preferences

- Prefer the simplest direct end-to-end operational path.
- Preserve unique current facts when compacting memory.
- Use plain dashes in prose.

## Duplicate and superseded material

- Prefer the simplest direct end-to-end operational path.
- Old policy: build a wrapper before every one-off operation.
- Old policy copy: always build a wrapper for one-off work.
- Stale tool path: `/opt/old-firstmate/bin/fm`.
- Stale release version: 0.41.0.
- Completed task: migrated the demo fixture on Monday.
- Completed task detail: checked the demo fixture again on Tuesday.
- Metric from the completed task: 47 records moved.
EOF

cat >"$PRIMARY/data/captain-shared.md" <<'EOF'
# Shared captain preferences

This file is main-authoritative in the main firstmate home.
Route new captain-preference discoveries to the main firstmate through marked status or a document pointer.

- Never expose secrets or weaken an accepted safety boundary.
- Prefer the simplest direct end-to-end operational path.
- Duplicate safety note: do not expose secrets.
EOF

cat >"$PRIMARY/data/learnings.md" <<'EOF'
# Learnings

- Stable fact: startup-memory configuration is documented in `docs/configuration.md`.
- Authoritative pointer: incident detail belongs in `data/reports/synthetic-incident.md`.
- Stable fact copy: consult `docs/configuration.md` for startup-memory configuration.
- Completed chronology: first the synthetic incident was detected, then triaged, then assigned.
- Completed chronology continued: a patch was drafted, reviewed, merged, and announced.
- Old metric: the discarded prototype used 812 estimated tokens.
- Stale path: the discarded prototype lived at `/tmp/old-memory-prototype`.
- Superseded alternative: maintain both a JSON memory database and Markdown files.
- Report-sized procedure: create a staging directory, enumerate every file, copy each file, compare every line, write a status ledger, notify all operators, archive the ledger, and repeat the entire sequence after every prompt.
EOF

FM_HOME="$PRIMARY" bin/fm-startup-memory-budget.sh report \
  >"$VERIFY_ROOT/primary.before.report"
for file in captain.md captain-shared.md learnings.md; do
  shasum -a 256 "$PRIMARY/data/$file"
done >"$VERIFY_ROOT/primary.before.sha256"

FM_HOME="$PRIMARY" pi -p --no-session --no-extensions --no-context-files \
  --skill .agents/skills/stow/SKILL.md \
  'Invoke /stow now against only the disposable synthetic Firstmate home in $FM_HOME. There are no new session facts to file. Follow every requirement in the loaded stow skill. Run the repository-owned bin/fm-startup-memory-budget.sh report command, with the existing FM_HOME environment, before and after curation; that executable is the only permitted path outside $FM_HOME. Retain the exact before total, preserve the complete main-authoritative routing header in data/captain-shared.md, and make the completion receipt state the effective budget, exact before and after totals, an action for each of the three files, every exception, and reset safety. Inspect all three startup-memory files completely, preserve every unique current preference, authority or safety boundary, stable fact, and authoritative pointer, and consolidate the supplied duplicate, superseded, stale, chronological, metric, and report-sized material. Do not access or modify any other home, credential, project data, or external system.' \
  >"$VERIFY_ROOT/primary.pass1.out"
FM_HOME="$PRIMARY" bin/fm-startup-memory-budget.sh report \
  >"$VERIFY_ROOT/primary.after.report"
for file in captain.md captain-shared.md learnings.md; do
  shasum -a 256 "$PRIMARY/data/$file"
done >"$VERIFY_ROOT/primary.after.sha256"

FM_HOME="$PRIMARY" pi -p --no-session --no-extensions --no-context-files \
  --skill .agents/skills/stow/SKILL.md \
  'Invoke /stow now against only the disposable synthetic Firstmate home in $FM_HOME. There are no new session facts to file. Follow every requirement in the loaded stow skill. Run the repository-owned bin/fm-startup-memory-budget.sh report command, with the existing FM_HOME environment, before and after curation; that executable is the only permitted path outside $FM_HOME. Retain the exact before total, preserve the complete main-authoritative routing header in data/captain-shared.md, and make the completion receipt state the effective budget, exact before and after totals, an action for each of the three files, every exception, and reset safety. Inspect all three startup-memory files completely, preserve every unique current preference, authority or safety boundary, stable fact, and authoritative pointer, and consolidate the supplied duplicate, superseded, stale, chronological, metric, and report-sized material. Do not access or modify any other home, credential, project data, or external system.' \
  >"$VERIFY_ROOT/primary.pass2.out"
FM_HOME="$PRIMARY" bin/fm-startup-memory-budget.sh report \
  >"$VERIFY_ROOT/primary.repeat.report"
for file in captain.md captain-shared.md learnings.md; do
  shasum -a 256 "$PRIMARY/data/$file"
done >"$VERIFY_ROOT/primary.repeat.sha256"
