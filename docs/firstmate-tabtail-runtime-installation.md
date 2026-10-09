# Selective retained harness rollout on this Mac

This is a plan for a separate rollout worker after fresh independent six-judge
and meta-review, merge, and exact forge verification. Nothing in the author
phase installs links, updates a provider, changes services/configuration, or
stops/resumes existing conversations. Phone delivery remains unverified.

## Source reconciliation and provenance

The base is reviewed PR15 merge `2e619c05dbf03c82d902beb3885887a17673ced2`
(tree `c00d5a35c45d6aa12fbba756eff535e6445bc057`). Primary remains at
`56605702129d1efd0a91a84fc1e6cef9e402d707` with unrelated dirty fitness state
and untracked output. Do not reset, stash, stage, delete, commit or push it.

The separately authored input is
`~/.fm2/briefs/tabtail-harness-adoption/evidence/primary-runtime-integration.patch`,
SHA256 `eb48fc2914aa0dbcbc3c4f6a684c9fb7208ae25c5b8dab7c5d8edaca20659321`.
The native assets originate in Ribhav Kapur's `2b39d8d8`, native quota selection
in `f1b20761`, fallback behavior in `2abf8caf`, and release rule in `56605702`.
This port applies the behavioral hunks to final PR15, without publishing primary
history or copying its old tasks module. The native source patch and helper
remain byte-identical to primary; their README labels prior verification as
historical and forbids using them during harness rollout.

There is one intentional source conflict: base `fm2/lib/launch.mjs` omitted the
two limit fields and `configurePanelQuotaStatus` installed the shared bar for
every Codex launch. Primary's `fm2/lib/tasks.mjs` selected both native limit
fields; its quota helper installed the shared bar only for explicit panel
option `1`. Preserve that user-selected behavior in the refactored launch and
quota modules. Keep shared `shellQuote`/`readJson` imports. The existing native
binary provides countdown rendering; a stock binary still shows percentages.

There is no stop-transport conflict. `fm2/lib/pane-input.mjs` and `knock.mjs`
match primary exactly: unique named bracketed paste, one Enter, actionable
submission failure, and queued report deduplication. PR14's aggregate adds
completion finality after reporting; restoring the old aggregate would lose
those reviewed checks. This change leaves all notification, scheduler, cleanup,
provider model/effort and trust implementation files unchanged, including both
PR15 fixes. No new appearance, preference mechanism or notification contract is
introduced.

## Exact retained destination and link changes

Use this fixed retained directory (do not move or automatically prune it):

```text
/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness-tabtail-runtime-reviewed
```

In the commands below, `RETAINED` means that full absolute path. `REVIEWED_MERGE`
means the exact full merge SHA supplied by root after forge verification; it
cannot be chosen from branch recency. Verify the final reviewed tree matches
that merge. Create a detached worktree at that SHA from the repository's object
store, with a clean status; do not repoint any links if the directory already
contains different work. The current author/reviewer/rehearsal trees are never
installation sources.

After the rollout worker assigns the two values above from root's verified
handoff, the worktree operation is:

```sh
git worktree add --detach "$RETAINED" "$REVIEWED_MERGE"
git -C "$RETAINED" rev-parse HEAD HEAD^{tree}
git -C "$RETAINED" status --porcelain=v1
```

| Link | Before | After |
| --- | --- | --- |
| `/opt/homebrew/bin/fm` | `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/fm2/bin-fm` | `RETAINED/fm2/bin-fm` |
| `/opt/homebrew/bin/fmp` | `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/fm2/bin-fmp` | `RETAINED/fm2/bin-fmp` |
| `/opt/homebrew/bin/surface` | `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness-surface-reviewed-pr13/surface/bin-surface` | **Exactly the same link** |
| `/opt/homebrew/bin/codex` | `/Users/ribhavkapur/.nvm/versions/node/v20.19.5/bin/codex` | **Exactly the same link, binary and companions** |

The retained checkout is the fm runtime: fm/fmp derive their relative libraries,
`fm2/tabtail.py`, hooks, supervisor and lifecycle entrypoints from it. There is
no separate runtime copy/install command. No edits to shell exports, tmux server
environment, service registrations or `~/.fm2/tabtail.json` are needed here.
Explicit `FM_REPO`/`FMP_CODEX_CMD` launch overrides can supersede that derivation;
the rollout must identify any stale override through the read-only check and
resolve it deliberately before a future pilot. Do not silently rewrite it.
Normal app setup remains governed by the [version 1 contract](firstmate-tabtail-notifications.md).

Managed skill links also need a retained source. Normal launches call
`syncSkills`; delaying that work would still relink the full managed set on the
first launch. Adopt that exact existing set (32 Codex entrypoint folders and 31
Claude `SKILL.md` links at inspection), preserving unrelated custom skills:

| Link pattern | Before target pattern | After target pattern |
| --- | --- | --- |
| `/Users/ribhavkapur/.agents/skills/NAME` | `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/codex/skills/NAME` | `RETAINED/codex/skills/NAME` |
| `/Users/ribhavkapur/.claude/skills/NAME/SKILL.md` | `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/skills/CATEGORY/NAME.md` | `RETAINED/skills/CATEGORY/NAME.md` |

Obtain NAME/CATEGORY exclusively from `skillEntries(RETAINED)` in
`codex/install.mjs` and `repoSkills(RETAINED)` in `fm2/lib/skills.mjs`. The private
candidate evidence `planned-links.json` enumerates every exact before/after
link, including these expanded paths. Read it completely and regenerate the
inventory from the final retained merge before writing. If names, current links,
or custom content differ, reconcile the concrete difference first. Snapshot the
Codex `.coding-harness.json` manifest too; it records every owned folder link.
The exact CLI/API-only release rule is in retained `AGENTS.md` and must be carried
to release workers. No global instruction edit is necessary: the lifecycle
instruction generator is unchanged and the read-only check verifies it.

## Rollout sequence (not executed by the author)

1. Record primary HEAD/status/dirty-diff hash, all four command links, managed
   skill links/manifest, and installed native executable hash. Keep this snapshot
   private. The author's before/after evidence is only a reference; a rollout
   must capture its own current state. Record any intentional drift first.
2. Verify the forge merge SHA and tree against root's cold-review handoff.
   Establish `RETAINED` at that exact SHA, verify clean git status and read the
   complete final adoption/notification docs. Keep it indefinitely while links
   or saved launch settings may refer to it. Never delete primary, retained
   Surface, the authored patch or the rehearsal to make room.
3. Run `./install --check` from retained, read-only. Expected proposed fm/fmp and
   skill target refreshes are allowed; a proposed Surface relink is rejected by
   this plan. This check can return nonzero for stale Codex skill links. It is an
   inventory, not permission to run bare `install`. Confirm current `command -v`
   resolution and link strings match the snapshot; refuse real-file replacements
   or unexpected shadow commands.
4. Back up the existing skill-link inventory and Codex manifest. Preview
   `install({repo: RETAINED, check:true})` from retained `codex/install.mjs` and
   inspect every proposed action. Then use that installer with `repo: RETAINED`
   for only the managed Codex skills. For Claude, preview `repoSkills(RETAINED)`;
   require each destination to be the known old symlink before calling
   `syncSkills({repo: RETAINED, agent:'claude'})` from retained `fm2/lib/skills.mjs`.
   Do not overwrite custom files or adopt skills from any other checkout.
5. Replace only fm/fmp symlinks with their table targets (for example `ln -sfn
   "$RETAINED/fm2/bin-fm" /opt/homebrew/bin/fm`, then the equivalent for fmp).
   Read back both raw links and resolved targets immediately. If either fails,
   restore both old links and managed skills from the snapshot. Leave Surface
   and Codex alone throughout; verify their raw links and native hash unchanged.
6. Run the targeted `node "$RETAINED/codex/install.mjs" --check`, verify every
   managed link and the runtime's exact git SHA/tree, then recheck primary's
   preserved state. A full `install --check` will still propose a Surface relink;
   that difference is intentional. Do not launch a provider or issue a fleet,
   effort, update, reload, switch, attach or resume command in this link-only
   rollout. Existing processes/conversations keep running as they are.

A future separately selected pilot can use the reviewed app/runtime, normal hook
review and fresh readiness. Do not adopt any existing chat, bypass hook trust or
select a native conversation by `--last`, `--continue` or recency. No provider
update or native footer rebuild/replacement is part of selective installation.

## Rollback

Before launching any future provider, rollback is only links/manifest: restore
fm/fmp to the exact primary paths above, restore each managed skill symlink's
recorded raw target and the original Codex installer manifest, then compare the
full inventory to the snapshot. Verify Surface's raw link, Codex's link and
native binary hash, and primary HEAD/status/dirty hash remain unchanged. Retain
the new stable checkout even after rollback; saved hook settings may later name
it. Never run bare install to roll back (it would relink Surface). Do not stop
or restart a conversation during rollback. App config/service opt-out is owned
by a separate deliberate adoption/recovery step, not this link rollback.

## Verification boundary

Fresh candidate gates and author self-review live under
`~/.fm2/briefs/tabtail-runtime-integration/`, separate from prior rehearsal logs.
Run the full Node/installer gate, actual native input gate and full released
Relay bridge/native suite serially for native cases, with private homes/sockets
and localhost-only services. Installer mutation experiments use an isolated
HOME/bin and minimal PATH. The historical Rust build/TUI results in
`codex/native-footer/README.md` are not new evidence; no binary was rebuilt.
Mandatory fresh independent six-judge/meta-review still belongs to root before
merge/deployment. No forge approval, Surface decision, physical phone command
or Codex alert is implied by passing local tests.
