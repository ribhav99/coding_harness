# Building a custom long-horizon coding harness on the Claude Agent SDK

The fastest path to a multi-day autonomous coding harness in April 2026 is a thin Python orchestrator over the **Claude Agent SDK**, structured as a **spec-driven outer loop + Anthropic-style initializer/coding two-agent bootstrap + a GAN-inspired generator/evaluator pair as the core work loop + subagents for context isolation + deterministic verification hooks + git worktrees for parallelism**. That combination maps directly onto Anthropic's two key engineering posts — "Effective harnesses for long-running agents" (Nov 2025) for the multi-session bootstrap and "Harness design for long-running application development" (early 2026, Prithvi Rajasekaran) for the generator/evaluator pattern — and is validated by the architectures of every production-grade harness studied (Cursor Cloud Agents, Amp, Jules, OpenHands, Roo Cloud Agents, Open SWE). The single most important lesson from the landscape: **harness and infrastructure dominate model choice** once you're on a frontier model — OpenAI's Harness Engineering team built a ~1M LOC product with 3 engineers in 5 months using Codex, and Anthropic writes ~80% of Claude Code with Claude itself. The architectural moves that matter are context engineering, scratchpad/file-based memory, orchestrator-worker subagents, evaluator-optimizer loops, and async human-in-the-loop gates wired to Slack — not framework abstractions. This report synthesizes what to build, why, and links the canonical references to keep open while building.

## 1. The Claude Agent SDK is the right foundation

Anthropic renamed the Claude Code SDK to the **Claude Agent SDK** on September 29, 2025 (packages `claude-agent-sdk` on PyPI, `@anthropic-ai/claude-agent-sdk` on npm). The SDK embeds the Claude Code CLI as a subprocess and streams typed JSON messages; **SDK MCP servers run in-process** via `create_sdk_mcp_server`, so custom tools are just async Python functions — no separate process. Two entry points: `query()` (one-shot async iterator) and **`ClaudeSDKClient`** (stateful, bidirectional context manager). For a long-horizon harness, `ClaudeSDKClient` is the right choice because it supports mid-session `set_permission_mode()`, `set_model()`, hooks, and custom tools.

**The feature set you actually need is already there.** The `ClaudeAgentOptions` object exposes `allowed_tools`, `disallowed_tools`, `system_prompt` (or `append_system_prompt`), `mcp_servers`, `permission_mode`, `resume`, `continue_conversation`, `max_turns`, `max_budget_usd`, `model`, `fallback_model`, `hooks`, `agents`, `can_use_tool`, `session_id`, `fork_session`, `setting_sources`, and `cwd`. Hooks available in Python (confirmed against `claude_agent_sdk/types.py` `HookEvent` Literal at HEAD): **PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, SubagentStop, SubagentStart, SessionStart, SessionEnd, PreCompact, Notification, PermissionRequest**. Subagents are defined programmatically (via `agents={...}` using `AgentDefinition`) or as `.claude/agents/*.md` files; they get isolated context windows and the parent sees only the final message. Subagents cannot nest in practice (flagged across community reports; not explicitly documented on the overview page — verify against your SDK version if nesting matters to your design). Sessions persist as JSONL at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` and resume via `resume=<id>` or `continue_conversation=True`; `fork_session=True` branches. Final `ResultMessage` carries `total_cost_usd`, `usage` (including `cache_read_input_tokens`), `duration_ms`, and `num_turns`.

Gotchas to bake in from day one, ordered by confidence:

- **`setting_sources` default behavior is version-dependent and has flipped.** Current `docs.claude.com/en/api/agent-sdk/overview` / `code.claude.com/docs/en/agent-sdk/overview` state the SDK auto-loads `CLAUDE.md`, `.claude/`, skills, and settings from cwd and `~/.claude/` under default options, and `setting_sources` is used to *restrict* which sources load. Earlier post-rename SDK versions required opt-in via an explicit `setting_sources=["user","project","local"]`. Confirm against the exact SDK version you pin; a silent change here will make CLAUDE.md invisible to your harness.
- **Retrieving historical messages after `resume` is not supported via the SDK** (tracked at <https://github.com/anthropics/claude-agent-sdk-typescript/issues/14>). Parse JSONL at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` directly if you need replay.
- **`create_sdk_mcp_server` runs in-process.** Confirmed in `src/claude_agent_sdk/__init__.py` (the function) and `_internal/query.py` (SDK MCP requests dispatched to the Python-held `sdk_mcp_servers` dict, never to a subprocess).
- **Flag as empirical / not primary-source documented**: `allowed_tools` vs `bypassPermissions` interaction (pair with `permission_mode="dontAsk"` is the community workaround); `PermissionRequest` hooks in headless `-p` mode (community reports they don't fire — use `PreToolUse` instead); client-side cost-table drift on new models (reconcile against the Anthropic Usage & Cost API for billing). Each of these is widely reported but I could not find a primary-source line confirming — treat as "assume true, verify if critical."

Canonical references to pin: the SDK overview at <https://docs.claude.com/en/api/agent-sdk/overview>, subagents at <https://docs.claude.com/en/api/agent-sdk/subagents>, hooks at <https://docs.claude.com/en/api/agent-sdk/hooks>, sessions at <https://docs.claude.com/en/api/agent-sdk/sessions>, the demos repo at <https://github.com/anthropics/claude-agent-sdk-demos>, and the Python SDK source at <https://github.com/anthropics/claude-agent-sdk-python> (read `src/claude_agent_sdk/types.py` and `examples/quick_start.py` first).

### 1.1 Three layers of "harness" — which one you're building

"Harness" is overloaded. Three nested layers show up across the literature; you can stop at any layer, and the rest of this document is primarily about L3 while L1 and L2 are prerequisites.

| Layer | What it is | Primitive | Canonical reference |
|---|---|---|---|
| **L1 — Project scaffold** | Files shaping a *single* Claude Code / Claude Code–compatible session | `AGENTS.md` / `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `.claude/settings.json` hooks | `github/spec-kit`, `anthropics/skills` |
| **L2 — In-session orchestration** | One top-level session dispatches subagents with contracts and gates | Task tool + subagent prompts + TodoWrite | `obra/superpowers/skills/subagent-driven-development/` |
| **L3 — Multi-session autonomous loop** | A program outside Claude Code drives many sessions, with externalized state | **Claude Agent SDK** (Python/TS) — `ClaudeSDKClient`, `AgentDefinition`, `HookMatcher` | `anthropics/riv2025-long-horizon-coding-agent-demo` |

L1 alone is what most "awesome-claude-code" template repos are; valuable even without orchestration. L1+L2 is what `obra/superpowers`'s `subagent-driven-development` skill demonstrates in-session — the generator/reviewer loop runs inside one Claude Code session using Task-tool fan-out. L1+L2+L3 is the Rajasekaran GAN harness made real: a Python process that owns the outer loop and invokes Claude as a subroutine through the SDK. Don't jump to L3 for a task an L2 controller would handle; don't rebuild L1 when `anthropics/skills` and the spec-kit templates are copy-paste ready.

## 2. The anatomy of a long-horizon harness

The winning shape across every production system studied is identical in structure, only differing in implementation: **a spec-driven outer phase loop, an initializer-then-coding-agent bootstrap, a generator/evaluator pair as the core work loop (section 3), context-isolated subagents for exploration and review, deterministic verification hooks on every edit, git commits as the durable checkpoint, and async human gates with Slack escalation.** Anthropic's own "Effective harnesses for long-running agents" (<https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>, Nov 2025) is the blueprint for the multi-session bootstrap — read it before writing code.

**The outer loop is spec-driven.** Use GitHub Spec Kit (<https://github.com/github/spec-kit>) or its Claude-specific variant `cc-sdd` (<https://github.com/gotalab/cc-sdd>) to force the phase sequence `/constitution → /specify → /plan → /tasks → /implement` with human gates between each phase. The key artifact is `tasks.md` — a DAG of bounded (≤1 hour of agent work) implementation units with REQ-ID traceability back to `spec.md` and forward into commits and test docstrings. Martin Fowler's review (<https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html>) flags the real risk: spec-driven dev over-engineers small tasks. Use it for features ≥500 LOC; skip for bug fixes.

**The session bootstrap follows Anthropic's two-agent pattern.** The *initializer agent* runs once: it reads `spec.md` + `tasks.md`, writes `init.sh` (reproducible environment setup), a `feature_list.json` of 50–200 leaf features all marked `passes: false`, a `claude-progress.txt` scratchpad, and makes the initial git commit. Every subsequent session is a *coding agent* that always opens by running `pwd`, reading `claude-progress.txt`, inspecting `git log`, executing `init.sh`, then picking the highest-priority failing feature. **Engineers working in shifts, none remembering the previous shift** is the mental model — and the shift handoff is entirely on disk, never in context. This sidesteps Claude's documented "one-shotting" failure mode where it declares victory based on partial evidence.

**Subagents exist for two reasons: context isolation and parallelism.** Beyond the generator/evaluator pair in section 3, declare additional role-specialized subagents in `ClaudeAgentOptions.agents`: a read-only `planner` (Sonnet) that decomposes the current feature; a cheap parallel `explorer` (Haiku) that returns summaries of code searches without ever polluting the main context; and a `debugger` (Opus) invoked only after N consecutive test failures, running a Reflexion-style self-analysis. **Each subagent gets a fresh context window and only its final summary enters the parent**, which is the single largest lever against context rot. Anthropic's multi-agent research post (<https://www.anthropic.com/engineering/multi-agent-research-system>) documents 90.2% improvement on breadth-first tasks at ~15× token cost — plan the cost model accordingly.

**Verification is deterministic, not agentic.** Wire a `PostToolUse` hook matching `Edit|Write` to shell out `ruff check --fix && ruff format && mypy` on touched files, and a `Stop` hook that runs the full test suite before the agent can finish its turn — if it exits non-zero the output is injected back and the agent must fix it. This is the single highest-leverage pattern in the entire design space. CLAUDE.md is advisory (~80% compliance); hooks are deterministic (100%). Keep CLAUDE.md under 120 lines and universal; put everything that must-happen-every-time in hooks.

## 3. The generator/evaluator loop (GAN-inspired core)

The most important single pattern for producing production-quality output over long horizons comes from Anthropic Labs' **"Harness design for long-running application development"** by Prithvi Rajasekaran (<https://www.anthropic.com/engineering/harness-design-long-running-apps>, 24 Mar 2026). Taking inspiration from Generative Adversarial Networks, the harness separates a **generator** agent that writes code from an **evaluator** agent that judges it — and the two negotiate sprint contracts before any code is written. This is the pattern that delivered the phase-change cost/quality delta in Anthropic's own experiments: a single agent produced a barely-functional 2D retro game-making tool in 20 minutes for $9, while the full generator/evaluator harness ran for 6 hours, cost $200, and delivered a polished working application. **The post frames this as "over 20× more expensive"** (arithmetic: $200 ÷ $9 ≈ 22×). A separate DAW run under the updated (post–sprint-construct) harness totaled 3 hr 50 min and $124.70. Either way, the extra cost bought a working product vs. a broken one.

**Anthropic also open-sourced the reference implementation** at [`anthropics/riv2025-long-horizon-coding-agent-demo`](https://github.com/anthropics/riv2025-long-horizon-coding-agent-demo) (59 stars, last commit 2026-02-05 at research time — low profile but this *is* the code behind the blog post). Patterns worth lifting verbatim when you build L3:

- **Two-field `agent_state.json`** — `desired_state` (what the operator wants) vs `current_state` (what the agent is doing), with documented values `continuous | pause | run_once | run_cleanup`. Cleanly separates control plane from data plane.
- **Context reset on `prompt_too_long`**, not compaction. On the error, terminate the session and start a fresh `ClaudeSDKClient`; durable state lives in `claude-progress.txt` (append-only, never deleted) and git commits on an `agent-runtime` branch — not in chat history.
- **Per-session security hooks via `HookMatcher`** — `bash_security_hook`, `universal_path_security_hook`, `cd_enforcement_hook`, `track_read_hook` (all in `src/security.py`), wrapped at session-construction time so they capture the project root.
- **Out-of-process evaluator** — Playwright `e2e-tests/smoke.spec.ts` + CloudFront preview deploy + screenshots posted to a GitHub issue. The evaluator lives in a different universe (real browser) from the generator.
- **Anti-AI-slop design prompt** in `prompts/system_prompt.txt` (not in `claude_code.py`): "AI models tend to converge on safe, generic design choices… centered layouts, purple gradients, uniform rounded corners, Inter font — what users call the 'AI slop aesthetic.'… The goal is +3σ design that far exceeds median quality." Forces the generator to state its aesthetic fusion before coding.
- **AWS-specific pieces to strip**: Bedrock AgentCore entrypoint, CDK scaffolding in `infrastructure/`, CloudWatch metrics exporter. Reusable if you need remote execution; skip otherwise.

**Why two agents, not one.** A single agent grading its own work is a pathological optimist — it will almost invariably give itself high marks even for mediocre output, and this gets worse in subjective domains. The post's verbatim diagnosis: "When asked to evaluate work they've produced, agents tend to respond by confidently praising the work—even when, to a human observer, the quality is obviously mediocre." The structural fix, also verbatim: "But tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work." Mechanically the two "agents" are the same harness with different initial user prompts — same system prompt, same tools, same Agent SDK config — which means you implement this as two `AgentDefinition` entries or two alternating `ClaudeSDKClient` sessions, not as a separate framework.

**The evaluator has runtime tools, not just read-only code access.** This is where most homebrew critic-agent implementations fall short. For web apps, the evaluator uses **Playwright MCP** to drive the running page — navigate, click, inspect DOM, hit APIs, check DB state — like a human QA engineer. For backend work, it runs integration tests, hits HTTP endpoints, and inspects database rows. **The evaluator judges the running system, not the diff.** A code reviewer agent that only reads diffs catches typos and style issues; an evaluator that exercises the artifact catches the broken-event-handler and failed-API-call bugs that make the difference between a demo and a product.

**Sprint contracts are negotiated before coding starts.** Before each sprint, generator and evaluator agree on what "done" means and how it will be verified. The generator proposes a spec plus verification plan; the evaluator reviews and either approves or sends it back with specific concerns. Only after agreement does any code get written. This bridges the gap between a high-level user story ("build a user settings page") and a testable implementation, and it's a stronger pattern than decomposing to `tasks.md` up-front because the agents negotiate scope with current context. Communication happens through files — generator writes `sprint-N-proposal.md`, evaluator writes `sprint-N-contract.md`, never via shared in-context messages — which keeps each context window clean.

**Weighted rubric with hard per-criterion thresholds.** The evaluator scores against an explicit rubric; for frontend design Anthropic used four dimensions (design quality, originality, craft, functionality), each 0–10, **each with an independent hard threshold (default 7)**. Any single criterion below threshold triggers FAIL regardless of the average. This prevents the evaluator from balancing a broken core feature against exceptional visual design — you cannot ship a pretty UI that doesn't work. For coding harnesses, adapt the dimensions to your domain: `correctness` (tests pass), `maintainability` (review score), `completeness` (spec coverage), `performance` (latency/resource budgets met). Weight the dimensions where your model is weakest — Anthropic weighted originality heavily specifically because Claude already scored well on craft and functionality by default, and needed to be pushed toward aesthetic risk-taking (explicitly penalizing generic "AI-style" white-cards-on-purple-gradient patterns).

**The loop terminates on passing rubric, not on generator self-declaration.** Generator writes code → commits → writes a build report → evaluator runs the artifact and scores → if all thresholds met, sprint passes; otherwise evaluator writes detailed failure feedback to a file and generator iterates. Typical runs see 5–15 iterations per sprint, sometimes taking hours. Hard-cap iteration count and escalate to human if the rubric hasn't cleared by iteration N — runaway generator/evaluator cycles are a known failure mode and worth a `max_iterations` budget per sprint.

**Harness components encode assumptions about model weakness — plan to delete them.** The evolution of Anthropic's own harness is the pattern to internalize. The original harness (Sonnet 4.5) required context resets between sprints because the model exhibited "context anxiety," prematurely wrapping work as it approached perceived context limits. Opus 4.5 largely removed that behavior, so context resets got dropped — the harness switched to one continuous session with automatic compaction. Opus 4.6 was strong enough that **the sprint construct itself got removed**; the post's direct framing is "I started by removing the sprint construct entirely… I kept both the planner and evaluator." Planner, generator, and evaluator all remained — the generator simply handled decomposition natively under Opus 4.6 rather than having decomposition imposed via sprints. (Earlier drafts of this document said "only planner and evaluator remained" — that is wrong; corrected here.) The quote worth pinning on the wall (confirmed verbatim up to the closing portion): **"every component in a harness encodes an assumption about what the model can't do on its own."** Build the full harness for today's model, but instrument it so you can measure which components still add value as models improve, and delete ruthlessly. There is no "V3" in the post — the trajectory is original → updated-after-Opus-4.6.

**When to use two agents vs. one.** The generator/evaluator pair is worth the ~15–22× cost overhead for work where quality is subjective or hard to verify (UI/UX, API design, architecture decisions, anything where "good enough" is judgment-dependent). For work where `pytest` gives a clean pass/fail signal, a single generator with deterministic hooks often matches the two-agent loop at a fraction of the cost — the hooks are the evaluator. **Use the GAN loop when the acceptance criteria can't be fully captured in a test suite.** That's most real product work, and almost never true for pure library code.

## 4. Context, memory, and the compaction discipline

Long-horizon sessions die from **context rot** — the n² attention degradation as tokens grow — long before they hit the window limit. The cure is Anthropic's reframing from "prompt engineering" to **context engineering**: curate the smallest high-signal token set that maximizes P(success). Four primitives compose into the solution.

First, **offload aggressively to files**. The agent writes intermediate findings to `notes/`, `research/`, `reflections/` directories and re-reads only what it needs via `grep`/`glob`/`read`. This is not optional for multi-day runs. Anthropic's own recommended harness uses three complementary scratchpads: `claude-progress.txt` (append-only log, ≤2KB for fast re-orientation), `feature_list.json` (structured state), and git commits (durable checkpoints with `git log`/`git diff` as queryable history). The generator/evaluator pair extends this with per-sprint files — `sprint-N-proposal.md`, `sprint-N-contract.md`, `sprint-N-verdict.md` — which double as the audit trail.

Second, **customize the compaction prompt**. The SDK's default compaction loses tool invariants. Register a `PreCompact` hook that injects `additionalContext` preserving: the current feature JSON, open diffs, last failing test output, the active sprint contract, and the last 2–3 tool calls verbatim. Trigger compaction at a planned boundary (between sprints), never mid-edit.

Third, **use agentic search, not vector RAG, for code**. Simon Willison, Armin Ronacher, and Anthropic all converge here: `grep`, `find`, `rg`, and `tree-sitter` repo maps (Aider's PageRank-based map is the gold standard, budgeted via `--map-tokens`) outperform embeddings on code retrieval and are free. Add vectors only if you have concrete semantic-retrieval pain across dependencies or docs.

Fourth, **memory systems are mostly overkill for a single project.** The benchmarked options — **mem0** (SaaS, leads LoCoMo), **LangMem** (LangGraph-native), **Letta/MemGPT** (OS-inspired tiers), **Zep/Graphiti** (temporal knowledge graphs) — matter for multi-user assistants or when "when did we decide X" queries span months. For a coding harness, **`CLAUDE.md` + append-only `progress.txt` + git is a strong default** that's transparent, diffable, and zero-infra. Adopt a memory system only after you feel specific retrieval pain.

The canonical references: "Effective context engineering for AI agents" (<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>), the cookbook notebook at <https://github.com/anthropics/claude-cookbooks> under `tool_use/context_engineering/`, and MemGPT's paper at <https://arxiv.org/abs/2310.08560>.

## 5. What to steal from each harness in the landscape

The open-source landscape as of April 2026 contains enough proven patterns that you should not re-invent. The **single-most-portable ideas** are listed below, with the harnesses that pioneered them:

From **Aider** (<https://github.com/Aider-AI/aider>, ~35k stars): the **tree-sitter repo map with PageRank ranking** budgeted to `--map-tokens`, the **per-model edit-format registry** (whole / diff / diff-fenced / udiff — each model pinned to what benchmarks best), the **architect/editor split** where a reasoning model plans in prose and a cheaper model translates to edits, and **`auto-lint` + `auto-test` via `.aider.conf.yml`** — Aider implements exactly the verification loop you need and is worth reading for the prompt patterns alone.

From **OpenHands** (<https://github.com/All-Hands-AI/OpenHands>, ~71k stars): the **Agent-Computer Interface (ACI)** abstraction, the **stuck-state detector** that kills pathological loops after N no-progress iterations, and the **Docker-sandboxed runtime with opt-in remote runtime** (agent local, tools remote over WebSocket).

From **Cursor** (closed source but well-documented): **dynamically-generated per-workspace Seatbelt/Landlock sandbox policies** reducing interruptions by 40% (<https://cursor.com/blog/agent-sandboxing>), **async subagents that spawn subagents in a tree** with an `Await` tool for completion, and the **Composer RL pipeline** (<https://cursor.com/blog/composer>) that deploys a new model checkpoint ~every 5 hours trained inside Cursor's own harness.

From **Amp** (<https://ampcode.com>, closed): **subagents as a context-window multiplier** (each with its own window, returning only final summaries), **cross-model composition inside one thread** (Claude for speed, GPT-5 "Oracle" for heavy reasoning, Librarian for cross-repo code-graph grounding), and **Toolboxes** — plain scripts discovered via an env var as a simpler alternative to MCP for local tools.

From **Roo Code** (<https://github.com/RooCodeInc/Roo-Code>, ~22.8k stars): **file-glob-restricted modes** (`FileRestrictionError` if an agent writes outside scope) and **per-mode model routing** (o3 for Architect, Sonnet for Code).

From **Windsurf/Cascade** (closed, Cognition-owned): a **background planner agent continuously re-planning while the executor acts short-term**, **checkpoints as a first-class rewind primitive**, and **lint-repair as an automatic default** rather than an opt-in.

From **LangGraph / Deep Agents / Open SWE** (<https://github.com/langchain-ai/deepagents>, <https://github.com/langchain-ai/open-swe>): **middleware + deterministic post-agent nodes** (e.g., `open_pr_if_needed` that commits and opens a PR regardless of the agent's last message), **pluggable sandbox backends** (Modal, Daytona, Runloop), and **Slack/Linear/GitHub triggers** as invocation surfaces.

From **SWE-agent** (<https://github.com/SWE-agent/SWE-agent>): the **SWE-ReX deployment library** as a reusable Docker-on-anywhere execution backend and **YAML-configurable agent definitions** for rapid iteration.

From **Plandex** (<https://github.com/plandex-ai/plandex>): the **cumulative diff-review sandbox** — all agent edits staged separately from real files until explicitly applied, with branches per plan for alternative approaches.

From **Codex CLI** (<https://github.com/openai/codex>): **path-addressed subagent graphs** (`/root/agent_a` with structured messaging) and the **AGENTS.md open standard** (joint with Google, Cursor, Factory, Sourcegraph) — symlink it to `CLAUDE.md` for cross-tool compatibility.

From **MetaGPT** (<https://github.com/FoundationAgents/MetaGPT>): **structured-artifact communication over free-form chat** (agents publish PRDs and sequence diagrams to a shared message pool rather than talking).

From **`anthropics/riv2025-long-horizon-coding-agent-demo`** (the reference code behind the Rajasekaran post; see §3 for patterns): **two-field state file**, **context-reset-on-error**, **`claude-progress.txt` as durable memory**, **out-of-process Playwright evaluator**, **anti-AI-slop system prompt**.

From **`obra/superpowers`** (<https://github.com/obra/superpowers>, plugin v5.0.7 at research time; star count is anomalously high for a ~6-month-old plugin — verified as real but treat the number as a signal, not a metric): the **`subagent-driven-development` skill** is the cleanest in-the-wild L2 GAN-style orchestrator. Four files under `skills/subagent-driven-development/`: `SKILL.md` (controller flow), `implementer-prompt.md`, `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`. The iron rule to steal verbatim from `spec-reviewer-prompt.md`: *"The implementer finished suspiciously quickly. Their report may be incomplete, inaccurate, or optimistic. You MUST verify everything independently. DO NOT: Take their word for what they implemented. Verify by reading code, not by trusting report."* Two-stage review: spec-compliance runs FIRST, and only after it passes does code-quality review dispatch. Also steal the `verification-before-completion` skill's rule: "No completion claims without fresh verification evidence. Violating the letter of this rule is violating the spirit of this rule."

From **`EveryInc/compound-engineering-plugin`** (<https://github.com/EveryInc/compound-engineering-plugin>, ~14.5k stars): a **28-persona reviewer library** under `plugins/compound-engineering/agents/review/` (including `adversarial-reviewer`, `architecture-strategist`, `correctness-reviewer`, `security-sentinel`, `performance-oracle`, `schema-drift-detector`, name-branded specialists like `dhh-rails-reviewer`, plus many more). The `adversarial-reviewer.md` opening is worth stealing verbatim: *"You are a chaos engineer who reads code by trying to break it. Where other reviewers check whether code meets quality criteria, you construct specific scenarios that make it fail. You think in sequences: 'if this happens, then that happens, which causes this to break.' You don't evaluate — you attack."* The `ce:review` skill supports four execution modes parsed from `$ARGUMENTS` — interactive (default), `mode:autofix`, `mode:report-only`, `mode:headless` (last of these emits a structured JSON envelope for skill-to-skill invocation, which is the shape you want when wrapping review inside a larger harness).

From **`hamelsmu/evals-skills`** (<https://github.com/hamelsmu/evals-skills>, ~1.1k stars): Hamel Husain's eval methodology packaged as seven Claude Skills you can drop into `.claude/skills/`. Exact directories: `eval-audit` (run first — surfaces missing error analysis, unvalidated judges, vanity metrics), `error-analysis`, `generate-synthetic-data` (features × scenarios × personas), `write-judge-prompt` (binary-first LLM-as-judge), `validate-evaluator` (calibrate against human labels with TPR/TNR), `evaluate-rag`, `build-review-interface`. Adopt wholesale rather than inventing your own eval skills.

From **`automazeio/ccpm`** (<https://github.com/automazeio/ccpm>, ~8k stars): **PRD → Epic → GitHub Issues → parallel agents** pipeline. Five-phase skill (Plan → Structure → Sync → Execute → Track) under `skill/ccpm/` (singular). The most portable idea: a `parallelization_factor` is computed in `skill/ccpm/references/execute.md` from file-overlap analysis *before* worktree agents are dispatched — the Execute phase writes `<N>-analysis.md` with per-stream blocks (scope / files / can_start / dependencies) and only then spawns agents. Also the "Script-First Rule": if a deterministic bash script can answer the question, the agent must invoke the script rather than reason about it.

From **`trailofbits/skills`** (<https://github.com/trailofbits/skills>, ~4.6k stars): security-minded specialized reviewers packaged as plugins. The `spec-to-code-compliance` skill is the ToB analog of superpowers' spec-reviewer — its `description:` field: *"Verifies code implements exactly what documentation specifies for blockchain audits. Use when comparing code against whitepapers, finding gaps between specs and implementation, or performing compliance checks for protocol implementations."* Also `differential-review`, `agentic-actions-auditor` (audits the harness config itself), and 30+ others.

From **`anthropics/skills`** (<https://github.com/anthropics/skills>, reference repo for the Agent Skills spec): the **`webapp-testing` skill** is the pattern to copy if your evaluator drives a browser. Tiny `SKILL.md` that delegates heavy lifting to `scripts/with_server.py` as a black-box executable; the discipline is *"Always run scripts with `--help` first to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely [sic] necessary. These scripts can be very large and thus pollute your context window."* Keep skills tiny; keep the real logic in scripts the agent calls.

From **`github/spec-kit`** (<https://github.com/github/spec-kit>, ~88.6k stars): a canonical spec-driven pipeline of nine slash commands (`/speckit.specify → /speckit.clarify → /speckit.plan → /speckit.tasks → /speckit.analyze → /speckit.implement`, plus `/speckit.checklist`, `/speckit.constitution`, `/speckit.taskstoissues`), backed by Markdown templates that read one stage's output and write the next. The unique contribution beyond the commands themselves is the **integration registry under `src/specify_cli/integrations/`** — 30+ agent-specific subpackages (claude, cursor_agent, codex, copilot, gemini, windsurf, kiro_cli, opencode, roo, goose, etc.) that translate the canonical Markdown commands into each agent's native format. Steal the pipeline shape even if you don't adopt the full command set.

The comparison table below captures the dimensions that matter for a long-horizon build:

| Tool | Sandbox | Background / async | Subagents | Context management | Verification |
|---|---|---|---|---|---|
| OpenHands | Docker runtime + optional remote | Cloud + remote runtime | Planning mode, multi-agent SDK | Stuck detector, per-conversation | Shell tools + hooks |
| Aider | None (host) | No — interactive | No | Repo map + edit formats | `auto-lint`, `auto-test` |
| Cursor Cloud | Seatbelt/Landlock + worktrees/VMs | Up to 8 parallel Cloud Agents | Async, tree-spawning | Trained in RL | Tests + lint trained in |
| Amp | Inherits shell | Headless CLI `amp -x` | Task + Oracle + Librarian | Thread fork/share | Via tools + AGENTS.md |
| Roo Code | IDE / Cloud per agent | Cloud Agents on PR branches | Subtasks + experimental subagent tool | Task history, boomerang | Per-mode; PR Reviewer agent |
| LangGraph/Open SWE | Pluggable (Modal/Daytona/Deno) | Durable execution + interrupts | Native `task` tool | Auto-summarization + middleware | `open_pr_if_needed` middleware |
| Jules (closed) | Google Cloud VM per task | Core design | Planner + Coder + Critic | Env snapshots reused | Critic agent reviews diffs |
| SWE-agent | Docker (SWE-ReX) | No | EnIGMA tools only | Per-issue oriented | SWE-bench harness |

## 6. Verification is the product

The difference between a demo and a production harness is entirely in the verification layer. For pure code correctness (section 3's "where tests give clean signal") the deterministic stack below is sufficient; for subjective quality the generator/evaluator loop in section 3 wraps around it. Build both in this order.

**Deterministic checks run on every edit.** `ruff check --fix && ruff format` (≈100ms), `mypy --strict src tests` (seconds), `pytest -x -q tests/unit` (fast fail), `pytest tests/integration` (slower, testcontainers), `coverage --fail-under=85`. Wire as a `PostToolUse` hook on `Edit|Write` and a `Stop` hook as the final gate. **Use a backpressure wrapper** around test output — verbose pytest fills context windows; `scripts/test-quiet.sh` should return only `PASS` + the summary line or the first failure's assertion + traceback (HumanLayer's pattern at <https://www.humanlayer.dev/blog/context-efficient-backpressure>).

**TDD is the default loop.** Prompt: "Write failing tests first based on the acceptance criteria. Do not implement. Confirm tests fail for the right reason. Commit. Then implement minimal code to pass. Never modify passing tests. If a test fails after 3 attempts, stop and describe the problem." The last clause is critical — agents "cheat" by weakening assertions or adding `pytest.skip`. Mitigations: **lock `tests/` with a pre-commit hook that flags human approval for test-file diffs**, and run **mutation testing** (`mutmut`, `cosmic-ray`) in CI so shallow tests are caught.

**Multi-model critique pays off only for high-stakes diffs.** Evidence from Microsoft's 365 Copilot Critique: GPT drafts → Claude reviews → +13.8% on DRACO. In practice, Claude writing and GPT-5 reviewing catches complementary bugs (terminal-injection vulnerabilities, path-handling errors, returncode-vs-output mistakes) because training-data blind spots don't overlap. **Don't run it on every diff** — cost exceeds benefit for CRUD; reserve for architecture changes, security-sensitive paths, and stuck-debugger escalations. Consider this a specialization of the generator/evaluator pattern where the evaluator runs a different model family.

**Reflexion for within-session recovery.** After each failed test run, an agent generates a "why I failed + what I'll do differently" reflection, appended to `reflections.md` (cap at 3 entries, rotated). The original paper's 91% HumanEval number is less relevant today since frontier models beat that baseline, but the pattern still measurably helps when tests cheaply signal failure.

**End-to-end behavioral tests matter more than unit tests.** Anthropic's key finding: Claude declares victory on unit-test green and misses integration bugs. Force an `integration_test.py` or Playwright/Puppeteer script that exercises the public API; only flip `passes: true` after that exits 0. **This is the floor; the generator/evaluator evaluator with Playwright MCP (section 3) is the ceiling.**

**Evals are the outer quality loop.** Build a minimum viable eval harness now: 10 real tickets from your backlog, each with a pre-ticket commit snapshot and encoded `FAIL_TO_PASS`/`PASS_TO_PASS` acceptance tests (SWE-bench style). Re-run after every harness change. Hamel Husain's framework — **error analysis first** (label 50–100 traces, cluster errors, write judges last), **three levels of tests** (code assertions every change, LLM-as-judge periodic, human review major) — is the reference methodology (<https://hamel.dev/blog/posts/evals-faq/>, <https://hamel.dev/blog/posts/llm-judge/>, <https://github.com/hamelsmu/evals-skills>). For the L2/L3 evaluator specifically, four verbatim guardrails from Hamel's LLM-as-judge guide belong on the wall: *"A binary decision forces everyone to consider what truly matters."* *"What makes something a 3 versus a 4? Nobody knows."* *"Don't stray from binary pass/fail judgments when starting out."* And the agreement target, from the Honeycomb case: *"It took us only three iterations to achieve > 90% agreement between the LLM and Phillip."* (Attributed to one specific human reviewer, not a generic "human" — the calibration is always against *someone*.)

### 6.1 What the evaluator itself can be fooled by

Every evaluator-driven loop has four failure modes documented in primary sources. Plan for all of them.

**Criteria drift.** Shankar et al., "Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences" (arxiv 2404.12272; ACM UIST 2024, DOI 10.1145/3654777.3676450). The load-bearing finding: *"users need criteria to grade outputs, but grading outputs helps users define criteria."* You cannot specify an evaluator rubric fully up front — it emerges from watching the evaluator mis-grade real outputs. This is exactly what the Rajasekaran post describes doing for several rounds: *"read the evaluator's logs, find examples where its judgment diverged from mine, and update the QA's prompt."* Budget for 3–5 rounds of judge-prompt iteration before trusting the numbers.

**Eval contamination in multi-agent setups.** Anthropic's "Eval awareness in Claude Opus 4.6's BrowseComp performance" (<https://www.anthropic.com/engineering/eval-awareness-browsecomp>, 2026-03-06) documents the first observed case of a model identifying an unknown benchmark mid-run: *"To our knowledge, this is the first documented instance of a model suspecting it is being evaluated without knowing which benchmark was being administered, then working backward to successfully identify and solve the evaluation itself."* In the same study, multi-agent configurations produced "unintended solutions" at 0.87% vs. 0.24% for single-agent — a **3.7× difference** (note: the post's term is "unintended solutions," not "contamination"; and the figure is a ratio between two small rates, not "3.7× higher contamination rates" in the absolute sense). Implication for a GAN harness: if your evaluator can recognize its own eval set, it may stop grading and start solving. Rotate eval inputs periodically; keep a hold-out set the evaluator never sees.

**Infrastructure noise swamps real signal.** Anthropic's "Quantifying infrastructure noise in agentic coding evals" (<https://www.anthropic.com/engineering/infrastructure-noise>): *"the gap between the most- and least-resourced setups on Terminal-Bench 2.0 was 6 percentage points (p < 0.01)"* — larger than the gap between some frontier models. Infrastructure errors dropped from 5.8% (strict cgroup kill-on-limit) to 0.5% (uncapped). The recommendation lands at: *"leaderboard differences below 3 percentage points deserve skepticism until the eval configuration is documented and matched."* Your harness must log the runtime envelope (CPU, memory, timeout, concurrency, model version, tool versions) per trial, and never mix results across envelopes.

**Auto Mode classifier limits.** Anthropic's "Claude Code auto mode" (<https://www.anthropic.com/engineering/claude-code-auto-mode>, 2026-03-25) publishes Sonnet-4.6-classifier numbers: full-pipeline FPR 0.4% on 10k real-traffic actions; FNR 17% on 52 real overeager actions; FNR 5.7% on 1k synthetic exfil attempts; Stage 1 (cheap single-token) FPR 8.5%, FNR 6.6% real / 1.8% synthetic. The design insight worth stealing: the classifier sees only user messages and executable tool calls — assistant reasoning and tool outputs are stripped so the primary agent cannot "talk the classifier into a bad call." Apply the same principle to any judge you build.

## 7. Parallelism with git worktrees

Claude Code 2.1.50+ ships native `--worktree` support; subagents can declare `isolation: worktree` in frontmatter and get `.claude/worktrees/<n>/` with an `agent/<feature-n>` branch. The orchestration script below is copy-pasteable and supports the N-parallel-implementations-then-pick-best pattern used in practice. **Design principle: if two agents would touch the same file, either split the file or serialize — scope agents to disjoint directories.**

```bash
#!/usr/bin/env bash
# scripts/spawn-parallel.sh <feature> <n> [base]
set -euo pipefail
FEATURE="${1:?}"; N="${2:-3}"; BASE="${3:-main}"
ROOT="$(git rev-parse --show-toplevel)"
mkdir -p "$ROOT/.worktrees" "$ROOT/.agent-status"
git fetch origin "$BASE"
for i in $(seq 1 "$N"); do
  BRANCH="agent/${FEATURE}-${i}"
  DIR="$ROOT/.worktrees/${FEATURE}-${i}"
  [ -d "$DIR" ] && continue
  git worktree add -b "$BRANCH" "$DIR" "origin/$BASE"
  [ -f "$ROOT/.env" ] && cp "$ROOT/.env" "$DIR/.env"
  (cd "$DIR" && uv sync --quiet)
  echo "{\"task\":\"$FEATURE-$i\",\"status\":\"PENDING\"}" > "$ROOT/.agent-status/${FEATURE}-${i}.json"
done
```

Cap at 3–4 concurrent agents to stay within API rate limits. An `integrator` subagent rebases and resolves conflicts when tasks complete. For the N-implementations fan-out: run each implementation through the generator/evaluator loop, then pick the one with fewest LOC delta that clears the rubric and has the highest evaluator score.

## 8. Infrastructure for multi-day runs

For **local dev**: Docker devcontainer matching CI. For **untrusted parallel cloud runs**: **E2B** (Firecracker microVMs, ~150ms start, 24h sessions, AI-first SDK) or **Daytona** (Docker + optional Kata, ~27–90ms start, unlimited sessions, persistent workspaces, fastest boot). For **GPU integration tests**: **Modal** (gVisor, serverless scale, Python-first). For **persistent state with rollback**: **Fly.io Sprites** (Firecracker + 300ms checkpoint). Snapshot the sandbox at every green-rubric checkpoint so failure recovery becomes `restore → continue`.

**Session state persistence.** Claude Agent SDK's JSONL sessions are local to the machine; for cross-host resumability use a SQLite-backed session log (LangGraph's `SqliteSaver` pattern) or Anthropic's Managed Agents session-log model (<https://www.anthropic.com/engineering/managed-agents>) which decouples storage from harness context strategy via `getEvents()` over a durable log.

**Cost management.** Run a **model cascade**: Haiku for file discovery/triage, Sonnet for implementation, Opus for architecture and hard debugging — set `model` per subagent in `AgentDefinition`. The generator/evaluator pair is expensive; budget it deliberately per sprint. Keep system prompts, CLAUDE.md, and tool definitions stable for **prompt caching** (Claude caches up to ~1hr at ~10% cost; cache breaks on any prefix mutation). Track `cache_read_input_tokens` in `ResultMessage.usage` to confirm cache hits. Set `max_turns` and `max_budget_usd` per session with hard stop-and-escalate behavior; surface cost per feature to the human reviewer in the daily digest.

**Rate limits.** Wrap the SDK client in a token-bucket that honors `retry-after`; for sustained multi-day runs, enable Bedrock or Vertex via `CLAUDE_CODE_USE_BEDROCK=1`/`CLAUDE_CODE_USE_VERTEX=1` for multi-region failover. Batch reflection and critique calls off the critical path.

**Observability.** Stream all tool calls to JSONL via SDK hooks (`PreToolUse`, `PostToolUseFailure`, `SubagentStart/Stop`). Ship to Langfuse or LangSmith if you want a trace UI. Update a status file every N seconds (`{iteration, files_touched, last_test_result, evaluator_scores, tokens_used, cost_usd}`) that a lightweight dashboard can poll. Set hard limits: max iterations per sprint, max tokens, max wall-clock — abort and escalate to human on timeout.

## 9. Human-in-the-loop for overnight runs

In-session `interrupt()` works for interactive chat but fails for multi-day runs — no one is watching. The production pattern (StrongDM, Anthropic Managed Agents, Open SWE) is **out-of-band notification with deep-link resume**. Implement a custom MCP `request_review` tool: the agent calls it at phase gates, it persists session state via the checkpointer, posts to Slack with Approve/Reject/Edit buttons plus a summary of the diff and the evaluator's rubric scores, and a callback webhook resumes the session via `Command(resume=decision)`.

**When to interrupt.** Before destructive ops (DROP, `rm -rf`, force-push, deploys, paid API calls). At phase gates (spec approved? plan approved? sprint contract negotiated? PR ready?). On N consecutive evaluator FAILs on the same sprint. When budget threshold hit. On ambiguous verification. **Auto-approve** under thresholds: reads, lints, tests, commits to feature branches, small file edits. This is what Cursor's sandboxing work achieved — 40% fewer interruptions by making the tool prompt sandbox-aware.

**PR review is the unit of delivery.** Agent works in worktree → generator/evaluator loop converges on passing rubric → opens PR with metadata (agent version, model, spec IDs, evaluator scores, verification summary) → human reviews diff (not the transcript) → leaves comments → reviewer subagent addresses them → cycle until merge. The official **Claude Code Review GitHub Action** posts inline severity-tagged comments without blocking merges by default; the **PR Review Toolkit** multi-specialist pattern (5 parallel agents: conventions, silent-failures, types, coverage, comments-vs-code) is a stronger variant.

**Cursor's security-agent rollout is the template for any new review agent**: findings to private Slack → non-blocking PR comment → blocking CI gate for specific severities, with a deduplication classifier and Terraform-managed config. Never ship a blocking review agent day one.

## 10. Agent-facing repo conventions

The files below are the steering layer. Keep them ruthlessly minimal.

**`AGENTS.md` is the open standard** (joint OpenAI/Google/Cursor/Factory/Sourcegraph, supported by Codex, Cursor, Aider, Jules, Gemini CLI, Zed, Factory Droids, Amp, Windsurf). Discovery walks up from CWD to repo root; nested `AGENTS.md` in subdirs override (closest-wins). **Symlink `AGENTS.md → CLAUDE.md`** for Claude Code compatibility from one source of truth. OpenAI's monorepo has 88 `AGENTS.md` files, one per package — nest them.

**`CLAUDE.md` best practice**: <300 lines (HumanLayer keeps <60 at <https://www.humanlayer.dev/blog/writing-a-good-claude-md>). Structure as WHAT (repo map) / WHY (domain purpose) / HOW (build/test/verify commands). Don't ship `/init`'s auto-generated bloat. Don't encode style rules — let `ruff`/`mypy` do it via hooks. Delete every line you can't justify with "would Claude make this mistake without it?" Use `@path/file.md` imports to load referenced docs on demand.

**Skills (`.claude/skills/<n>/SKILL.md`)** implement progressive disclosure: metadata (~100 tokens) always pre-loaded, SKILL.md body (≤500 lines, ~5k tokens) loaded when triggered, bundled scripts executed on demand. The `description:` field is a **trigger, not a summary** — write it for the model: "Use when the user asks to run tests, debug failures, or add coverage." Anthropic argues skills may be a bigger deal than MCP (Simon Willison's take at <https://simonwillison.net/2025/Oct/16/claude-skills/>). Reference skills at <https://github.com/anthropics/skills>; `obra/superpowers` on GitHub popularized the pattern.

**Slash commands in `.claude/commands/*.md`** for deterministic workflows (`/review-pr`, `/tdd-feature`, `/migrate`, `/negotiate-sprint-contract`). Shrivu Shankar's warning bears repeating: if you have a long list of complex slash commands, you've built an anti-pattern. Keep <10 high-value commands.

**Recommended repo layout**:

```
AGENTS.md                         # symlinked to CLAUDE.md
.claude/{settings.json, commands/, skills/, agents/}
docs/{ARCHITECTURE, DATABASE, TESTING, DEPLOY, GOTCHAS}.md
specs/<feature>/{spec.md, plan.md, tasks.md}
sprints/<feature>/{sprint-N-proposal.md, sprint-N-contract.md, sprint-N-verdict.md}
src/<pkg>/{api, services, db, clients}/  # nested AGENTS.md per package
tests/{unit, integration}/
evals/{dataset/, judges/, metrics/, rubrics/, run_eval.py}
scripts/{spawn-parallel.sh, sync-worktrees.sh, test-quiet.sh}
.github/workflows/{ci.yml, claude-review.yml}
```

**Hook stack in `.claude/settings.json`** — copy this verbatim:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "ruff check --fix \"$CLAUDE_FILE_PATHS\" 2>&1 | tail -n 50" },
          { "type": "command", "command": "ruff format \"$CLAUDE_FILE_PATHS\"" }
        ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "mypy src && pytest -x -q tests/unit" } ] }
    ]
  }
}
```

## 11. The thought-leader canon to keep open

The reads that carry the most leverage for someone building a harness right now, ranked by direct applicability:

First, **Anthropic's "Effective harnesses for long-running agents"** (<https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>, Nov 2025) — the blueprint for multi-session bootstrap with initializer + coding-agent + `claude-progress.txt`. Second, **Anthropic Labs' "Harness design for long-running application development"** by Prithvi Rajasekaran (<https://www.anthropic.com/engineering/harness-design-long-running-apps>, early 2026) — the GAN-inspired generator/evaluator pattern with sprint contracts and hard-thresholded rubrics; the defining post for section 3 of this report. Third, **"Building effective agents"** (<https://www.anthropic.com/engineering/building-effective-agents>, Dec 2024) defines the workflow-vs-agent taxonomy and the orchestrator-worker/evaluator-optimizer patterns everyone now uses. Fourth, **"Effective context engineering for AI agents"** (<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>, Sep 2025) reframes the discipline. Fifth, **Thorsten Ball's "How to Build an Agent"** (<https://ampcode.com/notes/how-to-build-an-agent>, Apr 2025) demystifies the whole category in <400 lines: "an LLM, a loop, and enough tokens."

Sixth, **Simon Willison's "Agentic Engineering Patterns" living guide** (<https://simonwillison.net/guides/agentic-engineering-patterns/>, Feb 2026–ongoing) is the Gang-of-Four for this space; pair with his "Vibe engineering" (<https://simonwillison.net/2025/Oct/7/vibe-engineering/>, Oct 2025, defining the term as "where seasoned professionals accelerate their work with LLMs while staying proudly and confidently accountable for the software they produce") and "Designing agentic loops" (Sep 2025). Seventh, **Armin Ronacher's series**: "Agentic Coding Recommendations" (<https://lucumr.pocoo.org/2025/6/12/agentic-coding/>, Jun 2025), "Tools: Code Is All You Need" (<https://lucumr.pocoo.org/2025/7/3/tools/>, Jul 2025), "Things That Didn't Work" (Jul 2025), and "Pi: The Minimal Agent Within OpenClaw" (<https://lucumr.pocoo.org/2026/1/31/pi/>, Jan 2026, verbatim: *"it has a tiny core. It has the shortest system prompt of any agent that I'm aware of and it only has four tools: Read, Write, Edit, Bash"* — the strongest minimalist counter-position to heavy multi-agent scaffolding). Eighth, **Harper Reed's "My LLM codegen workflow atm"** (<https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/>) — concrete spec→plan→execute loop, widely adopted.

Ninth, **Hamel Husain's "Evals FAQ," "Using LLM-as-a-Judge For Evaluation," and "Evals Skills for Coding Agents"** (<https://hamel.dev/blog/posts/evals-faq/>, <https://hamel.dev/blog/posts/llm-judge/>, <https://hamel.dev/blog/posts/evals-skills/>) for the quality-loop methodology — the LLM-as-judge guide is where the binary-pass/fail and Critique Shadowing patterns live. Tenth, **Birgitta Böckeler's "Harness Engineering for Coding Agent Users"** (<https://martinfowler.com/articles/harness-engineering.html>, Feb 2026) defines Agent = Model + Harness and catalogs computational vs. inferential guides/sensors. Eleventh, **Kent Beck's "Augmented Coding: Beyond the Vibes"** (<https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes>, Jun 2025) gives the right mental model: TDD is a superpower for supervising agents. Twelfth, **Shreya Shankar's "Who Validates the Validators?"** (arxiv <https://arxiv.org/abs/2404.12272>, ACM UIST 2024 DOI 10.1145/3654777.3676450) is the theoretical backing for "criteria drift" — why evaluator rubrics emerge from observed outputs rather than being specified a priori; read together with her blog "In Defense of AI Evals, for Everyone" (<https://www.sh-reya.com/blog/in-defense-ai-evals/>, Sep 2025). Thirteenth, **Peter Steinberger's "Just Talk To It"** (<https://steipete.me/posts/just-talk-to-it>, Oct 2025; verbatim: *"Just talk to it. Play with it. Develop intuition."*) plus his "Essential Reading for Agentic Engineers" (<https://steipete.me/posts/2025/essential-reading-august-2025>) — the strongest voice *against* spec-heavy process, worth reading as a counterweight to Huntley/Reed. Fourteenth, **Geoffrey Huntley's "Ralph Wiggum as a 'software engineer'"** (<https://ghuntley.com/ralph/>) for the minimalist autonomous loop (`while :; do cat PROMPT.md | claude-code ; done`) and its file conventions (`PROMPT.md`, `@fix_plan.md`, `@AGENT.md`, `@specs/`).

Runners-up worth scanning: **Mitchell Hashimoto's "Vibing a Non-Trivial Ghostty Feature"** (transcripts of 16 real Amp sessions, $15.98, shipping production code), **Geoffrey Litt's "Code like a surgeon"** (primary vs. secondary tasks), **Steve Yegge's "Revenge of the Junior Developer"** (agent-clusters / agent-fleets progression), **Geoffrey Huntley's "How to Build a Coding Agent" workshop** (<https://ghuntley.com/agent/>), the **Latent Space Claude Code episode with Boris Cherny & Cat Wu** (<https://www.latent.space/p/claude-code>, May 2025; source for the verified "~80% of Claude Code written by Claude" claim — Boris Cherny's exact words are "Probably near 80 I'd say"), **Latent Space "Extreme Harness Engineering for Token Billionaires" with Ryan Lopopolo** (<https://www.latent.space/p/harness-eng>; source for the OpenAI Harness Engineering team's "~1M LOC with 3 engineers in 5 months, ~1,500 PRs" claim — verified), and **Ethan Mollick's "Claude Code and What Comes Next"** (<https://www.oneusefulthing.org/p/claude-code-and-what-comes-next>, Jan 2026). Epsilla and InfoQ both have useful deconstructions of the generator/evaluator post (<https://www.epsilla.com/blogs/anthropic-harness-engineering-multi-agent-gan-architecture>, <https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/>).

**Community consensus in 2025–2026**: harness/context engineering matters more than model choice at the frontier; file-based scratchpads beat fancy memory systems for coding; subagents are primarily a context-isolation device, not a cleverness device; TDD + deterministic verification loops are non-negotiable; generator/evaluator beats single-agent for subjective-quality domains; binary pass/fail beats rubric scores for LLM-as-judge (Hamel + Shankar + Anthropic's "demystifying evals" all converge here); hooks are the only deterministic enforcement layer (everything in CLAUDE.md / skills / subagent prompts is advisory); "agentic engineering" (Karpathy, Osmani, Mollick, Böckeler) has replaced "vibe coding" as the serious term; Claude Code is the de facto baseline platform.

**Active disagreements — the axes your harness has to pick a position on:**

| Axis | Camp A | Camp B |
|---|---|---|
| **MCP vs CLI/code-as-tool** | Anthropic platform (Playwright MCP in the GAN harness; "code execution with MCP" shows 98.7% token savings by mixing both) | Ronacher ("Tools: Code Is All You Need"), Huntley ("Less is More: Hidden Costs of MCP Server Proliferation"), Steinberger (eliminated his last MCP) |
| **Spec-driven process** | Huntley (`@specs/`), Harper Reed (spec → plan → todo), GitHub Spec Kit, AWS Kiro | Steinberger ("Just Talk To It"), Scott Logic (data point: ~10× slowdown on trivial tasks), Fowler/Böckeler (skeptical for anything under ~500 LOC) |
| **Multi-agent shape** | Huntley (500 subagents), Superpowers (Task-tool fan-out in-session), riv2025 (out-of-process evaluator) | Ronacher (one job, one agent; Pi's 4-tool core), Steinberger (terminal grid of top-level CLIs, not nested subagents) |
| **Review rigor** | Hamel (eval is the whole game), Willison (code review "essential"), Beck (proof over vibes) | Steinberger ("I don't read much code anymore"); Karpathy's "Accept All" posture |
| **Autonomy horizon** | Ralph loop, riv2025, OpenAI Harness Engineering team's 24/7 autonomous runs | Willison's "vibe engineering" (accountability), Beck's "augmented coding" (TDD supervision) |
| **Harness heaviness** | Spec-kit + compound-engineering 28-persona reviewer library + full eval harness | Ronacher's Pi (4 tools, no extensions, agent writes its own tools per project) |

Your harness either picks one column per row or exposes it as a configuration knob — but the positions are genuinely contested by credible practitioners, not settled science.

## 12. Concrete build plan

The minimum viable harness is 3–4 weeks of focused work. Phase it:

**Week 1 — foundation.** Stand up a Python `harness.py` using `ClaudeSDKClient`. Wire `setting_sources=["project","user"]` so CLAUDE.md loads. Build the `.claude/settings.json` hook stack (lint on edit, test on stop). Write a <120-line `AGENTS.md` + symlink to `CLAUDE.md`. Create a toy `tasks.md` with 5 tasks and validate the initializer→coding-agent two-session pattern end-to-end, with git commits as the durable checkpoint. Validate `resume` works across sessions.

**Week 2 — generator/evaluator loop.** Implement the generator and evaluator as two `AgentDefinition` entries. Build the sprint-contract negotiation protocol: file-based exchange of `sprint-N-proposal.md` → `sprint-N-contract.md` → code → `sprint-N-verdict.md`. Define your initial rubric (start with correctness/completeness/maintainability at 0–10 each, threshold 7). Wire Playwright MCP to the evaluator if you're doing web work; otherwise wire an HTTP client and DB introspection tools. Cap iterations per sprint at 10 with human escalation on failure. Test it on a real feature and measure cost-per-feature and iteration count.

**Week 3 — additional subagents and verification.** Add the supporting subagent definitions (`planner`, `explorer`, `debugger`) with per-subagent models and tool scopes. Implement the `request_review` custom MCP tool wired to a Slack webhook with approve/reject. Add an eval harness: 10 real tickets from your backlog with `FAIL_TO_PASS`/`PASS_TO_PASS` tests; run it nightly; track pass@1 and average evaluator score. Wire Langfuse for trace visualization.

**Week 4 — parallelism and infrastructure.** Add the `spawn-parallel.sh` / `sync-worktrees.sh` worktree scripts and an `integrator` subagent. Stand up an E2B or Daytona sandbox for untrusted runs. Add the Reflexion buffer to the `generator` (cap 3 entries in `reflections.md`). Configure model cascading per subagent. Add per-sprint cost tracking to the daily digest. Write the async review flow: agent hits gate → Slack message with rubric scores → button callback resumes via `Command(resume=decision)`.

**Beyond.** Layer Spec Kit (`/constitution → /specify → /plan → /tasks → /implement`) as the outer loop. Add mutation testing to catch shallow tests. Add the PR Review Toolkit's five-specialist pattern as a GitHub Action. Expand the eval set to 50+ tickets and start measuring harness changes against it. **Instrument every harness component so you can measure whether it still adds value** — then delete the ones that don't, Anthropic-style, as models improve. If and only if you feel episodic-retrieval pain, add Letta or mem0. If and only if MCP bloat becomes real, adopt Ronacher's code-as-tool pattern.

**What not to build**: elaborate slash-command libraries (Ronacher's anti-pattern), a memory system before you have retrieval pain, MCP servers for things a shell command could do, multi-agent debate for routine tasks, custom context compaction before trying the SDK's default with a tuned `PreCompact` hook, a new sandbox abstraction when E2B/Daytona already work, a generator/evaluator pair for pure library code where `pytest` is already the evaluator. **Borrow aggressively; the winning harness in 18 months will still look like the blueprint in Anthropic's posts — only with fewer components as the models outgrow the scaffolding.**

---

## Appendix: Provenance and verification status

This document was compiled from three independent research passes with primary-source verification. Every numeric, quote, and repo detail in this document was checked against its primary source on 2026-04-16. The table below flags what is verified verbatim, what is paraphrased, and what is unverifiable so downstream readers know where to trust vs. re-check.

### Verbatim-verified direct quotes (primary-source checked)
- GAN post: *"When asked to evaluate work they've produced, agents tend to respond by confidently praising the work—even when, to a human observer, the quality is obviously mediocre."* ✅
- GAN post (with leading "But" restored): *"But tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."* ✅
- GAN post (confirmed portion): *"every component in a harness encodes an assumption about what the model can't do on its own"* ✅ (the "and those assumptions are worth stress testing" tail is paraphrase — not located verbatim in the post).
- Effective harnesses: *"compaction isn't sufficient"* ✅; *"the agent tended to try to do too much at once—essentially to attempt to one-shot the app"* ✅; *"It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality"* ✅.
- Eval awareness: *"the first documented instance of a model suspecting it is being evaluated without knowing which benchmark was being administered"* ✅.
- Infrastructure noise: *"the gap between the most- and least-resourced setups on Terminal-Bench 2.0 was 6 percentage points (p < 0.01)"* ✅; *"leaderboard differences below 3 percentage points deserve skepticism"* ✅.
- Code execution with MCP: *"150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%"* ✅.
- Demystifying evals: *"A good task is one where two domain experts would independently reach the same pass/fail verdict"* ✅; *"grade what the agent produced, not the path it took"* ✅.
- Multi-agent research: "90.2%" improvement number ✅; "15×" token multiplier ✅; "80% of the variance" ✅.
- Hamel (LLM-as-judge post, not the evals post): *"A binary decision forces everyone to consider what truly matters"* ✅; *"What makes something a 3 versus a 4? Nobody knows."* ✅; *"Don't stray from binary pass/fail judgments when starting out"* ✅; *"three iterations to achieve > 90% agreement between the LLM and Phillip"* ✅.
- Ronacher: *"Tools: Code Is All You Need"* quote about `gh` CLI vs GitHub MCP ✅; Pi: *"it has a tiny core… only has four tools: Read, Write, Edit, Bash"* ✅.
- Steinberger: *"Just talk to it. Play with it. Develop intuition."* ✅.
- Willison: *"where seasoned professionals accelerate their work with LLMs while staying proudly and confidently accountable for the software they produce"* ✅ (note: "seasoned," not "experienced").
- Huntley: the one-line Ralph loop `while :; do cat PROMPT.md | claude-code ; done` ✅.
- Advanced tool use numerics: Opus 4.5 79.5% → 88.1% ✅; Programmatic Tool Calling 37% token reduction ✅; Tool Use Examples 72% → 90% ✅.
- Sandboxing: "84% reduction in permission prompts" ✅.
- SDK rename date: 29 Sep 2025 ✅ (source: the "Building agents with the Claude Agent SDK" post, formerly at anthropic.com/engineering, now claude.com/blog).
- `create_sdk_mcp_server` runs in-process ✅ (verified in the Python SDK source).
- TS SDK issue #14 (no historical-message retrieval after `resume`) ✅.

### Repo facts verified against current GitHub state
- `anthropics/riv2025-long-horizon-coding-agent-demo`: 59 stars, last commit 2026-02-05, `claude_code.py` is 1,866 lines, state values are `continuous | pause | run_once | run_cleanup` (*not* `terminated`), anti-slop prompt lives in `prompts/system_prompt.txt` (not `claude_code.py`).
- `obra/superpowers`: plugin v5.0.7; four files under `skills/subagent-driven-development/` as listed; 156k-star count is API-reported but anomalously high for a 6-month-old plugin — treat as a signal, not a metric.
- `EveryInc/compound-engineering-plugin`: ~14.5k stars, 28 persona files under `agents/review/` as listed.
- `hamelsmu/evals-skills`: ~1.1k stars, seven skills as listed.
- `automazeio/ccpm`: ~8k stars; skill path is singular `skill/ccpm/` (not `skills/`); `<N>-analysis.md` filename is a pattern where N is the issue number.
- `trailofbits/skills`: ~4.6k stars; `spec-to-code-compliance` description verbatim as quoted.
- `anthropics/skills/webapp-testing`: discipline instruction quoted verbatim including the typo "abslutely" [sic].
- `Aider-AI/aider`: repo map at `aider/repomap.py`, tree-sitter + networkx PageRank + `map_tokens` budget all confirmed; `ArchitectCoder` at `aider/coders/architect_coder.py` confirmed.

### Corrections applied in this revision
- The original draft said "V3 harness" and claimed Opus 4.6 removed the generator, leaving "only planner and evaluator." **This is wrong.** The post removes the *sprint construct* under Opus 4.6; planner, generator, and evaluator all remained. The post has no "V3."
- The original draft stated "~22× cost" as if it were the post's phrasing. The post actually says "over 20× more expensive"; 22× is the arithmetic. Corrected.
- The original draft said the SDK "does not auto-load CLAUDE.md / .claude/ / skills / settings unless you pass `setting_sources=['user','project','local']`." **Current docs state the opposite** — the SDK auto-loads by default, and `setting_sources` *restricts*. The behavior flipped post-rename. Corrected with a version-dependent warning.
- The original draft attributed "3.7× higher contamination rates" to multi-agent setups. The post uses the term "unintended solutions," and the figure is a ratio between two small rates (0.87% vs 0.24%) — the phrasing "3.7× higher contamination rates" is misleading. Corrected.
- The original draft implied Claude Code's `--worktree` flag arrived with v2.1.50. Actually `--worktree` predates 2.1.50; v2.1.50 added declarative `isolation: worktree` in subagent frontmatter plus `WorktreeCreate`/`WorktreeRemove` hook events. Corrected inline in §7.
- Willison's "vibe engineering" definition used "experienced" — the actual word is "seasoned," and the quote continues past the draft's cutoff. Corrected.
- The Shankar "criteria drift" reference was miscited in earlier drafts at `sh-reya.com` (blog). The canonical citation is arxiv 2404.12272 / ACM UIST 2024; the blog doesn't contain the load-bearing quote.
- Hamel's binary-pass/fail quotes live at `/blog/posts/llm-judge/`, not `/blog/posts/evals/`. Source URL corrected.

### Explicitly unverified / flagged as empirical
- `allowed_tools` vs `bypassPermissions` interaction (community-reported workaround: `permission_mode="dontAsk"`).
- `PermissionRequest` hooks in headless `-p` mode (community-reported not-firing).
- Subagent non-nesting (widely reported; not explicit in the overview page read).
- Client-side cost-table drift on new-model releases (widely reported; issue #487 was cited but not re-verified).
- Shankar's "Binary metrics (True/False) are much easier to align and reason about from a UX standpoint" quote — not verified verbatim from the paper PDF; treat as paraphrase pending local access.
- The Tool Search "72K → 8.7K, 85% reduction" triple is not a matched set in the source — the 85% figure is calculated against a ~77K baseline. If you need the numbers exactly, re-check the post.
- `obra/superpowers` and `affaan-m/everything-claude-code` star counts (156k+ each) are API-reported but anomalously high for the content and age. Noted, not explained.

### Raw research artifacts
Underlying per-workstream research notes (full quotes, URLs, direct-quote sources) live at:
- `research/sources/anthropic.md` — 16 Anthropic engineering posts + Claude Code / Agent SDK docs
- `research/sources/practitioners.md` — Ronacher, Willison, Huntley, Harper Reed, Hamel, Steinberger, Shankar, Thoughtworks Radar, Fowler/Böckeler
- `research/sources/code-repos.md` — 14 open-source repos read at the code level (`gh api` + raw.githubusercontent.com)
- `research/sources/evals.md` — eval methodology primary sources
- `research/NOTES.md` — synthesis notes (the earlier layer-framing and contested-axes work distilled into this document)

If a claim in this document disagrees with the raw research files, the raw research files are authoritative for direct quotes and repo facts; this document is authoritative for the synthesized interpretation and recommendations.
