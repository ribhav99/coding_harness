# Open-Source Harnesses & Scaffolds — Code-Level Findings

Research date: 2026-04-16. Every repo below was inspected at the code level (files, commands, hook JSON, prompt templates) via `gh api` and `gh repo view`; READMEs were used only to confirm metadata and flow, never as the source of truth. Star counts are as reported by the GitHub API on the research date.

---

## 1. github/spec-kit — the canonical spec-driven scaffold

- **URL**: https://github.com/github/spec-kit
- **Stars**: 88,635 (API-reported)
- **Last commit**: 2026-04-16
- **Primary language**: Python (the `specify-cli` bootstrapper) + Markdown templates + Bash/PowerShell scripts
- **Short description**: Toolkit for Spec-Driven Development (SDD); installs an opinionated workflow into any AI editor.

### Directory tree (relevant)

```
spec-kit/
├── AGENTS.md                          # how to add a new agent integration
├── src/specify_cli/
│   ├── __init__.py                    # Typer CLI: `specify init` bootstrapper
│   ├── integrations/                  # ~30 agent integrations (claude/, gemini/, cursor_agent/, codex/, copilot/, opencode/, windsurf/, ...)
│   │   ├── base.py                    # MarkdownIntegration / TomlIntegration / YamlIntegration / SkillsIntegration
│   │   └── claude/                    # ClaudeIntegration → writes commands to .claude/commands/
│   ├── presets.py
│   └── workflows/
├── templates/
│   ├── commands/                      # THE nine slash commands (source of truth)
│   │   ├── specify.md  clarify.md  plan.md  tasks.md  analyze.md
│   │   ├── implement.md  checklist.md  constitution.md  taskstoissues.md
│   ├── spec-template.md   plan-template.md   tasks-template.md
│   ├── constitution-template.md   checklist-template.md
│   └── agent-file-template.md
└── scripts/
    ├── bash/                          # create-new-feature.sh, setup-plan.sh,
    │   └── ...                        # check-prerequisites.sh, update-agent-context.sh, common.sh
    └── powershell/                    # Windows mirrors
```

### Slash commands (the actual flow)

Each command is a Markdown file with YAML frontmatter declaring `description`, `handoffs`, and `scripts` (bash/ps). The commands form a **linear, artifact-driven pipeline**:

1. **`/speckit.specify`** — takes a natural-language feature description, computes a 2-4 word slug, runs `scripts/bash/create-new-feature.sh` which (optionally via a "before_specify" hook extension) creates `specs/NNN-slug/` and `spec.md` from `spec-template.md`. Handoffs list: `speckit.plan`, `speckit.clarify`.
2. **`/speckit.clarify`** — max 3 `[NEEDS CLARIFICATION]` markers, prioritized scope > security > UX > tech. Presents options as markdown tables.
3. **`/speckit.plan`** — runs `setup-plan.sh --json` which copies `plan-template.md` into the feature dir, then LLM fills `Technical Context`, runs a `Constitution Check` gate against `/memory/constitution.md`, and generates `research.md`, `data-model.md`, `contracts/`, `quickstart.md`.
4. **`/speckit.tasks`** — consumes plan/spec/data-model/contracts, produces `tasks.md` organized **by user story (P1/P2/P3)** with `[P]` parallelization markers and explicit file paths per task.
5. **`/speckit.analyze`** — READ-ONLY cross-artifact consistency check. Loads spec.md, plan.md, tasks.md; flags constitution violations as CRITICAL automatically.
6. **`/speckit.implement`** — gated: scans `checklists/` and if any item unchecked, stops and asks "proceed anyway? yes/no". Then executes tasks.md.
7. **`/speckit.checklist`** — generates validation checklists (requirements.md, ux.md, etc.).
8. **`/speckit.constitution`** — maintains `/memory/constitution.md` (project's non-negotiable principles).
9. **`/speckit.taskstoissues`** — pushes tasks to GitHub Issues.

### Integration architecture (the clever bit)

`src/specify_cli/integrations/` is the single source of truth. Each subpackage subclasses `IntegrationBase` (or `MarkdownIntegration`/`TomlIntegration`/`YamlIntegration`/`SkillsIntegration`) and declares:

```python
class ClaudeIntegration(SkillsIntegration):
    key = "claude"
    config = {"name": "Claude Code", "folder": ".claude/", "commands_subdir": "commands", ...}
    registrar_config = {"dir": ".claude/commands", "format": "markdown", "args": "$ARGUMENTS", "extension": ".md"}
    context_file = "CLAUDE.md"
```

30+ agents supported (claude, codex, cursor_agent, copilot, gemini, windsurf, opencode, kiro_cli, junie, qwen, qodercli, roo, goose, auggie, amp, …). The bootstrapper transforms the canonical Markdown commands to each agent's native format (TOML for Gemini, YAML for some, skills for Claude).

### Hooks / settings

No `settings.json` hooks — spec-kit is **orchestrated entirely in prompts**. Each command has a documented "extension hooks" section that reads `.specify/extensions.yml` for optional `before_*`/`after_*` hooks. These are LLM-executed (`EXECUTE_COMMAND: {command}`), not shell-level — so they're more like chained slash-commands than `settings.json` hook entries.

### Orchestration code

Essentially none. Spec-kit does not loop or dispatch subagents. It's a **contract + pipeline**: each command reads the output of the previous stage from disk and writes structured artifacts for the next. The "multi-agent" nature is sequential human-in-the-loop (user types `/speckit.plan` after `/speckit.specify`), not autonomous.

### Honest assessment

Serious reference. The artifact set (spec → clarify → plan → tasks → analyze → implement) with enforced templates is the cleanest spec-driven pattern in the ecosystem. The 30-agent integration registry is mature and the only agent-portable command library I found. **What it deliberately lacks**: no autonomous loops, no evaluator, no budget tracking, no parallel subagent dispatch. Good for the write/plan side; you would bolt an execution harness on top of it.

---

## 2. obra/superpowers — the real GAN-style orchestrator in the wild

- **URL**: https://github.com/obra/superpowers
- **Stars**: 156,216 (API-reported). Created 2025-10-09; forks: 13,566. Numbers are unusually high for a 6-month-old repo; I'm reporting what the API returns but flagging that it looks anomalous.
- **Last commit**: 2026-04-16
- **Primary language**: Shell (most content is Markdown skills + shell hooks)
- **License**: MIT

### Directory tree (relevant)

```
superpowers/
├── .claude-plugin/plugin.json        # name=superpowers, version=5.0.7
├── CLAUDE.md  AGENTS.md  GEMINI.md   # contributor guidelines (harsh "94% PR rejection rate")
├── agents/code-reviewer.md
├── commands/                          # brainstorm.md execute-plan.md write-plan.md
├── hooks/
│   ├── hooks.json                     # SessionStart → run-hook.cmd session-start
│   ├── hooks-cursor.json
│   ├── run-hook.cmd
│   └── session-start/
└── skills/                            # the actual meat
    ├── brainstorming/                 # prior to plan
    ├── writing-plans/                 # produces docs/superpowers/plans/YYYY-MM-DD-<feature>.md
    ├── executing-plans/               # parallel-session variant
    ├── subagent-driven-development/   # ← the GAN loop (SKILL.md + 3 prompt templates)
    ├── dispatching-parallel-agents/
    ├── finishing-a-development-branch/
    ├── receiving-code-review/  requesting-code-review/
    ├── systematic-debugging/   test-driven-development/
    ├── using-git-worktrees/    using-superpowers/
    ├── verification-before-completion/
    └── writing-skills/
```

### CLAUDE.md / AGENTS.md

Contributor guidelines written *at* LLMs: "If You Are an AI Agent: Stop. Read this section before doing anything. This repo has a 94% PR rejection rate." Explicit rules against bulk PRs, speculative fixes, third-party deps, "compliance" PRs that reformat skills to match Anthropic's docs. The document is itself a behavioral hook.

### Skills (each is a `SKILL.md` with Graphviz decision diagrams)

14 skills, all with `name:` and `description:` frontmatter. Standouts:

- **subagent-driven-development** — orchestration controller. See below.
- **dispatching-parallel-agents** — "one agent per independent problem domain" for multi-failure triage.
- **verification-before-completion** — "No completion claims without fresh verification evidence. Violating the letter of this rule is violating the spirit of this rule." Iron-law gate before any success claim.
- **writing-plans** — produces `docs/superpowers/plans/YYYY-MM-DD-<name>.md`. Each task 2-5 minutes. TDD, DRY, YAGNI enforced.
- **using-git-worktrees** — required before subagent-driven-development.

### Hooks / settings.json

```json
{ "hooks": { "SessionStart": [
  { "matcher": "startup|clear|compact",
    "hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd session-start", "async": false }] } ] } }
```

Single SessionStart hook (on startup, /clear, /compact) that loads the skill index. That's the entire machinery — everything else is prompt-level.

### Orchestration code — the GAN loop

`skills/subagent-driven-development/SKILL.md` defines a concrete multi-agent loop. **This is the closest thing to a GAN/generator-evaluator harness I found in the wild that is not from Anthropic itself.**

The contract lives in four files:

- `SKILL.md` — controller flow (read plan, TodoWrite, dispatch per-task, handle statuses)
- `implementer-prompt.md` — spawns an implementer subagent
- `spec-reviewer-prompt.md` — spawns a spec-compliance reviewer (runs FIRST)
- `code-quality-reviewer-prompt.md` — spawns a code-quality reviewer (runs AFTER spec-compliance passes)

Per-task loop:

```
Controller extracts task + context from plan (doesn't make subagent re-read file)
→ dispatch implementer (Task tool, general-purpose)
    · implementer may ask questions before starting
    · implements, tests (TDD), commits, self-reviews
    · returns status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
→ dispatch spec-compliance reviewer  (explicit "DO NOT trust the report — verify by reading code")
    · if ❌: implementer fixes → re-review (loop until ✅)
→ dispatch code-quality reviewer (wraps the code-reviewer subagent template)
    · Strengths / Issues (Critical/Important/Minor) / Assessment
    · if issues: implementer fixes → re-review (loop until ✅)
→ TodoWrite mark complete
→ next task
After all tasks → dispatch final end-to-end code-reviewer → finishing-a-development-branch
```

Explicit **model tiering** is documented: cheap model for mechanical tasks (1-2 files, clear spec), standard for multi-file integration, most-capable for architecture/design/review. Explicit "never dispatch parallel implementers on the same task (conflicts)".

The spec-reviewer prompt is deliberately adversarial:

> "The implementer finished suspiciously quickly. Their report may be incomplete, inaccurate, or optimistic. You MUST verify everything independently. DO NOT: Take their word for what they implemented. DO: Read the actual code they wrote."

### Honest assessment

Serious. Possibly the single most directly usable reference if you want a GAN-style coding harness that actually ships on top of Claude Code today. The two-stage review (spec compliance *then* quality) is cleaner than "one big review" — the reviewer is not asked to judge "is this good?" until it has verified "is this what was asked for?". The downside: it runs inside a single Claude Code session using the Task tool, so there's no budget/token accounting layer, no remote worker model, no structured JSON contract between agents — the contract is an English prompt template. Great for inspiration; you'd re-implement the plumbing.

---

## 3. automazeio/ccpm — PRD → Epic → GitHub Issues → parallel agents

- **URL**: https://github.com/automazeio/ccpm
- **Stars**: 7,985
- **Last commit**: 2026-03-18
- **Primary language**: Shell

### Directory tree

```
ccpm/
└── skill/ccpm/
    ├── SKILL.md                        # entrypoint (claude skill spec)
    └── references/
        ├── conventions.md  plan.md  structure.md  sync.md  execute.md  track.md
        └── scripts/                    # status.sh standup.sh epic-list.sh
                                        #  epic-show.sh epic-status.sh prd-list.sh
                                        #  search.sh in-progress.sh next.sh blocked.sh validate.sh
```

### SKILL.md — the 5-phase pipeline

Plan → Structure → Sync → Execute → Track. Each phase has its own reference file the LLM is told to read on demand (progressive disclosure). The SKILL.md enforces a **"Script-First Rule"** — for any deterministic read-and-report operation, run the bash script rather than reasoning:

| User wants | Script |
|---|---|
| Project status | `bash references/scripts/status.sh` |
| Standup | `bash references/scripts/standup.sh` |
| What's next | `bash references/scripts/next.sh` |
| What's blocked | `bash references/scripts/blocked.sh` |

### Orchestration code — the execute phase

The Execute phase does real parallel dispatch:

1. User says "work on issue 42"
2. Agent runs `gh issue view 42 --json title,body,labels`
3. Agent reads the local `.claude/epics/<epic>/42.md` and identifies independent **work streams** (Database Layer / Service Layer / API Layer / UI Layer / Tests) by analyzing which files each would touch
4. Writes `42-analysis.md` with a frontmatter `parallelization_factor` and a per-stream block (scope, files, can_start, dependencies)
5. Spawns one agent per stream, each in its own git worktree

### Honest assessment

Solid. Unique contribution vs spec-kit: **GitHub Issues as the work ledger** (sync is first-class), and explicit conflict-risk analysis from the file-overlap graph before dispatching parallel agents. Skill-first-script rule is pragmatic — it doesn't waste tokens on operations that are pure retrieval. Less sophisticated than superpowers in the implement phase (no spec/quality separation), but better at multi-feature project scope.

---

## 4. EveryInc/compound-engineering-plugin — reviewer personas at scale

- **URL**: https://github.com/EveryInc/compound-engineering-plugin
- **Stars**: 14,522
- **Last commit**: 2026-04-17
- **Primary language**: TypeScript (tooling/tests) + Markdown (42 skills + 28 agents)

### Directory tree

```
compound-engineering-plugin/
├── .claude-plugin/
├── .cursor-plugin/                     # cross-harness
├── AGENTS.md  CLAUDE.md → @AGENTS.md
├── plugins/compound-engineering/
│   ├── agents/
│   │   ├── review/                      # 28 reviewer personas (!)
│   │   ├── document-review/  research/  design/  docs/  workflow/
│   └── skills/                          # 42 skills, `ce:` prefixed
│       ├── ce-plan/ ce-work/ ce-review/ ce-brainstorm/ ce-compound/
│       ├── ce-debug/ ce-polish-beta/ ce-ideate/ ce-optimize/ ...
│       ├── frontend-design/ dhh-rails-style/ dspy-ruby/
│       └── git-worktree/ test-browser/ test-xcode/ ...
└── scripts/  src/  tests/               # TypeScript CI tooling
```

### The `ce:review` command — four modes, persona dispatch

`skills/ce-review/SKILL.md` parses `$ARGUMENTS` for `mode:autofix | mode:report-only | mode:headless`, a `base:<sha-or-ref>` override, and a `plan:<path>` for requirements verification. Severity scale P0-P3. **The interesting bit:** it spawns parallel sub-agents chosen from the 28 reviewer personas based on diff characteristics, each returns structured JSON, the command merges+dedupes and emits a single report. `mode:headless` is explicitly for skill-to-skill invocation and emits a structured envelope with fields `severity, autofix_class, owner, requires_verification, confidence, pre_existing, suggested_fix`.

### The reviewer personas (agents/review/)

28 distinct reviewers including `adversarial-reviewer`, `correctness-reviewer`, `security-sentinel`, `performance-oracle`, `architecture-strategist`, `data-migration-expert`, `schema-drift-detector`, `deployment-verification-agent`, plus name-branded ones (`dhh-rails-reviewer`, `julik-frontend-races-reviewer`, `kieran-python-reviewer`).

The `adversarial-reviewer` is worth stealing verbatim:

> "You are a chaos engineer who reads code by trying to break it. Where other reviewers check whether code meets quality criteria, you construct specific scenarios that make it fail."

With a **depth calibration** up front (Quick / Standard / Deep based on diff size and risk keywords) and four attack techniques: Assumption violation, Composition failures, Cascade construction, Abuse cases.

### Orchestration code

`ce:review` is the orchestrator. Its 4 modes are important: Interactive (default), Autofix (apply only `safe_auto` findings, bounded re-review rounds), Report-only (read-only, safe to run concurrently with browser testing), Headless (skill-to-skill, single pass, structured envelope output, emits "Review complete" terminal signal). The autofix/headless distinction is good design — explicit "never commit, push, or create a PR" for both.

### Honest assessment

Serious, well-engineered, and unusually mature for a plugin. The 28 personas + merge/dedup pipeline is the most sophisticated evaluator-side setup I saw. The four execution modes (especially headless with a terminal signal) are what you'd want if you were wrapping it in a larger harness. Costs: it's heavyweight, and many personas overlap. The `AGENTS.md` discipline ("no manual version bumps in feature PRs", "PRs cross-tested for js-yaml strict-mode parsing") signals real engineering hygiene.

---

## 5. anthropics/riv2025-long-horizon-coding-agent-demo — THE official Anthropic companion

- **URL**: https://github.com/anthropics/riv2025-long-horizon-coding-agent-demo
- **Stars**: 59 (low — not widely publicized, but this IS the real reference)
- **Last commit**: 2026-02-05
- **Primary language**: Python
- **Important**: This is the repo that accompanies Anthropic's long-horizon coding agent work shown at AWS re:Invent 2025. The Claude Agent SDK is used directly; Playwright is used as the evaluator. **If you are looking for Anthropic's GAN-style harness in code, this is it.**

### Directory tree (relevant)

```
riv2025-long-horizon-coding-agent-demo/
├── claude_code.py                      # 1,866-line main orchestration loop
├── bedrock_entrypoint.py               # AWS Bedrock AgentCore runtime entrypoint
├── prompts/
│   ├── system_prompt.txt               # the "anti-AI-slop" design prompt
│   ├── canopy/                          # one project = one subdirectory
│   │   ├── BUILD_PLAN.md               # project spec (JIRA-like app)
│   │   ├── DEBUGGING_GUIDE.md
│   │   ├── EXAMPLE_TEST.txt            # seed e2e test spec
│   │   └── system_prompt.txt
│   └── FRONTEND_AESTHETICS_GUIDE.md
├── src/
│   ├── session_manager.py              # prompts_dir, required/optional project files
│   ├── token_tracker.py                # cost/limit accounting, CloudWatch export
│   ├── security.py                     # bash/path/cd hooks via SDK HookMatcher
│   ├── git_manager.py                  # commits on agent-runtime branch
│   ├── github_integration.py           # post screenshots/updates to the issue
│   ├── prompt_templates.py   logging_utils.py   config.py
├── e2e-tests/smoke.spec.ts             # Playwright
├── frontend-scaffold-template/
├── infrastructure/                      # AWS CDK (bin/, lib/)
├── playwright.config.staging.ts
├── state_management.txt                # spec for agent_state.json
├── prompt_template.txt
├── Dockerfile  Makefile  requirements.txt
```

### How the loop actually works (from `claude_code.py`)

The main entrypoint is `run_autonomous_implementation()` → `_handle_implementation_loop()`. State lives in `agent_state.json` (spec in `state_management.txt`) with **two fields**: `desired_state` (what Mission Control wants) and `current_state` (what the agent is actually doing). Valid states: `continuous | run_once | run_cleanup | pause | terminated`.

The outer loop polls `agent_state.json` every 10s and dispatches:

- **`continuous`** → run a single session (`_run_single_session`), auto-continue with 2s delay. On `completion_claimed`, require `COMPLETION_CONFIRMATIONS_REQUIRED=1` confirmations before transitioning to pause. On `prompt_too_long`, start a fresh session next loop (context reset, not compaction). Every `cleanup_frequency` sessions, run a cleanup session.
- **`run_once`** → one session, then pause.
- **`run_cleanup`** → run the cleanup prompt once, then pause.

A single session uses `ClaudeSDKClient` with a fixed toolset (`think, Read, Glob, Grep, Write, Edit, MultiEdit, Bash`) and four `HookMatcher`-registered security hooks wrapped per-session so they capture the project root:

- `bash_security_hook` — gates Bash
- `cd_enforcement_hook` — prevents `cd` out of sandbox
- `universal_path_security_hook` — gates any path in tool inputs
- `track_read_hook` — accounting

Completion is detected by text pattern match in assistant TextBlocks: `🎉` AND "implementation complete" AND "all tasks finished" AND NOT ("unfinished" OR "issues"). `json_buffer_size` and `image dimensions exceed max allowed size` errors force session termination → raise `RuntimeError("Session terminated due to …")` and the outer loop starts fresh.

A custom `@tool think` is defined locally — just logs a thought for traces.

Token accounting exports to `/tmp/token_stats.json` for CloudWatch.

### The planner/generator/evaluator split

The full harness lives across three repos / processes and reads as:

- **Planner**: the `prompts/<project>/BUILD_PLAN.md` — hand-authored rich spec for the task (Canopy = a full JIRA clone; technology_stack, overview, requirements spelled out as `<project_specification>` XML). This file is static per project — not LLM-regenerated per run.
- **Generator**: `claude_code.py` + system_prompt.txt — the autonomous SDK agent loop described above. Progress is persisted in `claude-progress.txt` (never deleted, can be condensed). Test completions in `tests.json` — explicitly "must NEVER be modified" by cleanup runs.
- **Evaluator**: Playwright (`e2e-tests/smoke.spec.ts`, `playwright.config.staging.ts`) + an external issue poller. The agent pushes screenshots to the GitHub issue (`github_integration.py`); after each session a preview deploy builds on CloudFront; every 5 min the issue poller detects 🚀 reactions on new issues to queue work. Votes (👍) prioritize.

**Context resets over compaction** is explicitly built in: on `prompt_too_long`, the session is terminated and a fresh client is created — state is carried by `claude-progress.txt`, git commits on the `agent-runtime` branch, and the structured `agent_state.json`, not the in-context history.

### The system prompt (anti-AI-slop design)

Worth stealing directly:

> "AI models tend to converge on safe, generic design choices that mirror common training patterns. Yet models like you possess vast design knowledge that exists off the standard distribution. The result is that most UI generations follow a recognizable 'AI-generated' aesthetic—centered layouts, purple gradients, uniform rounded corners, Inter font—what users call the 'AI slop aesthetic.' The goal is +3σ design that far exceeds median quality."

Then provides named inspiration sets (color schemes, design movements, brand languages, cultural aesthetics, editorial, fonts) and requires the agent to state its fusion upfront: *"I'm combining [source 1] colors with [source 2] typography, using [source 3] layout principles and [source 4] details."*

### Honest assessment

The serious reference. It is the engineering-blog harness, open-sourced. The pieces worth cribbing: (1) two-field state file with desired/current separation, (2) fresh-context on error rather than compaction, (3) persistent progress artifact instead of transcript, (4) Playwright as external evaluator, (5) test-completion ledger that is write-once for the generator, (6) token export for an external monitoring dashboard, (7) hooks via `HookMatcher` rather than a shell layer. Downsides: AWS-specific (Bedrock AgentCore, CloudFront previews) — you'd strip those; the completion detection is fragile string matching; no explicit GAN-style bounce between a generator and evaluator instance — the evaluator is out-of-process and feedback comes via commits + screenshots posted to the issue.

---

## 6. anthropics/claude-agent-sdk-demos — canonical subagent-orchestration examples

- **URL**: https://github.com/anthropics/claude-agent-sdk-demos
- **Stars**: 2,195
- **Last commit**: 2026-04-16
- **Primary language**: Python

### Directory tree (relevant)

```
claude-agent-sdk-demos/
├── research-agent/                      # the multi-subagent example
│   └── research_agent/
│       ├── agent.py                     # lead_agent spawns researcher, data-analyst, report-writer
│       ├── prompts/                     # lead_agent.txt researcher.txt data_analyst.txt report_writer.txt
│       └── utils/                       # subagent_tracker.py, transcript.py, message_handler.py
├── email-agent/   excel-demo/   resume-generator/   simple-chatapp/
└── hello-world/   hello-world-v2/
```

### Orchestration (research-agent/agent.py)

Uses the SDK's `AgentDefinition` primitive:

```python
agents = {
    "researcher":    AgentDefinition(description="...", tools=["WebSearch", "Write"], prompt=researcher_prompt, model="haiku"),
    "data-analyst":  AgentDefinition(description="...", tools=["Glob", "Read", "Bash", "Write"], prompt=data_analyst_prompt, model="haiku"),
    "report-writer": AgentDefinition(description="...", tools=["Skill", "Write", "Glob", "Read", "Bash"], prompt=report_writer_prompt, model="haiku"),
}
# Lead agent uses Sonnet implicitly and delegates via the Task tool
hooks = {'PreToolUse': [HookMatcher(matcher=None, hooks=[tracker.pre_tool_use_hook])]}
```

Subagents are haiku for cost; the lead orchestrator runs the default (Sonnet). A `SubagentTracker` hooks `PreToolUse` across the board to emit a transcript and per-subagent session directory. The tool list per subagent is the capability boundary.

### Honest assessment

Canonical. This is the minimal correct example of `AgentDefinition`-based delegation with hooks. Not a coding harness per se, but the pattern (lead + specialized subagents + haiku/sonnet mix + PreToolUse tracker) is exactly what to lift.

---

## 7. anthropics/agent-sdk-workshop — the SDK teaching scaffold

- **URL**: https://github.com/anthropics/agent-sdk-workshop
- **Stars**: 27
- **Last commit**: 2026-04-12
- **Primary language**: Python

Small, but pedagogically valuable. `01-guided-demo/` is a single agent with three boolean toggles in `config.py`: `ENABLE_TOOLS`, `ENABLE_SUBAGENTS`, `ENABLE_MEMORY`. The same cohesive task (company briefing) is run at each stage so you *feel* the progression. `02-breakouts/` ships pre-built tool and subagent libraries (account-intelligence, chief-of-staff, customer-support, sre-agent) that attendees assemble.

The `DESIGN.md` is explicit about the teaching strategy — local mock data only (no external API keys to derail a workshop), progressive/not-disconnected demo, "under 2 minutes to first output". Worth reading if you're designing a starter-kit version of your harness.

---

## 8. anthropics/skills — the canonical Skills spec and reference skills

- **URL**: https://github.com/anthropics/skills
- **Stars**: 118,992 (API-reported)
- **Last commit**: 2026-04-17

Ships 17 reference skills (algorithmic-art, brand-guidelines, canvas-design, claude-api, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, **webapp-testing**, xlsx). The `webapp-testing` skill is the one a harness evaluator loop would use. It is tiny and discipline-focused:

```
SKILL.md decision tree: static HTML → read file directly; dynamic → run_server helper
scripts/with_server.py     # starts one or many servers, then runs the Playwright driver
"Always run scripts with --help first. DO NOT read the source until you try running and find customization necessary."
```

The philosophy — keep the skill tiny, keep the heavy lifting in a script that's treated as a black box to preserve context — is explicit and worth copying.

The spec itself now lives at <https://agentskills.io/specification>.

---

## 9. hesreallyhim/awesome-claude-code — the index

- **URL**: https://github.com/hesreallyhim/awesome-claude-code
- **Stars**: 39,172
- **Last commit**: 2026-04-17
- **Primary language**: Python

Contents: `THE_RESOURCES_TABLE.csv` is the actual source of truth; the README is generated. 200+ resources cataloged with `Active, Stale, LastChecked` fields. Useful for discovery; its own code is just csv → markdown generators. Top entries I followed directly: `obra/superpowers`, `automazeio/ccpm`, `EveryInc/compound-engineering-plugin`, `affaan-m/everything-claude-code`, `trailofbits/skills`, `Piebald-AI/claude-code-system-prompts`, `NeoLabHQ/context-engineering-kit`, `OneRedOak/claude-code-workflows`.

---

## 10. trailofbits/skills — the security-minded reviewer set

- **URL**: https://github.com/trailofbits/skills
- **Stars**: 4,633
- **Last commit**: 2026-04-16
- **Primary language**: Python

### Directory tree

```
trailofbits/skills/
├── .claude-plugin/  .codex/
├── CLAUDE.md  CODEOWNERS
├── ruff.toml  .pre-commit-config.yaml
└── plugins/
    ├── spec-to-code-compliance/        # the interesting one for us
    │   └── skills/spec-to-code-compliance/
    ├── differential-review/             # another
    │   ├── commands/  skills/
    ├── static-analysis/  semgrep-rule-creator/  semgrep-rule-variant-creator/
    ├── variant-analysis/  ask-questions-if-underspecified/
    ├── property-based-testing/  mutation-testing/  constant-time-analysis/
    ├── entry-point-analyzer/  agentic-actions-auditor/  audit-context-building/
    └── 30+ more
```

`spec-to-code-compliance` is the ToB-branded equivalent of superpowers' spec-reviewer — given a spec and a diff, mechanically check line-by-line compliance. `differential-review` compares two review passes. `agentic-actions-auditor` audits the harness configuration itself. The plugin has pre-commit hooks and ruff — a much more "this is a library" posture than most community skills.

### Honest assessment

Serious. Not a harness itself, but a catalog of high-quality specialized skills that would fit *inside* a harness's review phase. The `spec-to-code-compliance` skill is the direct analog of the subagent-driven-development `spec-reviewer-prompt.md`.

---

## 11. affaan-m/everything-claude-code — the "kitchen sink" template

- **URL**: https://github.com/affaan-m/everything-claude-code
- **Stars**: 158,681 (API-reported — similar to superpowers, anomalously high for the content)
- **Last commit**: 2026-04-16
- **Primary language**: JavaScript

Top level includes 20+ `.<agent>` directories (`.claude`, `.codex`, `.cursor`, `.gemini`, `.kiro`, `.opencode`, `.trae`, `.codebuddy`, `.codex-plugin`, `.claude-plugin`, `.cursor-plugin`, …) to be multi-harness. Under `.claude/` there are only four subdirectories: `commands/` (three files: `add-language-rules.md`, `database-migration.md`, `feature-development.md`), `enterprise/controls.md`, `homunculus/instincts/`, `team/`, and top-level `ecc-tools.json`, `identity.json`, `package-manager.json`, plus `research/`, `rules/`, `skills/`.

Sample command (`feature-development.md`):

```markdown
---
name: feature-development
description: Workflow command scaffold for feature-development in everything-claude-code.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---
## Suggested Sequence
1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.
```

### Honest assessment

Mixed. The README and catalog suggest a vast system; the actual `.claude/commands/` has three thin scaffolds. Scaffolds are fine, but the breadth-vs-depth ratio is suspicious. If the star count is genuine (API-reported, could include bot activity; I can't verify), it reflects hype more than substance. Skip as a reference; check `skills/everything-claude-code/` only if you want a multi-harness directory naming convention.

---

## 12. Piebald-AI/claude-code-system-prompts — the prompt archaeology

- **URL**: https://github.com/Piebald-AI/claude-code-system-prompts
- **Stars**: 9,024
- **Last commit**: 2026-04-16

Extracted Claude Code system prompts and built-in tool descriptions, updated per CC version. `system-prompts/` includes `agent-prompt-explore.md`, `agent-prompt-general-purpose.md`, `agent-prompt-plan-mode-enhanced.md`, `agent-prompt-claudemd-creation.md`, `agent-prompt-conversation-summarization.md`, `agent-prompt-dream-memory-consolidation.md`, `agent-prompt-onboarding-guide-generator.md`, `agent-prompt-coding-session-title-generator.md`, `agent-prompt-managed-agents-onboarding-flow.md`, etc. Not a harness; a prompt-reference archive. Useful for borrowing battle-tested phrasing.

---

## 13. johannesjo/parallel-code — desktop app for parallel worktrees

- **URL**: https://github.com/johannesjo/parallel-code
- **Stars**: 527
- **Last commit**: 2026-04-16
- **Primary language**: TypeScript (Electron + SolidJS)

Electron app that wraps Claude Code + Codex CLI + Gemini CLI with one git branch/worktree per agent. Relevant code is under `src/arena/`: `BattleScreen.tsx`, `CommitDialog.tsx`, `ConfigScreen.tsx`, `CountdownScreen.tsx`, `ResultsScreen.tsx`, `merge.ts`, `persistence.ts`, `store.ts`. Runs a "battle" UI where multiple agents attack the same task and the user picks the winning diff to merge. Not a harness library; a UI layer.

`SpillwaveSolutions/parallel-worktrees` (8 stars, last commit 2025-12-29) is a lighter shell variant of the same pattern: a single `SKILL.md` + shell scripts to create N worktrees, dispatch one agent per, and collect results. Both are toy compared to ccpm's analysis-driven parallelism.

---

## 14. Competing ecosystems — what differs

### Aider-AI/aider (43,450 stars, Python)

Not template-based. Ships **nine coder personas** as Python classes under `aider/coders/`: `architect_coder.py`, `ask_coder.py`, `editblock_coder.py`, `editblock_fenced_coder.py`, `editblock_func_coder.py`, `editor_editblock_coder.py`, `editor_diff_fenced_coder.py`, etc. Each pairs with a `*_prompts.py` class.

The **architect pattern** is aider's GAN-lite:

```python
class ArchitectCoder(AskCoder):
    edit_format = "architect"
    def reply_completed(self):
        # Architect produced prose instructions; now spawn an editor_coder to actually apply them.
        editor_model = self.main_model.editor_model or self.main_model
        editor_coder = Coder.create(main_model=editor_model, edit_format=self.main_model.editor_edit_format, ...)
        editor_coder.run(with_message=self.partial_response_content, preproc=False)
```

`ArchitectPrompts.main_system`: *"Act as an expert architect engineer and provide direction to your editor engineer. The editor engineer will rely solely on your instructions, so make them unambiguous and complete."*

This is much smaller-scale than Anthropic's three-agent harness — two roles, one exchange, no evaluator — but it ships millions of edits so the minimal split (architect proposes, editor applies) is validated. Note: edits are applied deterministically via parsed edit-block formats, not free-form file writes.

### openai/codex (75,742 stars, Rust)

A terminal coding agent. `AGENTS.md` at the root is purely for agents working in the codex repo itself — it's full of Rust lint rules (collapse `if`, use method references, avoid modules over 500 LoC) and Bazel invariants. `.codex/skills/` holds five specialized skills: `babysit-pr`, `codex-bug`, `codex-pr-body`, `remote-tests`, `test-tui`. No spec-kit style pipeline; the architecture is a single tight loop in `codex-rs/` (crates for `chatgpt`, `backend-client`, `app-server`, `apply-patch`, `tui`). The interesting contrast: Codex treats code-editing as a first-class `apply-patch` crate (deterministic diff application) rather than relying on the LLM to write diffs reliably. Similar in spirit to Aider's edit-block coders.

### Cursor ecosystem (PatrickJS/awesome-cursorrules, 39,106 stars)

Just a `.cursorrules` file collection — no harness, no scaffold, no commands. Cursor's orchestration is all IDE-internal. The ecosystem analog of spec-kit doesn't really exist for Cursor; closest is Cursor's own `.cursor/rules` directory, consumed by the IDE directly.

---

## Synthesis — what to crib, what to skip

**Crib (high-confidence patterns appearing in multiple serious references):**

1. **Separate the artifacts from the execution.** Spec-kit and ccpm both persist `spec.md → plan.md → tasks.md → analysis.md` on disk; the agent reads them in a new context. This is what makes context resets safe. Your harness should have an equivalent tri-artifact contract.
2. **Two-stage review: spec-compliance FIRST, then code quality.** From `obra/superpowers/skills/subagent-driven-development/`. Asking "does it match the spec?" before "is it well-built?" is dramatically more effective than a single combined review — you don't waste quality nits if the thing solves the wrong problem.
3. **Fresh context per task, not per session.** Superpowers and the Anthropic riv2025 harness both deliberately re-create the agent with a constructed context rather than carrying conversation. Riv2025 treats `prompt_too_long` as "start fresh" not "compact". `claude-progress.txt` (never deleted) is the memory.
4. **An out-of-process evaluator with real tool use.** Riv2025 evaluates via Playwright + screenshots + CloudFront preview, not another Claude call. This is the GAN-style pattern done properly — the evaluator is a different universe (real browser) from the generator.
5. **Two-field state file.** `agent_state.json` with `desired_state` (what the human wants) vs `current_state` (what the agent is doing). Cleanly separates control-plane from data-plane.
6. **Model tiering at the task level.** Superpowers documents it explicitly (cheap for mechanical, standard for integration, most-capable for architecture/review). The SDK research-agent pins haiku for subagents. Don't run every subagent at the same tier.
7. **Script-first rule for deterministic ops.** ccpm's principle: never have an LLM compute something a 20-line bash script can compute. Your harness should ship small, well-tested scripts (`status.sh`, `next.sh`, etc.) the LLM is instructed to call.
8. **Adversarial reviewer persona.** From `EveryInc/compound-engineering-plugin/agents/review/adversarial-reviewer.md` — "read code by trying to break it" with depth calibration by diff size/risk. Steal the text.
9. **Verification-before-completion as a non-negotiable gate.** Superpowers' iron law. Before *any* success claim, run the verification command in-message. This alone would eliminate a category of hallucinated wins.

**Skip:**

1. Broad star-chasing. `affaan-m/everything-claude-code` and similar high-star repos with thin `.claude/commands/` are hype-to-substance skewed.
2. Monolithic "one review agent" patterns. Compound-engineering has 28 personas; most users need 3-4. But skip the idea of a single generic reviewer — it gets lost.
3. Cursor-style rules-only setups. No orchestration layer, and you need one.
4. Aider's coder-class hierarchy. Educational, but edit-block format parsing is Aider's innovation — if you're on the Claude SDK, tool-based editing is already solved.
5. GitHub Issues as the exclusive work ledger (ccpm). Fine for teams, overkill for a solo harness; keep issues optional.
6. AWS Bedrock infrastructure (riv2025). Steal the Python core; skip the CDK/AgentCore stack unless you need multi-tenant remote execution.

The strongest single reference you have is **`anthropics/riv2025-long-horizon-coding-agent-demo`** for the autonomous loop and **`obra/superpowers/skills/subagent-driven-development/`** for the generator-reviewer contract. Together they cover 80% of a serious GAN-style coding harness design. Spec-kit's templates slot in as the planning layer. Everything else is refinement.
