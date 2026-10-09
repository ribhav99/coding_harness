# Firstmate TabTail root-turn completion pilot

`FM2_TABTAIL=1` opts future local Codex launches or exact-ID resumes into TabTail
root-turn notifications. A completion means the **current root turn ended**;
it does not mean every background job, persistent goal or task has finished,
or that a PR is approved or merged. Default/off behavior is unchanged.
No global configuration, running conversation, release or service is changed.

## Deliberate pilot

After review and deliberate harness adoption, use a disposable existing sibling
worktree, without an opening spec so Codex starts idle:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes fm attach /absolute/path/to/disposable-sibling --id tabtail-pilot --agent codex
```

Review and trust the exact new hook definitions through Codex `/hooks` before
submitting a turn. This invocation removes the existing harness trust bypass;
it neither records trust nor globally trusts hooks. Existing hooks stay enabled.
An untrusted, modified, missing or additional Stop gate suppresses TabTail
completion. A disposable controller can use the same opt-in in a prepared panel:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes node fm2/supervisor.mjs codex --panel fm-pilot --id controller:fm-pilot
```

An already stopped conversation may instead resume by its **explicit native ID**:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes fm attach /absolute/path/to/disposable-sibling --id tabtail-pilot --agent codex --resume EXACT_NATIVE_SESSION_ID
```

Never adopt a live conversation, guess by recency, or use `--last`/`--continue`.
Reviews remain remote with `FM_REMOTE=yes`. These commands require the reviewed
Relay installation at `~/.local/share/relay` (or `FM2_TABTAIL_RELAY=/absolute/relay-installation`),
including its venv and adapter modules. They install no dependency and activate
no notification service. The provider/tools retain their original `PYTHONPATH`.

The released store first requires a verified root completion to establish agent
readiness. Phone registration/subscription must follow readiness; a **fresh**
subsequent completion can deliver. APNs key placement and service activation
remain owner-controlled and outside this task.

## Accepted root-turn boundary

Official [Codex notifications](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
provide `agent-turn-complete` with `thread-id` and `turn-id`.
The documented [Stop contract](https://learn.chatgpt.com/docs/hooks#stop) supplies
root session/turn identity and continuation control. It does not supply goal or
background registries; those fields are unnecessary for Codex turn-end alerts.
The [app-server turn statuses](https://learn.chatgpt.com/docs/app-server#turn-events)
distinguish completed, interrupted and failed turns; this bridge uses the
supported native Stop/notify pair rather than adding another turn orchestrator.

The launch preserves task, panel, arguments, model, effort, exact resume ID,
worktree and pane, and selects local embedded `--no-daemon`. Before exec through
released `notification_agent`, it creates a fresh run and submits pane-validated
`shell-ready`/`shell-start`. Direct tmux commands therefore do not depend on
interactive shell hooks. Exec retains the released owner-process checks. No
provider-exit shell completion is added; regular command exits remain handled
by released shell integration, with managed-run duplicate suppression.

A separate short-lived `codex app-server --stdio` reads effective `config/read`
and `hooks/list`, starting no threads, tools or model requests and never using
the shared daemon. The initial read captures the original notify argv; failure
leaves that callback untouched. Inventory reads have a two-second budget, bounded
output and up to one second to reap their own child process.

At Stop, the bridge verifies the exact single trusted synchronous session Stop
gate again. Codex loads hook sources additively, so parallel Stop gates, inventory
warnings/errors and dynamic gate reconfiguration are unsupported in this pilot.
They continue executing normally but cannot grant completion. Unrelated async
hooks/background work do not redefine root-turn finality. An asynchronous Stop
cannot grant completion.

Released `notification_claude_dispatcher --provider codex` forwards all original
stdin, stdout, stderr and exit status to the Firstmate aggregate. Only after the
worker's report/knock or the controller's unread-report gate accepts the turn may
the producer write `{"version":1,"outcome":"completed"}`. Missing/quiet tasks,
bookkeeping failures, nested events, errors, attention/permission waits, blocked
control and unknown integration state produce no completion candidate.

Effort/update scheduling and fleet-owned Stops produce `handoff`. Pending effort,
provider-update state, panel locks and exact-run task switches suppress completion.
A hook-recorded run protects a tracked switch even when the caller lacks opt-in.
The switch guard is removed on completion/recovery and refuses overlapping guards;
an abandoned guard fails closed for that old run. Untracked switches are unchanged.
The shared outcome writer accepts only an empty owner-owned regular fd >=3,
writes once, never closes it and never writes to terminal streams. Payload data
cannot select the descriptor or grant integration readiness.

The invocation-local notify bridge calls the original Computer Use callback with
its **exact original argv, unchanged JSON argument, streams and exit status**.
It then attempts optional Relay reporting with stdin closed, output isolated and
a two-second hard limit. Shell/exec ancestry retains released root ownership;
a custom Python/Node parent dispatcher would fail that check. Stop alone only
records a candidate. Only the matching native root notify can complete it.
Released Relay retains event hashing, deduplication, pane/run validation and
subscription ordering; mismatched, early, nested and auxiliary callbacks cannot
complete another root turn.

An opted-in task switch/reload, panel switch or controller effort restart waits
up to six seconds for the actual provider,
covering bounded inventory, bootstrap and agent-claim setup. The temporary
inventory server does not count as provider readiness. The switch captures the
replacement's exact pane PID; failed-start cleanup freezes and stops that owned
launch root and its children before restoring the exact source conversation.
A changed pane PID is refused. Ordinary untracked cleanup and shared-daemon
ownership checks are unchanged.

## Evidence and unsupported routes

Native Codex 0.160.1 TUI fixtures run in private tmux servers and empty Codex
homes against a localhost-only model. They observe accepted Stop candidate before
the matching root notify, then exactly one subscribed outbox event while both
the provider PID and native child remain alive. Codex also emits title-thread
notify callbacks: the original callback receives them, but no matching accepted
root candidate exists and TabTail emits nothing. Controller Stop exit 2 starts a
real continuation without a candidate; the accepted continuation produces one
completion. Native quiet, worker/controller lifecycle handoff, unknown-state and
failed-response cases stay silent. No terminal-output heuristic produces alerts.

Native restart fixtures also exercise successful 400 ms service replies and a
replacement that exceeds the startup budget through task, panel-runtime and
controller-effort callers, plus a task reload with an unavailable optional service.
The failed replacement and its child must exit before exact-source recovery;
the replacement cannot start later and failed handoff bookkeeping stays absent.
Normal hook-review prompts remain visible; the fixtures decline new hook trust
and verify a subsequent native request belongs to the exact source conversation.

Claude Code 2.1.295's documented Stop lacks the real `background_tasks` and
`session_crons` arrays required by released Relay's Claude accepted-stop parser.
Claude launch/settings and existing callback chains remain unchanged. Supporting
it needs a separately reviewed mobile contract for authoritative root-turn
completion/ownership, coordinated through the controller; inventing arrays is
not a valid fix. Other providers, shared-daemon/remote Codex, profiles/custom
launch modes, parallel/asynchronous Stop gates and dynamic gate changes remain
unsupported. No mobile repository changes were made.

Run from this checkout with the released Relay installation read-only:

```sh
node --test fm2/test/*.test.mjs codex/install.test.mjs
FM2_CODEX_TUI_TEST=1 node --test fm2/test/pane-input.test.mjs
FM2_TABTAIL_NATIVE_TEST=1 PYTHONPATH="$HOME/.local/share/relay/adapter" "$HOME/.local/share/relay/venv/bin/python" -m unittest discover -s fm2/test -p tabtail_test.py -v
```

The Node gates cover both aggregates, unread reports, quiet/error/unknown states,
effort/update/switch handoffs, descriptor misuse, exact resumes and off behavior.
Python gates additionally cover native exact-hash trust, additive hook inventory,
original callback bytes/stdin/streams/status, bounded optional failure, delayed
and retried notify, subscription ordering, nested callbacks, authoritative
pane/run bootstrap and no duplicate shell exit using released Relay code.
`FM2_TABTAIL_EVIDENCE_DIR=/absolute/disposable-evidence` saves native fixture
traces outside its temporary home for review; it is a test-only option.

Baseline: harness `e2be6f4aa21c854c0304e291dcdfbc35f587e640`; read-only Relay/mobile
source `2f22329e8c54203492e4827b23eaffd6ca72d6c8`, Mac adapter 1.4.0, phone 1.1(8).
Tools: Codex 0.160.1, Claude Code 2.1.295 (version inspection only), Node v20.19.5,
Relay Python 3.13.7, tmux 3.7b. No current user session was adopted or restarted.
**Physical iPhone push testing was not run by this PR**: the fixture has no push
sender. Local outbox evidence is not proof of end-to-end iPhone delivery; owner
setup and a physical delivery check remain separate adoption requirements.
Merge requires six-judge/meta/current-head review; this task does not deploy the
harness.

Removal is reversible: omit `FM2_TABTAIL=1` on the next deliberate launch or
exact-ID resume. Leave existing conversations running. There are no global
hook/notify edits, release changes, service files or secrets to undo.
