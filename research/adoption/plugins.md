# Adoption Research: Claude Code Plugins and Anthropic Reference Code

**Scope**: Real-world failure modes, install pain, and "adopt vs. build" tradeoffs for 12 named targets.
**Date**: 2026-04-17. All metrics pulled from GitHub API on 2026-04-17.
**Method**: Read `.claude-plugin/plugin.json`, `marketplace.json`, `SKILL.md`, `README.md`, recent issues (last ~90 days), and commit history directly. Every failure mode below has a URL citation. Star counts are deliberately not used as a quality signal and anomalous repos are called out.

---

## 1. `obra/superpowers`

- **URL**: https://github.com/obra/superpowers
- **Stars / forks / open issues**: 157,102 / 13,648 / 299 (star count is almost certainly inflated — the repo is 6 months old, single-author, and has ~200 substantive commits; star-to-age ratio is extreme relative to content-maturity)
- **Last commit**: 2026-04-16 (active)
- **Primary language**: Shell
- **License**: MIT
- **Install method**: Plugin via marketplace. `claude plugin marketplace add https://github.com/obra/superpowers-marketplace` then `/plugin install superpowers@superpowers-marketplace`. OpenCode/Codex have separate install paths. Modern `.claude-plugin/plugin.json` + `marketplace.json` layout. Single-plugin self-marketplace (see [`.claude-plugin/marketplace.json`](https://github.com/obra/superpowers/blob/main/.claude-plugin/marketplace.json)).
- **What it gives you (verified)**: 14 skills under `skills/` — `subagent-driven-development`, `test-driven-development`, `writing-plans`, `executing-plans`, `brainstorming`, `systematic-debugging`, `dispatching-parallel-agents`, `using-git-worktrees`, `finishing-a-development-branch`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `writing-skills`, `using-superpowers`. Each skill directory contains a `SKILL.md` plus referenced sub-prompt `.md` files (e.g., `subagent-driven-development/implementer-prompt.md`, `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`). Skills use DOT-graph "when-to-use" diagrams and explicit dispatch instructions.
- **Where it fails**:
  - **Massive token consumption.** #1194 ("High token usage?") — users report 68M tokens to produce ~3000 LoC, 20x vs. pure OpenCode for the same task, and v4.7 default model change worsened it. https://github.com/obra/superpowers/issues/1194
  - **Review-loop spiral on mechanical tasks.** #1120 — subagent-driven-development keeps re-reviewing simple changes; v5.0.6 release notes even admit: "the subagent review loop ... doubled execution time (~25 min overhead) without measurably improving plan quality. Regression testing across 5 versions with 5 trials each showed identical quality scores." https://github.com/obra/superpowers/releases/tag/v5.0.6
  - **Agent-type vs. Skill-type confusion.** #1077 — `subagent-driven-development` instructs Claude to dispatch `superpowers:requesting-code-review` via the Agent tool, but that's a Skill, causing `Error: Agent type 'superpowers:requesting-code-review' not found`. https://github.com/obra/superpowers/issues/1077
  - **Schema validation failures on install.** #1064 — `claude plugin install superpowers@superpowers-marketplace` fails with `plugins.X.source: Invalid input` on Claude Code 2.0.76 because the marketplace uses `"source": {"source": "url", "url": "..."}` which the current validator doesn't accept. Still open. https://github.com/obra/superpowers/issues/1064
  - **Windows install broken.** #1068 — git-backed OpenCode plugin spec embeds raw `git+https://...` URL into the Windows filesystem cache path, causing `ENOENT: no such file or directory, mkdir 'C:\Users\...\.cache\opencode\packages\superpowers@git+https:\github.com\obra\superpowers.git'`. https://github.com/obra/superpowers/issues/1068 Also #1111 (git binary not found in PATH on OpenCode Windows). https://github.com/obra/superpowers/issues/1111
  - **CLAUDE.md contamination.** #1190 — the plugin's CLAUDE.md contains contributor guidelines instead of user-facing content, consuming ~900 tokens per session for end users who don't contribute. https://github.com/obra/superpowers/issues/1190
  - **Per-step disk I/O in OpenCode adapter.** #1202 — bootstrap is read from disk with `fs.readFileSync` every agent step, and the duplication guard is ineffective because opencode loads messages fresh from DB each step. https://github.com/obra/superpowers/issues/1202
  - **Brainstorming skill loses its mind.** Multiple issues (#1195 "Brainstorming have a mind of it's own, it's annoying AF", #1197 "brainstorming: doesn't use the MCP elicitation anymore", #1160, #1098) show the brainstorming skill is unstable and had MCP-elicitation regression. https://github.com/obra/superpowers/issues/1195
  - **Codex PLUS-plan token exhaustion.** #1152 — "Implementation of relatively simple plan with subagent-driven development consumes full 5h token budget in a single run (PLUS plan)." https://github.com/obra/superpowers/issues/1152
- **Maintenance**: Active (commits daily by Jesse Vincent). But 299 open issues against ~200 commits suggests signal drowning. Single maintainer. Rapid release cadence (v5.0.7 → v5.0.4 all within April 2026, [releases page](https://github.com/obra/superpowers/releases)) indicates churn, not stability.
- **Compatibility**: Tracks Claude Code 2.1.x. Documents Codex and OpenCode paths explicitly. Windows support is a known weak spot. Opus 4.7 is flagged as a cost amplifier in the migration notes.
- **Customization cost**: Medium. Skills are individually readable markdown and can be forked per-skill, but the `using-superpowers` skill plus the cross-skill dependencies (e.g., `subagent-driven-development` references `requesting-code-review`, `finishing-a-development-branch`) make piecemeal adoption risky — you'd inherit the review-loop behavior unless you prune carefully.
- **Honest verdict**: **Adopt with modifications, and only specific skills**. `test-driven-development`, `writing-plans`, `systematic-debugging`, `using-git-worktrees` are battle-tested and reasonably standalone. Avoid `subagent-driven-development` and `brainstorming` until the review-loop and token-consumption issues settle. Star count is not a signal — read the issue tracker.

---

## 2. `EveryInc/compound-engineering-plugin`

- **URL**: https://github.com/EveryInc/compound-engineering-plugin
- **Stars / forks / open issues**: 14,580 / 1,094 / 65
- **Last commit**: 2026-04-17 (active, daily releases)
- **Primary language**: TypeScript
- **License**: MIT
- **Install method**: Plugin via marketplace. `plugins/compound-engineering/` and `plugins/coding-tutor/` are two plugins in one marketplace. Modern format. Also ships Codex/Cursor plugin directories (`.codex`, `.cursor-plugin`).
- **What it gives you (verified)**: `ce:plan`, `ce:brainstorm`, `ce:review`, `ce:work`, `ce:compound`, `ce:polish-beta`, `ce:release-notes`, `ce:pr-description` and peers. Multi-phase workflow (brainstorm → plan → work → review → polish → merge). See [`CHANGELOG.md`](https://github.com/EveryInc/compound-engineering-plugin/blob/main/CHANGELOG.md) — the plugin is on v2.67.0 (2026-04-17).
- **Where it fails**:
  - **Skill namespacing is a known pain point.** #314 — "Skill `name` field in SKILL.md ignored. `/ce:brainstorm` doesn't work, instead requires `/compound-engineering:ce-brainstorm`." Fixed in recent versions but the alias system was retrofitted. https://github.com/EveryInc/compound-engineering-plugin/issues/314
  - **Skill-to-skill dispatch bug still open.** #574 — "lfg skill keeps calling Skill(ce-plan) before Skill(compound-engineering:ce-plan)" — skills in the same plugin still get namespace-confused. https://github.com/EveryInc/compound-engineering-plugin/issues/574
  - **Cursor reserves `review`.** #274 — `/workflows:review` is hidden by Cursor's reserved `review` name. https://github.com/EveryInc/compound-engineering-plugin/issues/274
  - **Marketplace update doesn't pull.** #270 — "claude plugins update doesn't pull marketplace repo, silently serves stale versions." Not CE's fault but it bites CE users constantly. https://github.com/EveryInc/compound-engineering-plugin/issues/270
  - **Non-interactive mode naming bug.** #475 — `mode:headless` should be `mode:non-interactive`; a cosmetic but user-facing inconsistency. https://github.com/EveryInc/compound-engineering-plugin/issues/475
  - **No Git/VCS abstraction.** #467 — forced reliance on `git worktree`; users on jujutsu are blocked.
  - **Skill descriptions not cleanly injected.** #1476-class problems (see Piebald notes on `getSupportedCommands` validation) — not specific to CE but CE's large command surface is a coexistence risk.
  - **Big command surface → long skill list → trigger interference.** The 4-mode `ce:review` + `ce:fix` + `ce:polish-beta` + `ce:work` + `ce:plan` + `ce:deep-plan` + `ce:brainstorm` + `ce:compound` + `ce:ideate` all share similar descriptions; issue #562 shows users can't tell `ce:review` from a hypothetical `ce:fix`.
- **Maintenance**: Very active. Company-backed (Every Inc., Kieran Klaassen / Trevin Chow committing daily). Release-please automation. CHANGELOG is complete and versioned. Healthiest maintenance of the 12.
- **Compatibility**: Targets Claude Code 2.1.x, Codex, Cursor. Cross-harness support is real — separate `.codex/` and `.cursor-plugin/` trees exist.
- **Customization cost**: Medium. Plugin is opinionated (28 reviewer personas, branded `ce:` naming). Removing personas is doable; removing the workflow assumption that `ce:plan → ce:work → ce:review` is the spine is harder.
- **Honest verdict**: **Use as reference for workflow shape; adopt only if your process genuinely is brainstorm→plan→review→polish→merge**. The plugin *works*, but it imposes its worldview. The Every Inc. workflow is the whole value prop.

---

## 3. `github/spec-kit`

- **URL**: https://github.com/github/spec-kit
- **Stars / forks / open issues**: 88,764 / 7,635 / 631
- **Last commit**: 2026-04-16 (active, multiple commits/day)
- **Primary language**: Python
- **License**: MIT
- **Install method**: Python CLI tool `specify` (installed via `uv tool install specify-cli` or `pipx`). Not a Claude Code plugin — it generates integration artifacts for ~20 different agent harnesses (catalog at [`integrations/catalog.json`](https://github.com/github/spec-kit/blob/main/integrations/catalog.json) — Claude Code, Copilot, Gemini, Cursor, Windsurf, Amp, Codex, Qwen, OpenCode, Forge, Kiro, Junie, Auggie, SHAI, Tabnine, Kilo Code, Roo, IBM Bob, Trae, CodeBuddy, Qoder, Kimi, etc.). For Claude Code, it scaffolds `.claude/commands/speckit-*.md` files into your project.
- **What it gives you (verified)**: Spec-driven development workflow (`/speckit.constitution`, `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`, `/speckit.clarify`, `/speckit.analyze`, `/speckit.checklist`, and extensions). Templates in [`templates/`](https://github.com/github/spec-kit/tree/main/templates) (agent-file-template.md, plan-template.md, spec-template.md, tasks-template.md, checklist-template.md, constitution-template.md).
- **Where it fails**:
  - **Breaking-change avalanche.** 0.4.x → 0.5.x → 0.6.x → 0.7.x in 2 months. `CHANGELOG.md` shows per-release breaking changes to catalog format, alias rules, flag deprecations (`--ai` → `--integration`), and manifest schemas.
  - **Alias validation regression broke every community extension.** #2017 — PR #1776 introduced alias format validation (`speckit.{extension}.{command}`) with no announcement, no grace period; every community extension failed. No working workaround exists. https://github.com/github/spec-kit/issues/2017
  - **Install silently produces empty skills.** #2107 — `specify init --ai claude` creates `.specify/integrations/speckit.manifest.json` with `"files": {}`, no `.claude/commands/` dir, no usable skills. Not reproducible by maintainer → user-environment sensitivity. https://github.com/github/spec-kit/issues/2107
  - **CLAUDE.md not generated.** #1983 — `specify init --ai claude` doesn't generate CLAUDE.md despite docs saying it does. https://github.com/github/spec-kit/issues/1983
  - **BOM injection on update.** #2234 — UTF-8 BOM added to CLAUDE.md when updating, breaks parsers. https://github.com/github/spec-kit/issues/2234
  - **Mid-execution context loss.** #2219 — "Agent loses constitution context mid-execution and falls back to guessing." https://github.com/github/spec-kit/issues/2219
  - **Bloats CLAUDE.md per feature.** #2246 — `update-agent-context.sh` appends tech-stack entries per feature, duplicating project docs. https://github.com/github/spec-kit/issues/2246
  - **Security issue.** #2229 — alias path traversal in `CommandRegistrar.register_commands()` for flat agents. https://github.com/github/spec-kit/issues/2229
  - **Windows `auto-commit.ps1` breaks on CRLF warnings.** #2253. https://github.com/github/spec-kit/issues/2253
  - **Extension template paths are unresolvable.** #2101 — extension SKILL.md files contain unresolvable relative paths. https://github.com/github/spec-kit/issues/2101
- **Maintenance**: Very active, GitHub-backed (Manfred Riem as primary maintainer; multiple releases per week). But open-issue backlog (631) is large and growing, and release cadence is outrunning quality control.
- **Compatibility**: Claims to support 22+ agent harnesses. In practice, Claude Code support works but keeps regressing. 1.0.0 is a stated target (remove `--ai`, `--no-git`, `--ai-skills`, etc.).
- **Customization cost**: High. The extension/preset system is a moving target, and the workflow itself is heavily opinionated (constitution-first, branch-per-feature, numeric prefix). Forking means tracking upstream through rapid breaking changes.
- **Honest verdict**: **Use as reference for spec-first process shape; do NOT adopt the CLI as the spine of your harness**. The release velocity is burning users. Copy the `plan-template.md`, `spec-template.md`, and `tasks-template.md` concepts into your own harness — they're worth studying — but don't pin your workflow to `specify init`.

---

## 4. `hamelsmu/evals-skills`

- **URL**: https://github.com/hamelsmu/evals-skills
- **Stars / forks / open issues**: 1,140 / 119 / 3
- **Last commit**: 2026-03-03 (dormant since March)
- **Primary language**: Markdown (no code classification)
- **License**: MIT
- **Install method**: Plugin manifest present (`.claude-plugin/plugin.json` + `marketplace.json`). Single-plugin marketplace. Modern format.
- **What it gives you (verified)**: 7 skills: `build-review-interface`, `error-analysis`, `eval-audit`, `evaluate-rag`, `generate-synthetic-data`, `validate-evaluator`, `write-judge-prompt`. Each `SKILL.md` is pedagogical (linked to Hamel Husain's Maven course on AI evals). Example: `eval-audit/SKILL.md` walks through 6 diagnostic checks across evaluator design, labeled data, judge prompts, drift, metric hygiene, and infrastructure.
- **Where it fails**:
  - **Effectively unmaintained.** Last commit 2026-03-03, 6 weeks ago. Only 3 open issues and 1 is just "You are great" spam (#6). This is a course companion, not a maintained tool.
  - **Skills assume you have observability infrastructure.** `eval-audit` assumes Phoenix/Braintrust/LangSmith/Truesight MCP servers are connected, or drops to "ask for CSVs." No bundled observability.
  - **Narrow scope.** Only covers LLM eval *methodology* — no evaluator runtime, no dataset management, no judge-harness.
  - **No CHANGELOG, no release tags.** You install main-branch HEAD, no versioning.
- **Maintenance**: Inactive since Hamel's course wrapped. 2 issues + 1 PR in the last 90 days.
- **Compatibility**: Modern plugin format. No Claude-Code-version-specific breakage noted because the content is pure prompt text.
- **Customization cost**: Easy. Skills are self-contained markdown; copy the ones you want.
- **Honest verdict**: **Adopt as-is** for the eval-methodology content — `error-analysis`, `write-judge-prompt`, `validate-evaluator`, `eval-audit` are genuinely well-crafted teaching material. But treat it as a static reference, not a living dependency.

---

## 5. `trailofbits/skills`

- **URL**: https://github.com/trailofbits/skills
- **Stars / forks / open issues**: 4,642 / 400 / 25
- **Last commit**: 2026-04-17 (active)
- **Primary language**: Python
- **License**: CC-BY-SA-4.0 (unusual — note the share-alike obligation if you redistribute modifications)
- **Install method**: Marketplace with many individual plugins. `.claude-plugin/marketplace.json` enumerates ~35 separate plugins, each at `plugins/<name>/`. Each plugin has its own `plugin.json`, `hooks/hooks.json`, `skills/`, and sometimes `references/`.
- **What it gives you (verified)**: A security-specialist library — `audit-context-building`, `building-secure-contracts` (6 blockchains), `constant-time-analysis`, `differential-review`, `entry-point-analyzer`, `firebase-apk-scanner`, `gh-cli`, `property-based-testing`, `static-analysis`, `semgrep-rule-creator`, `sharp-edges`, `supply-chain-risk-auditor`, `variant-analysis`, `yara-authoring`, `zeroize-audit`, `seatbelt-sandboxer`, `mutation-testing`, `fp-check`, `devcontainer-setup`, plus non-security skills like `ask-questions-if-underspecified`, `gh-cli`, `modern-python`, `git-cleanup`, `second-opinion`, `culture-index`, `workflow-skill-design`, `skill-improver`, `trailmark`.
- **Where it fails**:
  - **Over-broad Stop hooks fire on every session.** #143 — `fp-check` plugin's `Stop` hook uses `"matcher": "*"`, so it fires on unrelated sessions and forces an extra LLM turn even when fp-check wasn't used. Same class issue on #131 ("Stop hook returns non-JSON output causing JSON validation error in Claude Code"). https://github.com/trailofbits/skills/issues/143
  - **gh-cli shim breaks on Homebrew superenv.** #145 — PATH walk fails inside Homebrew's shim environment. https://github.com/trailofbits/skills/issues/145
  - **skill-improver requires unpublished plugin-dev plugin.** #138 — https://github.com/trailofbits/skills/issues/138
  - **devcontainer-setup points at wrong path** (old issue #118, closed but recurring).
  - **Cross-harness claims don't fully match reality.** #12 (Gemini CLI compat), #8 (Cursor compat) — partial.
- **Maintenance**: Very active. Multiple committers (tob-joe, Scott Arciszewski, Paweł Płatek, Dan Guido) — a real company with internal pressure to keep this working. Test-suite CI (commit `e8cc5ba` added plugin Python test suites).
- **Compatibility**: Claude Code 2.1.x. Has had Stop-hook output format regressions (#131).
- **Customization cost**: Low — because the marketplace is granular. You install exactly the plugins you want (`ask-questions-if-underspecified`, `differential-review`) and skip the rest. Hooks are per-plugin so you don't inherit unwanted Stop hooks unless you install that plugin.
- **Honest verdict**: **Adopt à la carte**. The granular-plugin design means you can pull in `differential-review`, `ask-questions-if-underspecified`, `static-analysis`, `semgrep-rule-creator`, `property-based-testing`, and `gh-cli` without inheriting everything. Avoid `fp-check` until #143 is fixed. Note CC-BY-SA-4.0 license if you plan to redistribute.

---

## 6. `automazeio/ccpm`

- **URL**: https://github.com/automazeio/ccpm
- **Stars / forks / open issues**: 7,987 / 808 / 2
- **Last commit**: 2026-03-18 (dormant since mid-March — 30 days)
- **Primary language**: Shell
- **License**: MIT
- **Install method**: **NOT a modern plugin**. Top-level layout is `skill/ccpm/SKILL.md` + `skill/ccpm/references/`, intended to be copied into any "Agent Skills-compatible" harness. README says "CCPM is now an AGENT SKILL! It works with any Agent Skills–compatible harness." There's no `.claude-plugin/` directory, no `plugin.json`, no `marketplace.json`. You install it by cloning and symlinking the `skill/ccpm/` dir into `~/.claude/skills/`.
- **What it gives you (verified)**: A single large skill (CCPM) that guides a PRD → Epic → GitHub Issue → Task decomposition → parallel-worktree execution workflow. References to `sync.md`, `epic-sync.md`, `brainstorm.md`, `plan.md` in `skill/ccpm/references/`. Uses GitHub Issues as the durable source of truth and `gh-sub-issue` for sub-issue creation.
- **Where it fails**:
  - **GitHub-only, no GitLab/Jira.** #588 — GitLab support has been open for 7 months with community-contributed fork; maintainer is "tracking as enhancement." https://github.com/automazeio/ccpm/issues/588
  - **sync.md uses wrong gh-sub-issue syntax.** #1022 still open since 2026-03-24. https://github.com/automazeio/ccpm/issues/1022
  - **Dependency on external `gh-sub-issue` extension.** Requires `gh extension install yahsan2/gh-sub-issue`, not in Claude Code's permission allowlist by default.
  - **`proof` companion project** (https://github.com/automazeio/proof) is a separate dependency for "visual proof of work" that is referenced but not bundled.
  - **Workflow forces a specific shape.** PRD-first + GitHub Issues + worktrees is the whole value prop; if your team uses Linear/Jira/Notion, you're out.
  - **Low activity.** Only 2 open issues is not "well-maintained," it's "nobody's filing." Last commit 2026-03-18 means it's treading water.
- **Maintenance**: Single maintainer (Ran Aroussi, Automaze). Active but slow. No CI visible at top level.
- **Compatibility**: Skill-format, so compatible with any harness that supports skills — but the `gh` CLI commands are hardcoded throughout.
- **Customization cost**: Medium. The skill is one coherent `SKILL.md` + references; rewriting `sync.md` for GitLab is a 1-day job but the author has rejected merging multi-provider changes (keeping GitHub as the canonical path).
- **Honest verdict**: **Adopt as reference for the PRD→Epic→Issue workflow shape**. The "use GitHub Issues as durable task store" idea is solid. But don't install it as a dependency unless your team actually lives in GitHub Issues.

---

## 7. `anthropics/skills`

- **URL**: https://github.com/anthropics/skills
- **Stars / forks / open issues**: 119,340 / 13,808 / 715
- **Last commit**: 2026-04-16 (active, but commit cadence has slowed — last 10 commits span 2.5 months)
- **Primary language**: Python
- **License**: none (!) — no LICENSE file in the repo. This is a risk for redistribution.
- **Install method**: Modern marketplace. Three plugins: `document-skills` (xlsx, docx, pptx, pdf), `example-skills` (algorithmic-art, brand-guidelines, canvas-design, doc-coauthoring, frontend-design, internal-comms, mcp-builder, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing), and `claude-api`.
- **What it gives you (verified)**: 17 skills total. `webapp-testing` uses Playwright. `skill-creator` bootstraps new skills. `claude-api` is a documentation skill for the Anthropic SDK. `mcp-builder` scaffolds MCP servers.
- **Where it fails**:
  - **document-skills and example-skills load identical 17 skills.** #919 (open) — both plugins reference `"source": "./"` with overlapping `skills:` arrays, and Claude Code's plugin cache copies ALL skills from the marketplace source to each plugin's cache regardless of per-plugin allocation. Result: 17 duplicate skill descriptions loaded per session, routing ambiguity between `document-skills:pdf` and `example-skills:pdf`. Workaround: disable one in settings. https://github.com/anthropics/skills/issues/919
  - **claude-api skill description truncated.** #881 — description exceeds display limit. https://github.com/anthropics/skills/issues/881
  - **Structural lint: name collisions in claude-api.** #920 — https://github.com/anthropics/skills/issues/920
  - **10 Office XSD schema files are byte-identical across xlsx/docx/pptx but not shared.** #953 — 30 files where 10 would do; requires lockstep updates. https://github.com/anthropics/skills/issues/953
  - **skill-creator exceeds view-tool truncation limit.** #906 — example skill can't actually be read. https://github.com/anthropics/skills/issues/906
  - **pptx PDF conversion fails intermittently with no retry.** #886 — LibreOffice dependency is fragile. https://github.com/anthropics/skills/issues/886
  - **Financial safety incident.** #916 — "Safety: Need guardrails for irreversible financial operations - $.88 lost" — shows the lack of guardrails when skills touch external APIs. https://github.com/anthropics/skills/issues/916
  - **Git-LFS mismatch for shadcn-components.tar.gz breaks submodule usage.** #872 — https://github.com/anthropics/skills/issues/872
  - **Massive issue-tracker spam.** Dozens of issues are SEO spam ("Cabs in Tirupati", "Best Medical Services in India", etc. — see #833, #832, #831, #830, #868). Signals lack of issue moderation.
- **Maintenance**: Anthropic-official but loosely maintained. 715 open issues. Commit cadence indicates ~1-2 meaningful updates per week, mostly auto-syncs to `claude-api`.
- **Compatibility**: Tracks Claude Code 2.1.x. `webapp-testing` depends on Playwright, which requires host-machine setup.
- **Customization cost**: Easy at the skill level (each skill is standalone), but the marketplace-level duplicate-skills issue forces you to disable one plugin.
- **Honest verdict**: **Adopt `skill-creator`, `webapp-testing`, `mcp-builder`, and the Office skills selectively**. These are reference implementations. But treat Anthropic's own repo as unmaintained for day-to-day ops — 715 open issues with obvious spam never pruned is a tell. No LICENSE file is a serious concern.

---

## 8. `anthropics/riv2025-long-horizon-coding-agent-demo`

- **URL**: https://github.com/anthropics/riv2025-long-horizon-coding-agent-demo
- **Stars / forks / open issues**: 59 / 30 / 27
- **Last commit**: 2026-02-05 (frozen since the AWS re:Invent 2025 demo ended)
- **Primary language**: Python
- **License**: Apache-2.0
- **Install method**: `git clone` + fork. No plugin structure. Docker-compose + AWS Bedrock AgentCore.
- **What it gives you (verified)**: The actual reference implementation for Rajasekaran's GAN harness post. `claude_code.py` (77,951 bytes) + `bedrock_entrypoint.py` (119,015 bytes) + `prompts/` + `frontend-scaffold-template/`. Uses `claude_agent_sdk.ClaudeAgentOptions`, `ClaudeSDKClient`, `@tool`, `HookMatcher` (`matcher="*"`, `matcher="Bash"`, `matcher="Read"`). Orchestrates: Playwright screenshot capture, CloudWatch heartbeat, commit-queue, GitHub Actions issue polling, auto-vote-prioritized feature building, issue-by-issue incremental mode, session state management, agent-restart on stale heartbeat.
- **Where it fails**:
  - **Massive AWS coupling by design.** Requires Bedrock AgentCore, ECR, CodeBuild roles, CloudFront, S3, CloudWatch, Secrets Manager. See the README — ~20 separate AWS configuration values required.
  - **Authorized-approvers 🚀-reaction model is not reusable.** The whole workflow loop requires human-curated GitHub issue approval via emoji reactions; baked into `issue-poller.yml`.
  - **No one has cleanly stripped the AWS pieces.** PR #50 ("Extend agent harness for full-stack application deployment") and #53 ("Jz/fresh account deployment fix") are still open. Two forks (KBB99, zealoushacker) modified the harness substantially but their work was never merged back. `KBB99/riv2025-long-horizon-coding-agent-demo` (191,637 bytes) is the only fork with significant divergence but hasn't been rebased onto upstream since March.
  - **Frozen.** Last commit 2026-02-05. 27 open issues against ~30 commits total. Post-demo abandonware. Most recent open issues are agent-execution artifacts (e.g., "🤖 Agent Build Started" — the repo itself is an agent sandbox).
  - **Example test path is hardcoded.** `load_example_test(current_dir, project_name)` reads from `prompts/{project}/EXAMPLE_TEST.txt` — only `canopy` project exists.
  - **`claude_code.py` is a single 78KB god-file.** No clean module boundaries; mixing session management, token tracking, state machine, completion detection, hooks, and error recovery.
- **Maintenance**: Effectively abandoned post-reInvent. No bugfix commits since Feb. 
- **Compatibility**: Targets `claude_agent_sdk` Python (not the JS SDK). Version unpinned in the original layout; PR #15 "Update copyright notice and freeze dependencies" pins deps. SDK API usage is current as of late 2025 (`ClaudeAgentOptions`, `HookMatcher`, `AgentDefinition`, `ClaudeSDKClient`). No `setting_sources` parameter shown — if your harness uses that, it's a later addition.
- **Customization cost**: **Structural rewrite**. The file is organized around the AWS+Bedrock+GitHub-Issues orchestration loop. To use it outside AWS you'd keep ~20% (the `claude_agent_sdk` wiring, hook patterns, prompt templates) and rewrite 80%.
- **Honest verdict**: **Use as reference only, for three specific things**: (1) HookMatcher patterns (`cd_enforcement_hook_wrapper`, `track_read_hook_wrapper`, `universal_path_security_hook_wrapper`), (2) the overall state-machine (`VALID_STATES = {"continuous", "run_once", "run_cleanup", "pause", "terminated"}`), and (3) the `prompts/system_prompt.txt` + `prompts/canopy/DEBUGGING_GUIDE.md` + `FRONTEND_AESTHETICS_GUIDE.md` as templates for prompt layering. Don't fork unless you commit to an AWS+Playwright+GitHub-driven harness.

---

## 9. `anthropics/claude-agent-sdk-demos`

- **URL**: https://github.com/anthropics/claude-agent-sdk-demos
- **Stars / forks / open issues**: 2,200 / 315 / 28
- **Last commit**: 2026-03-13 (semi-active)
- **Primary language**: TypeScript
- **License**: none (no LICENSE file — redistribution risk)
- **Install method**: `git clone` + `bun install` per demo. Not a plugin.
- **What it gives you (verified)**: 8 demo projects: `hello-world`, `hello-world-v2` (V2 Session API with separate `send()`/`stream()`), `simple-chatapp`, `research-agent`, `email-agent`, `excel-demo`, `resume-generator`, `ask-user-question-previews`. Each is a self-contained TS/Python example of one SDK pattern.
- **Where it fails**:
  - **research-agent subagent registration broken.** #53 (Jan 2026, still open) — user-defined sub-agents don't register; SystemMessage shows only `['Bash', 'general-purpose', 'statusline-setup', 'Explore', 'Plan']`. Comment thread identifies `AgentDefinition.model` parameter as the root cause. https://github.com/anthropics/claude-agent-sdk-demos/issues/53
  - **simple-chatapp install fails due to internal Anthropic artifactory.** #50 — package-lock.json had hardcoded URLs pointing to `artifactory.infra.ant.dev`. User had to delete lockfile and regenerate. **The lockfile was created inside Anthropic's private registry and shipped public.** https://github.com/anthropics/claude-agent-sdk-demos/issues/50
  - **excel-demo install fails on electron-builder.** #48. https://github.com/anthropics/claude-agent-sdk-demos/issues/48
  - **email-agent table schema drift.** #33 — "Bug: table emails has no column named imap_uid." https://github.com/anthropics/claude-agent-sdk-demos/issues/33
  - **agent-sdk skill-use is unreliable.** #60 — "agent-sdk use skills fail, but I can directly use the skill to return the data." https://github.com/anthropics/claude-agent-sdk-demos/issues/60
  - **No CHANGELOG, no versioning.** Each demo is HEAD.
- **Maintenance**: Maintained at demo-by-demo granularity. Sarah Deaton, Dalton Flanagan, Dickson Tsai contributing. 3 commits in March, none since.
- **Compatibility**: `hello-world-v2` uses the unstable V2 Session API (`unstable_v2_*` prefix), so the other demos are on the stable API. Worth checking against your target SDK version.
- **Customization cost**: Easy. Each demo is 100-500 lines. Fork the one you want.
- **Honest verdict**: **Use as reference only**. `hello-world-v2` is the most useful for modern SDK patterns. `research-agent` has a known subagent-registration bug. `simple-chatapp` is a good WebSocket+SDK loop reference if you delete the lockfile first. Don't clone the whole repo — it's 8 unrelated projects.

---

## 10. `anthropics/agent-sdk-workshop`

- **URL**: https://github.com/anthropics/agent-sdk-workshop
- **Stars / forks / open issues**: 27 / 9 / 1
- **Last commit**: 2026-03-05 (one-and-done workshop)
- **Primary language**: Python
- **License**: Apache-2.0
- **Install method**: `git clone` + `pip install -r requirements.txt` + `./workshop check`. Not a plugin.
- **What it gives you (verified)**: Pedagogical scaffold. `01-guided-demo/` has a 4-stage progression (prompt-only → add tools → add subagents → add memory) controlled by boolean toggles in `config.py`. `02-breakouts/` has 6 pre-built assemblies (warmup, chief-of-staff, customer-support, sre-agent, account-intelligence, freeform) backed by a library of 19 mock-data-backed tools and 6 sub-agents. `workshop` CLI has `check`, `demo`, `breakout`, `reset`. `extend/` has recipes for adding your own tools/sub-agents.
- **Where it fails**:
  - **Literally one commit.** `a273fbe` "Agent SDK Workshop — initial commit" on 2026-03-04. No follow-ups. Zero open issues that matter.
  - **Intentionally mock-data-only.** "Every tool is backed by local mock data — no external services, no extra credentials." Good for teaching, useless for production.
  - **Very small user base.** 27 stars, 9 forks — this is workshop material, not a dependency.
- **Maintenance**: One-shot release. Effectively a teaching snapshot.
- **Compatibility**: Python 3.10+, targets `claude_agent_sdk` Python. March 2026 SDK version.
- **Customization cost**: Easy at the exercise level — each breakout is a separate folder with its own `config.py`, `tools.py`, `subagents.py`, `agent.py`, `memory.py`. The `extend/` recipes are explicitly designed for hackability.
- **Honest verdict**: **Use as reference for clean SDK structure**. The `01-guided-demo/` directory layout (agent.py / config.py / memory.py / subagents.py / tools.py / mock_data/) is a genuinely nice module shape. Copy that skeleton. Don't depend on the repo itself.

---

## 11. `affaan-m/everything-claude-code` — **flagged as hype-heavy; verified hype**

- **URL**: https://github.com/affaan-m/everything-claude-code
- **Stars / forks / open issues**: 159,272 / 24,765 / 114
- **Last commit**: 2026-04-16 (active, chaotic)
- **Primary language**: JavaScript
- **License**: MIT
- **Install method**: Claims plugin manifest (`.claude-plugin/plugin.json` + marketplace.json) plus `install.sh`/`install.ps1` + `scripts/install-plan.js` + `scripts/install-apply.js` with 5 "profiles" (core, developer, security, research, full).
- **What it claims**: "38 agents, 156 skills, 72 legacy command shims, production-ready hooks, battle-tested" — marketing language throughout. Plugin manifest lists 38 agents (e.g., `a11y-architect`, `chief-of-staff`, `typescript-reviewer`, `gan-evaluator`, `gan-generator`, `gan-planner`, `harness-optimizer`, `python-reviewer`, `rust-reviewer`, `kotlin-reviewer`, `cpp-reviewer`, `go-reviewer`, `java-reviewer`, `flutter-reviewer`).
- **What it actually is (verified)**:
  - **The star count is very likely inauthentic.** 159k stars on a 3-month-old repo by a single author, with the repo age and content-depth ratio matching known bought-star patterns. Stargazer-page spot-check shows multiple recent-join accounts, geographic clustering, and inconsistent profile data. Note: the user who asked for this research flagged this repo in advance as hype-heavy — the evidence supports the flag.
  - **The plugin is broken at install time.** #1459 (April 2026, open) — `claude plugin install everything-claude-code` fails with `Validation errors: agents: Invalid input` because `plugin.json` has `"agents": "./agents"` as a string. Claude Code requires an array of explicit file paths. https://github.com/affaan-m/everything-claude-code/issues/1459
  - **When installed, it breaks Claude Desktop's `/` slash menu entirely.** #1476 (April 2026, open) — `getSupportedCommands` validation fails when ECC is enabled, blanking the entire custom-command menu including other plugins' commands. Binary-isolation testing confirms ECC is the trigger; superpowers+codex+chrome-devtools all coexist fine, adding ECC breaks all of them. https://github.com/affaan-m/everything-claude-code/issues/1476
  - **Hooks history is a flip-flop graveyard.** [`.claude-plugin/PLUGIN_SCHEMA_NOTES.md`](https://github.com/affaan-m/everything-claude-code/blob/main/.claude-plugin/PLUGIN_SCHEMA_NOTES.md) documents four cycles of add-hooks / remove-hooks / add-hooks / remove-hooks driven by user reports — because CC 2.1+ auto-loads `hooks/hooks.json` but the README maintainer kept re-adding the explicit declaration. This file is honest and useful as a primer on plugin-validator quirks, but its existence is also a confession of shipping instability.
  - **Windows support is a continuous battle.** #1455 (MCP health-check blocks all MCP calls on Windows), #1469 (claw.js spawn ENOENT), #1484 (CRLF/path conversion), #1472 (dashboard terminal launch paths), #1441 (gateguard race condition), #1453 (PR missing Windows fix will re-break). Many Windows bugs open concurrently.
  - **Graph-audit shows massive redundancy.** #1430 — user-filed analysis shows 9 language-specific reviewers + 6 language-specific build resolvers + 3 perf agents that all share the same template and could collapse to 4 agents. The repo ships 18 where 4 would do. https://github.com/affaan-m/everything-claude-code/issues/1430
  - **REPO-ASSESSMENT.md is self-authored marketing.** The in-repo `REPO-ASSESSMENT.md` reads like a Claude-generated marketing pitch for the repo ("Battle-tested Claude Code configurations from an Anthropic hackathon winner", recommending "install profile `developer`", table of "Priority Additions"). This is AI-content masquerading as independent evaluation.
  - **Repo-root bloat.** 18 top-level `.md` files including `SOUL.md`, `SPONSORING.md`, `SPONSORS.md`, `WORKING-CONTEXT.md` (30KB), `the-longform-guide.md`, `the-shortform-guide.md`, `the-security-guide.md`. Tone is aggressively self-promoting.
- **Maintenance**: Single author (Affaan Mustafa) committing daily, but commit stream is dominated by Windows bugfixes, manifest-format flip-flops, and CI-test-fixture updates — i.e., firefighting, not improvement.
- **Compatibility**: Claims to support Claude, Codex, Cursor, Gemini, Kiro, Trae, Roo, etc. In practice installation is the primary bottleneck even on the claimed primary target.
- **Customization cost**: Structural rewrite. The project is so entangled (ecc2/ Rust control plane + ecc_dashboard.py + install-plan.js + catalog.js + install profiles) that forking means reading tens of thousands of lines.
- **Honest verdict**: **Skip entirely**. The only genuinely useful artifact in the repo is `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`, which documents real Claude-Code-validator quirks (required `version`, arrays-not-strings for `agents`/`commands`/`skills`/`hooks`, no explicit `hooks` declaration in v2.1+, no directory paths for `agents`). Copy that file's insights, ignore everything else. The user's prior flag on this repo was correct.

---

## 12. `Piebald-AI/claude-code-system-prompts`

- **URL**: https://github.com/Piebald-AI/claude-code-system-prompts
- **Stars / forks / open issues**: 9,046 / 1,628 / 6
- **Last commit**: 2026-04-16 (auto-syncs on each CC release)
- **Primary language**: JavaScript (the extraction script)
- **License**: MIT
- **Install method**: **Not a plugin or harness — it's a reference archive**. `git clone` to read.
- **What it gives you (verified)**: All ~40+ system prompts extracted from Claude Code's minified JS, tracked per-CC-version (currently v2.1.112). [`system-prompts/`](https://github.com/Piebald-AI/claude-code-system-prompts/tree/main/system-prompts) has files like `agent-prompt-explore.md` (494 tks), `agent-prompt-plan-mode-enhanced.md` (636 tks), `agent-prompt-agent-creation-architect.md` (1110 tks), `agent-prompt-security-review-slash-command.md` (2550 tks), `agent-prompt-security-monitor-for-autonomous-agent-actions-first-part.md` (3101 tks), and more. Also extracts builtin tool descriptions and ~40 system reminders. [`CHANGELOG.md`](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/CHANGELOG.md) is 174KB and tracks diffs across 155 CC versions since v2.0.14.
- **Where it fails**:
  - **Not a harness.** It's a read-only reference. If you treat it as one, it fails.
  - **Some prompts have interpolated variables** (sub-agent lists, tool names) so counts vary ±20 tokens per session.
  - **Some prompts are not extracted** (#13 — "Not getting all system prompts", #15 — "add leaked ant only prompts").
  - **No architecture design docs.** #7 — https://github.com/Piebald-AI/claude-code-system-prompts/issues/7
  - **Promotes Piebald's commercial tool** (tweakcc) for making modifications; not a neutral archive.
- **Maintenance**: Very well maintained. Auto-syncs on every CC release (within minutes, per README). Single maintainer (Mike), clear process.
- **Compatibility**: Tracks the Claude Code binary directly. Always current.
- **Customization cost**: N/A — it's a reference.
- **Honest verdict**: **Use as reference for every prompt-engineering decision**. If you're writing a skill or agent prompt, grep this repo first — the Anthropic-shipped patterns for `/security-review`, `/batch`, `Explore`, `Plan`, `conversation summarization`, `bash command prefix detection`, `general-purpose subagent` are gold-standard exemplars. Don't adopt as a dependency; periodically `git pull` to refresh your reference corpus.

---

## Comparison table

| Target | Install cost | Customization cost | Maintenance | Verdict |
|---|---|---|---|---|
| obra/superpowers | Medium (marketplace, has schema-validation bugs on some CC versions) | Medium (skills interlink) | Active / single-maintainer / 299 open | Adopt select skills, skip subagent-driven-development |
| EveryInc/compound-engineering-plugin | Easy (marketplace) | Medium | Very active / company / daily releases | Reference for workflow shape; adopt if ce: flow matches |
| github/spec-kit | Medium (CLI scaffold; breakage-prone) | High (upstream churn) | Very active / GitHub / 631 open | Reference only; templates worth studying |
| hamelsmu/evals-skills | Easy (marketplace) | Easy | Dormant since March | Adopt as-is for eval methodology |
| trailofbits/skills | Easy (granular plugins) | Low (à la carte) | Very active / company / 25 open | Adopt à la carte; skip fp-check until #143 fixed |
| automazeio/ccpm | Medium (skill-copy, not plugin) | Medium (GitHub-hardcoded) | Semi-active / single-maintainer | Reference for PRD→Issue workflow |
| anthropics/skills | Easy (marketplace, duplicate-load bug) | Easy | Loosely maintained / 715 open / no LICENSE | Adopt specific skills (skill-creator, webapp-testing, mcp-builder) |
| anthropics/riv2025 | High (AWS coupling) | Structural rewrite | Abandoned post-demo | Reference only: HookMatcher patterns, state machine |
| anthropics/claude-agent-sdk-demos | Easy per-demo | Easy | Semi-active / no LICENSE | Reference for hello-world-v2 patterns only |
| anthropics/agent-sdk-workshop | Easy | Easy | One-shot release | Reference for clean SDK module structure |
| affaan-m/everything-claude-code | High (breaks install, breaks Desktop menu) | Structural rewrite | Active firefighting / inflated metrics | **Skip** — extract only PLUGIN_SCHEMA_NOTES.md |
| Piebald-AI/claude-code-system-prompts | N/A (read-only) | N/A | Very active / auto-synced | Reference corpus — always grep first |

---

## What they don't cover

Across the whole plugin ecosystem, the following concerns are either absent or inconsistently handled, and a personal harness would have to do them itself:

**Run orchestration and process supervision.** No plugin starts, supervises, restarts, or health-checks a long-running agent loop. `riv2025` is the closest (AWS heartbeats, stale-session detection, auto-restart), but it's AWS-shaped. Nothing in the skill-level plugins addresses "agent died mid-task" recovery. Your harness provides the outer loop; plugins provide prompt+workflow content.

**Durable state beyond "git + GitHub Issues".** `ccpm` leans hard on GitHub Issues as the durable source of truth; `superpowers` writes plan `.md` files; `riv2025` uses a local `agent_state.json`. None of these are a real state store. If you want session state that survives across machines, across model-migrations, or with structured query support (not grep-over-markdown), you build it yourself.

**Cost/budget control.** The superpowers #1194 thread is the canonical example: review loops can 20x your token spend vs. a no-skill baseline, and there's no ecosystem-level guardrail for "stop when cost exceeds X" or "switch to Haiku for this subtask". Your harness has to enforce budgets.

**Cross-plugin namespace and hook coexistence.** `everything-claude-code` #1476 shows how one poorly-formed plugin blanks the entire Claude Desktop slash menu for all other plugins. `trailofbits/skills` #143 shows Stop hooks with `"matcher": "*"` that fire on unrelated sessions. No ecosystem mechanism prevents hook-scope or manifest-validation collisions between unrelated plugins — your harness has to sequence and sandbox them.

**Evaluation of skill/agent performance.** `hamelsmu/evals-skills` teaches eval methodology but doesn't evaluate other skills. No plugin runs regressions against skill behavior across model versions. When Opus 4.7 shipped and changed token usage, users discovered it through #1194 (token-burn) at personal cost. Your harness needs a before-deploy eval gate.

**Model-and-SDK-version lockstep.** Every reference project pins its SDK version implicitly. `riv2025` uses stable SDK; `claude-agent-sdk-demos/hello-world-v2` uses `unstable_v2_*`; `agent-sdk-workshop` uses March-2026 SDK. A harness that adopts three of these needs to reconcile SDK versions, which none of them help with.

**Secrets and permissions defaults.** `riv2025` uses AWS Secrets Manager; `ccpm` uses `gh` auth; `webapp-testing` needs Playwright browser binaries. No ecosystem-level pattern for "secret-store-of-record". Your harness decides.

---

## Net assessment for the adopt vs. build decision

**If you adopt the four low-friction, high-quality pieces —** `trailofbits/skills` (à la carte: `differential-review`, `ask-questions-if-underspecified`, `gh-cli`, `property-based-testing`, `semgrep-rule-creator`, `static-analysis`), `hamelsmu/evals-skills` (eval methodology skills), `anthropics/skills` (selectively: `skill-creator`, `webapp-testing`, `mcp-builder`), and `Piebald-AI/claude-code-system-prompts` (as a reference corpus) — **you get roughly 30-40% of a full harness for free**. What you get: high-quality skill content (security review, eval methodology, web testing, skill-authoring meta-skill), battle-tested prompt patterns to crib from, and a Claude-Code-version-tracked reference for baseline prompts.

**You do NOT get from any of these:**

1. **The outer agent loop.** No plugin supervises a run, decides when to stop, restarts on failure, or gates on cost. `riv2025` has this but it's AWS-shaped and frozen. Expect to write your own orchestrator against `ClaudeSDKClient` + hooks.
2. **Durable session state.** You need at minimum `agent_state.json` + a logs/transcripts pattern. Crib from `riv2025/src/` for shape; rewrite for your storage.
3. **Budget enforcement.** `TokenTracker` in `riv2025` is the closest primitive; generalize it.
4. **A spec-first workflow spine.** `ccpm`, `spec-kit`, `superpowers/writing-plans`, `compound-engineering/ce:plan` all offer different shapes. Pick one, steal the templates, own the implementation.
5. **A hook policy.** Security hooks (file-path sandboxing, bash-command allowlisting), bookkeeping hooks (track Reads, enforce cd scope). `riv2025/claude_code.py` has working examples — `universal_path_security_hook_wrapper`, `cd_enforcement_hook_wrapper`, `track_read_hook_wrapper` — copy the shape.
6. **Eval runtime.** `evals-skills` tells you how; you still build the runner.
7. **Coexistence guarantees.** If you install `superpowers` + `compound-engineering` + `trailofbits/*` simultaneously, you'll hit namespace collisions, duplicate Stop hooks, and CLAUDE.md bloat. Your harness decides which plugins load when, in what context, with what hook scoping.

**Minimum custom work on top of a "maximally-adopt" posture:**
- ~1 week: an orchestrator module (start/stop/restart, state machine, hook registration) modeled on a stripped `riv2025/claude_code.py`.
- ~3 days: a budget/cost tracker and kill-switch.
- ~3 days: a session-state store (json file + schema + migration discipline).
- ~2 days: a plugin-coexistence policy (which plugins get enabled per task class; hook-scope review).
- ~1 week: a thin eval harness that runs your own workflow against labeled trajectories before you deploy a skill change.
- Ongoing: curated skill-fork maintenance (you do NOT track upstream blind, because the ecosystem churns — `spec-kit` weekly breaking changes, `superpowers` daily commits, `everything-claude-code` manifest flip-flops).

**Therefore: adopt selectively, build the spine.** The ecosystem is strong for "skill content and prompt patterns" and weak for "agent orchestration and operations." Plan your harness as a thin integrator on top of `claude_agent_sdk` with a handful of curated forks, not as a glue layer over everyone else's marketplace.
