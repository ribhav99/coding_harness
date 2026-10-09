# TabTail adoption on this Mac

This is a controller deployment plan, not an author-worktree installation.
The author changed no installed command, owner configuration, service, provider,
native binary or existing tmux environment. Merge does not adopt live Codex or
Claude conversations. Phone delivery remains unverified until observed with a
future user-enabled subscription and a fresh accepted turn.

## Preserve and reconcile the installed runtime

At inspection, primary `coding_harness` is at
`56605702129d1efd0a91a84fc1e6cef9e402d707`, with unrelated dirty
`firstmate_workflow/homes/fitness_agent/state/exercise-search-303.status` and
untracked `output/`. `/opt/homebrew/bin/fm` points at that checkout's
`fm2/bin-fm`. `/opt/homebrew/bin/surface` points at the retained
`coding_harness-surface-reviewed-pr13/surface/bin-surface` and must remain there.
Do not reset, stash, clean, stage, push or overwrite the primary's files/commits.
Do not run bare `./install` on this Mac: it would also relink Surface.

The primary predates the shared-module refactor and PR14. The focused runtime
preservation port is based on final PR15 merge
`2e619c05dbf03c82d902beb3885887a17673ced2`, whose tree equals reviewed
`03c3e2aae756982b58e95517e4386497f9f0e1d8`. It retains:

- `five-hour-limit` and `weekly-limit` in the shared worker/controller native
  footer selection, including the reset countdowns in this Mac's existing binary.
- The primary's exact `@fm-quota-status-enabled=1` fallback: otherwise restore
  the previous tmux bar, including inherited and intentionally empty local bars.
  An opted-in mixed-provider panel retains its bar while Codex workers remain.
- The primary's three `codex/native-footer/` assets and exact CLI/API-only release
  rule. Those assets record the prior native build; this integration does not
  rebuild, replace or reinstall that binary or its companions.
- The final upstream stop-submit transport, shared module imports, PR14 trust/
  event boundaries and both PR15 corrections: default-off does not become sticky,
  and preference cleanup failures retain retryable task bookkeeping.

The authored preservation patch is retained at
`~/.fm2/briefs/tabtail-harness-adoption/evidence/primary-runtime-integration.patch`
(SHA256 `eb48fc2914aa0dbcbc3c4f6a684c9fb7208ae25c5b8dab7c5d8edaca20659321`).
Its author rehearsal and PR15 review do not independently approve this port.
The new candidate adds real private-tmux fallback verification and a concrete
[selective installation and rollback plan](firstmate-tabtail-runtime-installation.md).
Fresh candidate verification is recorded separately under
`~/.fm2/briefs/tabtail-runtime-integration/`; the original patch/rehearsal stay
retained until the candidate's independent review safely supersedes them.

Required integration gates are `node --test fm2/test/*.test.mjs codex/install.test.mjs`,
`FM2_CODEX_TUI_TEST=1 node --test fm2/test/pane-input.test.mjs`, and the released
Relay native bridge suite described in the [integration contract](firstmate-tabtail-notifications.md).
Run installer mutation/check only in a private HOME/bin with a minimal PATH that
cannot resolve installed fm/fmp/surface. On the real Mac, `./install --check` is
read-only; its proposed Surface relink is deliberately not adopted.

A separate rollout step must receive the exact independently reviewed merged
commit and establish a stable retained checkout before selectively repointing
fm/fmp and managed skills. Do not install from this author, a reviewer or the
rehearsal checkout. Keep the retained Surface link exact. No live provider
restart, automatic conversation adoption or native binary update belongs to
that link-only step.

## App setup and a deliberately selected pilot

The Mac app owner confirmed the
[version 1 machine contract](firstmate-tabtail-notifications.md#app-owned-setup-contract-version-1).
After verifying its runtime and successful pairing, the app atomically writes
private mode 0600 config with a pinned absolute retained root such as
`~/.local/share/tabtail/mac/versions/0.1.0-BUILD` (expand the home path; JSON needs
an absolute path). The app uses no moving `current` symlink here and never
removes retained versions automatically. Existing fm identities keep their
reviewed root through lifecycle relaunches; new identities use the new app
default. The executable `venv/bin/python` compatibility shim may add `-B` and
exec bundled Python; no pip or real virtualenv is required. The harness matches
the exact configured Stop interpreter even when `sys.executable` changes through
that shim. It still checks the same trusted command, single synchronous gate,
original callbacks and native event pair.

The app owns packaging, pairing, local service security and opt-out UI. Disabling
writes `enabled:false`, preserving unknown version 1 fields and saved harness
preferences. The harness introduces no APNs key copying, user hook editing,
per-chat shell setup or global trust bypass.

First verify a new disposable local Codex chat from the adopted installation,
with machine config supplying integration automatically. Keep it idle initially,
then review exact hooks with `/hooks`. Verify a correct first root completion,
source/run readiness and the preserved original callback. Enable the test phone
subscription only after readiness; observe a fresh subsequent OS alert and tap
routing while the provider remains alive. Local outbox evidence proves neither
physical delivery nor locked/background behavior.

For an existing conversation, the controller must select its exact native ID,
worktree and owner, preserve the full transcript, and use a deliberate stop/resume
boundary. Verify the old writer has stopped before replacement. Never use
recency, `--last`, `--continue`, a generated summary as a conversation substitute,
or a blanket live-fleet restart. No live conversation was selected or restarted
by this author.

Only local embedded Codex with the supported exact synchronous Stop/notify
contract is covered. Claude's released accepted-stop parser requires real
`background_tasks` and `session_crons` arrays absent from its documented Stop;
this was handed directly to the Mac app owner. It needs a separate grounded
mobile contract. Other providers, remote/shared-daemon Codex, custom profiles,
parallel/asynchronous Stop gates and dynamic gate changes remain unsupported.
Do not fabricate fields, broaden event acceptance, or describe these chats as
automatically adopted by merge.
