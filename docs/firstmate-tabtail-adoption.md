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

The primary predates the shared-module refactor and PR14. Its local footer work
cannot be adopted by copying the old `fm2/lib/tasks.mjs` over the reviewed source.
Use a separate stable integration checkout based on the controller-approved
merged harness head, preserving these narrowly identified behaviors:

- The upstream stop-submit fix from PR12 is already present, including
  `pane-input.mjs`, queued knocks and bracketed-paste submission. Retain it and
  run the native input gate; there is no reason to restore the older tasks file.
- Port `five-hour-limit` and `weekly-limit` into `CODEX_STATUS_LINE` in
  `fm2/lib/launch.mjs`, then adjust the corresponding launch assertions in
  `fm2/test/fm2.test.mjs` and `provider-sessions.test.mjs`.
- Port the behavioral hunks and tests from local `2abf8caf`:
  `configurePanelQuotaStatus` enables its shared bar only with explicit
  `@fm-quota-status-enabled=1`, otherwise restoring an old installed bar.
  Keep the refactored shared `shellQuote` and `readJson` imports.
- Preserve the three `codex/native-footer/` assets from local `2b39d8d8`, plus
  the native-footer explanation in `codex/README.md`. Do not rebuild, reinstall
  or replace the already patched CLI as part of this harness adoption. A future
  provider update needs a separate patch/version verification; never overwrite
  newer companions with the old custom binary.
- Carry the exact CLI/API-only app release rule from local `56605702` into the
  integration checkout's AGENTS.md. App releases stay with their release owners;
  harness adoption does not authorize browser release operations.

The author rehearses this port in disposable sibling
`coding_harness-tabtail-adoption-rehearsal`, without committing/publishing the
primary's history. The separately reviewable behavioral delta is retained at
`~/.fm2/briefs/tabtail-harness-adoption/evidence/primary-runtime-integration.patch`,
with Node/installer/native evidence and a primary/link preservation manifest in
that directory. It is a follow-up integration patch, **not part of this PR's
runtime**. The controller must review the patch against its final merged head,
rerun gates after any changes, and establish the stable installation checkout.
Do not install from the disposable rehearsal or author checkout.

Required integration gates are `node --test fm2/test/*.test.mjs codex/install.test.mjs`,
`FM2_CODEX_TUI_TEST=1 node --test fm2/test/pane-input.test.mjs`, and the released
Relay native bridge suite described in the [integration contract](firstmate-tabtail-notifications.md).
Run installer mutation/check only in a private HOME/bin with a minimal PATH that
cannot resolve installed fm/fmp/surface. On the real Mac, `./install --check` is
read-only; its proposed Surface relink is deliberately not adopted.

After cold review and merge, the controller may selectively repoint only fm/fmp
from the stable reviewed installation, keeping the retained Surface link exact.
Verify the resolved targets and required skill links before launching anything.
Do not push the primary branch or incorporate its unrelated dirty files.

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
