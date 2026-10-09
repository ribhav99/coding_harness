# Firstmate TabTail completion pilot

`FM2_TABTAIL=1` opts **future local Codex launches** into the TabTail launch and
Stop-outcome bridge. It does not install anything, change global provider config,
retrofit a conversation, restart a daemon, or enable push. Omit it for the
existing launch behavior. Reviews remain remote with `FM_REMOTE=yes`.

## Current adoption blocker

**This is bridge infrastructure, not working completion alerts for today's
Firstmate providers.** A real localhost-only Codex 0.160.1 completion test
captures `session_id` and `turn_id`, but no `background_tasks`, `session_crons`,
or native `goal` registry. This pilot consequently emits **no completed outcome**
for that CLI, even after hook trust. Synthetic successful fixtures explicitly
supply these fields; they do not establish production support.

The producer requires provider-owned empty background/wakeup registries and,
for Codex, explicit absent/completed goal state. Missing/unknown state cannot
prove the requested finality. No code adds empty arrays or reconstructs this
state from transcripts, terminal output, process silence, or task reports.
An authoritative provider integration must supply that evidence before adoption
can promise alerts. APNs activation alone does not resolve this limitation.
Do not remove these checks to make the pilot appear ready.

Claude Code 2.1.295 also lacks the required background registry evidence in its
documented Stop contract. Claude launches/settings stay unchanged, including
existing attention callbacks. Other providers, generic agents, shared-daemon
Codex, remote Codex, profiles/custom launch modes, parallel Stop gates and async
hooks are unsupported by this pilot. No mobile repository change was made.

## Future deliberate pilot commands

After this harness is reviewed and deliberately adopted, use a **disposable
existing sibling worktree**, without an opening spec so the provider starts idle:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes fm attach /absolute/path/to/disposable-sibling --id tabtail-pilot --agent codex
```

Review the exact new hook commands using Codex `/hooks`, then trust those
specific definitions through its normal flow before submitting a pilot turn.
The route removes the harness's existing hook-trust bypass for this invocation;
it neither records trust nor globally trusts hooks. Skipped hooks cannot report
or establish readiness. Current Codex still suppresses completion for the reason
above. Existing unrelated hooks/plugins remain enabled; an additional Stop or
async hook makes the completion inventory ineligible.

An already stopped conversation can instead be resumed by its **explicit ID**:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes fm attach /absolute/path/to/disposable-sibling --id tabtail-pilot --agent codex --resume EXACT_NATIVE_SESSION_ID
```

Do not use a live worktree/session, bare resume discovery, `--last`, or
`--continue`. A disposable controller can use the same opt-in on its future
launch, in an already prepared disposable panel:

```sh
FM2_TABTAIL=1 FM_REMOTE=yes node fm2/supervisor.mjs codex --panel fm-pilot --id controller:fm-pilot
```

These commands do not activate the notification service. They require the
reviewed Relay installation (default `~/.local/share/relay`, optionally
`FM2_TABTAIL_RELAY=/absolute/relay-installation`) with its venv and adapter modules. Relay is imported only inside the bridge process; the
provider and its tools keep their original `PYTHONPATH`.
No dependency is installed by the bridge. Actual readiness requires a verified
root completion; actual delivery additionally requires owner-controlled APNs
setup, phone registration, a subsequent subscription and a fresh completion.

## Boundary and preservation

The launch uses the same task/panel identity, arguments, model, effort, exact
resume ID, worktree and pane, with local embedded `--no-daemon`. Before execing
through released `notification_agent`, it generates a fresh run and submits
pane-validated `shell-ready`/`shell-start`. This supports direct tmux commands
without assuming interactive zsh hooks fire. The released launcher preserves PID
ownership through exec and claims the run. The bridge never reports provider
process exit as shell completion. Existing ordinary command notifications remain
the responsibility of the released additive zsh integration.

A short-lived **separate** `codex app-server --stdio` reads `config/read` and
`hooks/list`. It starts no threads, tools or model requests and never contacts the
shared daemon. It resolves the original notify argv using the provider's config
precedence. If that read fails, notify remains unchanged. No prompts or brief
text enter the hook environment. Inventory queries have a two-second budget and
at most one second to reap their own process.

The Stop wrapper repeats the provider inventory with the original config flags.
It accepts only its single exact trusted session Stop command, no inventory
errors/warnings, no parallel Stop, and no enabled async hook. Codex [loads matching hooks additively](https://learn.chatgpt.com/docs/hooks).
It does not disable,
move or execute any other hook itself. General aggregation of arbitrary plugin,
MCP, managed or review hooks is deliberately unsupported. Their ordinary provider
execution continues, but this bridge produces no completion. The inventory is a
configuration inspection, not a background/goal-state substitute. Adding or
changing runtime gates invalidates this pilot; dynamic hook reconfiguration is
unsupported until the provider offers an atomic aggregate-finality boundary.

Released `notification_claude_dispatcher --provider codex` owns the private
invocation descriptor and passes the entire original stdin, stdout, stderr and
status through to the Firstmate Stop aggregate. Only after the worker has
submitted its report/knock, or the controller has checked all unread reports,
can the producer write `{"version":1,"outcome":"completed"}`. Both paths also
require valid root identity, registry evidence and successful bookkeeping.
Quiet/missing/unknown tasks, nested events, errors, permission/attention waits,
blocked turns and unknown integration state supply no completed outcome.
A completed root turn does **not** mean a task is merged or a PR is approved.

Effort and provider-update scheduling/fleet-owned Stops write `handoff`. Pending
lifecycle states and panel/task switches cannot complete. Hook-recorded run
identity protects a tracked task switch even when its caller has no opt-in
environment. The task-switch guard applies only to that source run, is removed
on completion/recovery, and refuses an overlapping guard. An abandoned guard
fails closed for that old run; inspect recovery evidence rather than delete it
under a live provider. Ordinary untracked switches create no guard.

The shared writer accepts only an empty, owner-owned regular fd numbered at
least 3. It writes at most once, never closes the dispatcher's fd, never writes
to stdin/out/err, and ignores optional write failures. Payload fields cannot
choose the descriptor or grant finality. Missing/malformed outcomes and blocked
provider control are also rejected by the released dispatcher.

The session-local Codex notify dispatcher calls the original callback with its
**exact original argv and original JSON argument**, streams and exit status.
It does not parse/reserialize that argument or read stdin. It then runs optional
Relay reporting with stdin closed, output isolated, and a two-second hard limit.
A shell/exec chain retains the released root-owner validation; a Python or Node
parent dispatcher would be rejected. Stop records only a candidate. Only the
matching later accepted root callback can complete it. Deduplication, source/run
identity and subscription ordering remain implemented by released Relay.

## Verification and limits

Run from the harness checkout, using the released Relay installation read-only:

```sh
node --test fm2/test/*.test.mjs codex/install.test.mjs
FM2_CODEX_TUI_TEST=1 node --test fm2/test/pane-input.test.mjs
FM2_TABTAIL_NATIVE_TEST=1 PYTHONPATH="$HOME/.local/share/relay/adapter" "$HOME/.local/share/relay/venv/bin/python" -m unittest discover -s fm2/test -p tabtail_test.py -v
```

The Node tests cover worker/controller outcomes and suppression, unread reports,
quiet/error/unknown states, effort/update/switch handoffs, descriptors, original
launch arguments, exact resumes and off behavior. Python tests exercise native
hook trust/inventory, original callback bytes/stdin/streams/status, a hung optional
reporter, and released dispatcher/reporter/store code in a private tmux fixture.
They prove delayed/retried notify order, subscription ordering, nested rejection,
authoritative pane/run bootstrap, no duplicate shell exit and provider survival.
The native localhost model fixture captures the current CLI's missing registries;
its exact fixture hook hash is trusted only in its temporary Codex home, with no
bypass flag or user config changes.

Investigation baseline: harness `e2be6f4aa21c854c0304e291dcdfbc35f587e640`;
read-only Relay/mobile source `2f22329e8c54203492e4827b23eaffd6ca72d6c8`, Mac
adapter 1.4.0, phone 1.1(8). Tested tools: Codex 0.160.1, Claude Code 2.1.295
(version inspection only), Node v20.19.5, Relay Python 3.13.7, tmux 3.7b.
No Claude/provider session was relaunched for investigation. Fixtures use only
new private processes, sockets, stores, homes and tmux servers. There is no APNs
sender or actual phone delivery in this evidence.

**Physical Production push testing was not run:** owner APNs key placement and
service activation remain outside this task, and current provider finality
support remains blocked. A reviewed supported provider boundary, then a real
subscribed/backgrounded iPhone test, are required before claiming end-to-end
completion alerts.

Removal is reversible: omit `FM2_TABTAIL=1` on the next deliberate new launch or
exact-ID resume. Do not restart existing conversations to remove it. There are
no global hook/notify edits to undo, no release changes, and no service or secret
files to remove. Existing quiet/report/wake/review semantics remain authoritative.
