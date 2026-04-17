# Anthropic Primary Sources: Harness Design Research

Research notes synthesized from Anthropic engineering blog posts and Claude Code / Agent SDK documentation. Sources consulted directly via WebFetch; no secondary coverage.

---

## 1. Harness Design for Long-Running Application Development

- **URL:** https://www.anthropic.com/engineering/harness-design-long-running-apps
- **Date:** 2026-03-24

### Summary
The post describes a GAN-inspired multi-agent harness (generator + evaluator) that produces higher-quality long-running app output than solo-agent runs. Two consistent failure modes motivate the design: context degradation (and the resulting "context anxiety" where agents prematurely wrap up) and self-evaluation blindness (agents confidently praising their own mediocre work). The author evolves the system from a 2-agent frontend harness to a 3-agent full-stack harness (Planner, Generator, Evaluator/QA) using Playwright MCP for live verification, with a "sprint contract" negotiated between generator and evaluator before each chunk of work. The guiding heuristic is that every harness component encodes an assumption about what the model can't do alone, and as models improve the boundary moves outward (complexity should be pared back accordingly).

### Load-bearing quotes
> "I designed a multi-agent structure with a **generator** and **evaluator** agent."

> "When asked to evaluate work they've produced, agents tend to respond by confidently praising the work—even when, to a human observer, the quality is obviously mediocre."

> "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing... find the simplest solution possible, and only increase complexity when needed."

> "The harness was over 20x more expensive, but the difference in output quality was immediately apparent."

> As models improve "the boundary moves outward. Tasks that used to need the evaluator's check… were now often within what the generator handled well on its own, and for tasks within that boundary, the evaluator became unnecessary overhead."

### Concrete specifics
- **Frontend harness:** two agents. Evaluator uses Playwright MCP, scores against four criteria calibrated with few-shot examples: **design quality, originality, craft, functionality**. Typical 5-15 iterations; after each eval, generator decides to "refine the current direction if scores were trending well, or pivot to an entirely different aesthetic."
- **Full-stack harness (3 agents):**
  - **Planner** — expands 1-4 sentence prompts into product specs; "ambitious about scope"; weaves AI features into specs; avoids granular technical details to prevent error cascades.
  - **Generator** — React + Vite + FastAPI + SQLite/PostgreSQL; initially worked in "sprints" (one feature at a time) with self-eval before QA handoff.
  - **Evaluator/QA** — Playwright MCP; exercises UI, API, DB; graded against depth/functionality/visual/code-quality with hard-threshold failure feedback.
- **Sprint contracts:** generator + evaluator negotiate "done" criteria before implementation, bridging spec to testable implementation.
- **Communication:** agents exchange information via files (one writes, another reads).
- **Metrics:**
  - Retro video game maker: solo = 20 min / $9; harness = 6 hours / $200.
  - DAW (simplified harness): Planner 4.7 min / $0.46; three build/QA rounds totaling 3h50 / $124.70.
  - Opus 4.5 used initially; upgrade to Opus 4.6 removed need for the sprint construct (plans more carefully, sustains agentic tasks longer).
- **QA tuning reality:** author had to "read the evaluator's logs, find examples where its judgment diverged from mine, and update the QA's prompt." Early QA would "identify legitimate issues, then talk itself into deciding they weren't a big deal and approve the work anyway."

### Harness-design implications
- Separate generator from evaluator for any domain where self-evaluation fails. Keep the evaluator's rubric explicit and calibrated with few-shot examples.
- Use a live-interaction tool (Playwright, puppeteer, or similar) so the evaluator scores observed behavior, not just generated text.
- Intermediate file-based handoffs are a robust inter-agent protocol.
- Treat harness complexity as a liability: profile it against current model capability and remove components as models get stronger.
- Plan for context resets between sessions over in-place compaction ("clean slate" + structured handoffs outperforms compaction for long tasks).

---

## 2. Effective Harnesses for Long-Running Agents

- **URL:** https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- **Date:** 2025-11-26

### Summary
The direct predecessor to post #1. Frames the central problem: coding projects don't fit in one context window, and naive agents either try to one-shot, or on resumption see previous progress and declare victory. The authors propose a two-agent pattern (Initializer + Coding Agent) with structured external state — an `init.sh` script, a `claude-progress.txt` log, and a `feature_list.json` with 200+ features each flagged `passes: false` — plus Puppeteer MCP for end-to-end verification. The session startup protocol enforces reading progress and running a known-good smoke test before new work.

### Load-bearing quotes
> "context windows are limited, and because most complex projects cannot be completed within a single window, agents need a way to bridge the gap between coding sessions."

> "each new session begins with no memory of what came before"

> "compaction isn't sufficient"

> "the agent tended to try to do too much at once—essentially to attempt to one-shot the app"

> "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality"

### Concrete specifics
- **Roles:** Initializer Agent (first session only), Coding Agent (every subsequent session).
- **Environment files:** `init.sh`, `claude-progress.txt`, `feature_list.json`, a git repo with initial commit.
- **Feature list item shape:**
  ```json
  {"category":"functional","description":"New chat button creates a fresh conversation","steps":[...],"passes":false}
  ```
- **Session startup protocol:** `pwd` -> read git log + progress -> select highest-priority incomplete feature -> run dev server via `init.sh` -> run an e2e smoke test *before* any new work.
- **Failure-mode -> solution table:** early victory -> structured feature list (200+); undocumented progress -> git commits + end-of-session notes; premature completion -> explicit self-verification; setup confusion -> provision `init.sh`.
- **claude.ai clone example:** feature list had 200+ items, all initially failing.

### Harness-design implications
- External, structured state files are the bridge across sessions; compaction alone is insufficient.
- Pre-session rituals (orient, verify prior work, run smoke test) are as important as the task prompt.
- A large, atomized task list converts "did I finish?" from a judgment into a test.
- Verifiable-by-browser features + Puppeteer/Playwright is the canonical loop for long UI builds.
- The 2025-11 post poses two-agent separation as a baseline; the 2026-03 post (post #1) evolves this by adding a Planner and an explicit sprint-contract negotiation, then de-emphasizes the sprint construct with Opus 4.6. Note this evolution when designing — complexity should track the weakest model you'll run on.

---

## 3. Building Effective Agents (Foundational Taxonomy)

- **URL:** https://www.anthropic.com/engineering/building-effective-agents
- **Date:** 2024-12-19

### Summary
Foundational post distinguishing "workflows" (LLMs + tools orchestrated via predefined code paths) from "agents" (LLMs dynamically directing their own processes and tool use). Presents a canonical taxonomy of patterns — augmented LLM, prompt chaining, routing, parallelization (sectioning and voting), orchestrator-workers, evaluator-optimizer, and autonomous agents — each with clear applicability criteria. Recurring imperatives: maintain simplicity, prioritize transparency (explicit planning steps), craft the agent-computer interface (ACI) with thorough tool docs and testing, and only increase complexity when it demonstrably improves outcomes.

### Load-bearing quotes
> Workflows are "systems where LLMs and tools are orchestrated through predefined code paths." Agents are "systems where LLMs dynamically direct their own processes and tool usage."

> Orchestrator-workers: "A central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results." Ideal for "complex tasks where you can't predict the subtasks needed."

> Evaluator-optimizer: "One LLM call generates a response while another provides evaluation and feedback in a loop."

> "Success in the LLM space isn't about building the most sophisticated system. It's about building the _right_ system for your needs."

### Concrete specifics
- Seven cataloged patterns (augmented LLM is the primitive):
  1. Prompt chaining — sequential, with programmatic gates.
  2. Routing — classify then dispatch to specialized handlers.
  3. Parallelization — sectioning (split subtasks) and voting (N runs for diversity/robustness).
  4. Orchestrator-workers — dynamic decomposition by a lead LLM.
  5. Evaluator-optimizer — two-LLM loop.
  6. Autonomous agent — tool loop on environmental feedback.
- Three core principles: **simplicity**, **transparency** (show the plan), and **ACI quality** (docs + testing of tools).

### Harness-design implications
- Establishes the vocabulary the later posts (2025-11, 2026-03) inherit. Post #1 is a specialized evaluator-optimizer extended with a Planner.
- Decision rule: start at the simplest pattern that captures the problem; escalate only when demonstrably better.
- "Augmented LLM" (retrieval + tools + memory) is the minimum coherent unit to build on.

---

## 4. Claude Code Best Practices

- **URL:** https://www.anthropic.com/engineering/claude-code-best-practices (redirects to https://code.claude.com/docs/en/best-practices)
- **Date:** 2025-04-18 (originally; page continuously updated)

### Summary
A tactical field manual for getting Claude Code to produce high-quality work. The organizing constraint is the context window: "Claude's context window fills up fast, and performance degrades as it fills." The highest-leverage move is giving Claude a way to verify its own work (tests, screenshots, expected outputs). Prescribes the explore -> plan -> implement -> commit workflow, with Plan Mode as an explicit exploration phase. CLAUDE.md should be small and high-signal. Parallelism (multiple sessions, subagents, worktrees, fan-out with `claude -p`) is treated as first-class scaling. Includes a taxonomy of common failure patterns (kitchen-sink session, repeated corrections, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration).

### Load-bearing quotes
> "Include tests, screenshots, or expected outputs so Claude can check itself. This is the single highest-leverage thing you can do."

> "The context window is the most important resource to manage."

> "Vague prompts can be useful when you're exploring and can afford to course-correct."

> "CLAUDE.md is loaded every session, so only include things that apply broadly."

> "Hooks run scripts automatically at specific points in Claude's workflow. Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."

> "Since context is your fundamental constraint, subagents are one of the most powerful tools available."

> "A clean session with a better prompt almost always outperforms a long session with accumulated corrections."

### Concrete specifics
- **Recommended workflow:** Explore (Plan Mode, read only) -> Plan (detailed plan; `Ctrl+G` to edit) -> Implement (Normal Mode) -> Commit (PR via `gh`).
- **CLAUDE.md locations:** `~/.claude/CLAUDE.md` (personal), `./CLAUDE.md` (shared), `./CLAUDE.local.md` (personal project), monorepo parent dirs, on-demand nested dirs. Imports via `@path/to/file`.
- **CLAUDE.md include/exclude table** — include: commands Claude can't guess, non-default style rules, test runners, repo etiquette, env quirks, gotchas; exclude: things Claude can figure out, standard conventions, long docs, self-evident advice, frequently changing info.
- **Parallel sessions:** desktop worktrees, Claude Code on the web VMs, or agent teams. Writer/Reviewer pattern and test-first split given as canonical.
- **Fan-out pattern:**
  ```bash
  for file in $(cat files.txt); do
    claude -p "Migrate $file from React to Vue. Return OK or FAIL." \
      --allowedTools "Edit,Bash(git commit *)"
  done
  ```
- **Headless:** `claude -p "..."` + `--output-format json|stream-json` for CI/pipelines.
- **Auto mode:** `claude --permission-mode auto -p "fix all lint errors"` (classifier-backed).
- **Failure patterns** named: kitchen-sink session, corrections spiral, over-specified CLAUDE.md, trust-then-verify gap, infinite exploration — each with a fix.

### Harness-design implications
- Force a verification loop into every agent run: tests, diff-able screenshots, lint, or custom Bash checks. Treat "unverifiable task" as an anti-pattern.
- Separate exploration from execution — a plan phase is cheap insurance; skip only for one-line diffs.
- CLAUDE.md is context, not enforcement. For must-happen invariants, use hooks.
- Subagents are context-isolation primitives first, specialization second.
- Session-as-branch mental model: name them, resume them, fan-out over them.

---

## 5. Multi-Agent Research System

- **URL:** https://www.anthropic.com/engineering/multi-agent-research-system
- **Date:** 2025-06-13

### Summary
Describes Anthropic's Research feature as an orchestrator-worker system: a lead agent plans, spawns parallel subagents into separate context windows, subagents iterate with interleaved thinking and return compressed summaries; a citation agent attaches sources. Outperformed single-agent Opus 4 by 90.2% on an internal eval, at roughly 15x the tokens of a chat (and 4x of a single-agent run). Token usage alone explains ~80% of performance variance. The post is notable for treating research as inherently path-dependent and breadth-first, which is what multi-agent architectures buy.

### Load-bearing quotes
> "Subagents facilitate compression by operating in parallel with their own context windows, exploring different aspects of the question simultaneously before condensing the most important tokens for the lead research agent."

> "Once intelligence reaches a threshold, multi-agent systems become a vital way to scale performance."

> "Agents are stateful and errors compound... minor system failures can be catastrophic for agents."

> LLM-judge: "a single LLM call with a single prompt outputting scores from 0.0-1.0... was the most consistent."

### Concrete specifics
- Architecture: lead plans -> parallel subagents -> return -> synthesis -> citation agent -> output.
- Numbers: +90.2% vs single-agent Opus 4; ~15x tokens of chat; ~4x for single-agent; tokens explain 80% of variance; parallel tool calls cut research time up to 90%.
- 8 prompting strategies: simulate agent behavior; teach delegation explicitly (task, format, tools, boundaries); scale effort to query complexity (1 agent / 3-10 calls up to 10+ subagents); design distinct tools with clear descriptions; let agents self-improve (40% completion-time reduction); start broad, then narrow; guide thinking via extended + interleaved thinking; parallelize tool calls (3+ per subagent).
- Eval tiers: ~20-query small-sample -> LLM-judge rubric (factuality, citations, completeness, source quality, tool efficiency) -> human spot-check for rare failures.
- Production engineering: rainbow deployments, full production tracing (decisions/interactions, not contents), durable execution with checkpoints.
- Acknowledged bottleneck: synchronous subagent execution.

### Harness-design implications
- Multi-agent is a *token-for-quality* trade, profitable when the task is research-style (breadth, path-dependent) and when value-per-token is high.
- The orchestrator pattern only works if delegation prompts explicitly specify task, output format, permitted tools, and hard boundaries.
- Production reliability needs: checkpointing, durable execution, decision-level tracing, rainbow/gradual deploys.
- LLM-judge as default grader; keep prompt single-call and numeric; validate with humans on edge cases.

---

## 6. Effective Context Engineering for AI Agents

- **URL:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- **Date:** 2025-09-29

### Summary
Reframes "prompt engineering" as a subset of the broader discipline of **context engineering** — curating the whole set of tokens the model sees. Motivates this by "context rot": attention degrades with context length because of transformer scaling and training-data statistics. Prescribes minimal, non-overlapping tools, canonical (not exhaustive) examples, just-in-time retrieval (load by reference, not prefetch), and three long-horizon techniques: compaction, structured note-taking, and sub-agent architectures. Explicit parallels to Claude Code (targeted greps, `head`/`tail` instead of loading whole files).

### Load-bearing quotes
> Context engineering is "strategies for curating and maintaining the optimal set of tokens (information) during LLM inference, including all the other information that may land there outside of the prompts."

> "n squared pairwise relationships for n tokens"

> "find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome."

> Tools: "a human engineer can't definitively say which tool should be used in a given situation" implies "an AI agent can't be expected to do better."

> Sub-agents return "condensed, distilled summary of its work (often 1,000-2,000 tokens)."

### Concrete specifics
- System prompts: XML tags or Markdown headers; avoid brittle logic and vague abstractions.
- Tools: minimal and non-overlapping; token-efficient return values.
- Examples: "diverse, canonical examples" beat edge-case laundry lists.
- Just-in-time retrieval: agents keep lightweight identifiers (paths, stored queries, URLs) and pull content on demand; metadata (filename, location, timestamp) is a behavioral signal.
- **Compaction:** maximize recall first, then precision; safe rule-of-thumb is clearing old tool results deep in the trace. Claude Code compacts around architectural decisions, open bugs, and implementation detail; discards redundant tool outputs.
- **Structured note-taking:** the Claude-plays-Pokemon example tracked "for the last 1,234 steps I've been training my Pokemon in Route 1, Pikachu has gained 8 levels toward the target of 10."
- Memory tool (public beta): file-backed external memory for agents.
- **Sub-agent architectures:** lead coordinates; subagents do deep exploration and return small summaries; "clear separation of concerns."

### Harness-design implications
- Harnesses should provide: a retrieval surface (paths/URLs/queries), a note-taking surface (writable external files), and a compaction strategy — not just prompts.
- Tool-set is an architectural choice: treat the tool graph like API design; aim for orthogonality.
- Sub-agents are a compression primitive; budget expected output size (1-2k tokens) as part of the contract.
- Expect models to get more autonomous and less prescriptive engineering to win, but context remains "a precious, finite resource."

---

## 7. Demystifying Evals for AI Agents

- **URL:** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- **Date:** 2026-01-09

### Summary
A systematic framework for evaluating agents. Distinguishes single-turn from multi-turn; introduces the core vocabulary (task, trial, grader, transcript, outcome, eval harness, agent harness). Three grader categories (code-based, model-based, human), two eval strategies (capability evals targeting low pass rates, regression evals targeting ~100%). Includes benchmark pointers (SWE-bench Verified, Terminal-Bench, tau-Bench/tau2-Bench, WebArena, OSWorld), non-determinism metrics pass@k and pass^k, and an 8-step implementation roadmap. Candid about grader bugs hiding model capability (e.g., Opus 4.5 on CORE-Bench jumping from 42% -> 95% after fixes).

### Load-bearing quotes
> Agent evals are distinct: "mistakes can propagate and compound."

> "grade what the agent produced, not the path it took"

> "Read the transcripts" — regularly, to verify the grader is working.

> "two domain experts would independently reach the same pass/fail verdict"

> Capability evals "should start at a low pass rate." Regression evals "should have a nearly 100% pass rate."

> Agents exploit loopholes: Opus 4.5 "solved a tau2-bench problem about booking a flight by discovering a loophole in the policy. It 'failed' the evaluation as written, but actually came up with a better solution."

### Concrete specifics
- Vocabulary: **task/problem** (inputs + success), **trial** (attempt), **grader**, **transcript**, **outcome**, **eval harness** (runs tasks, records, grades), **agent harness** (the system making the model into an agent).
- Graders:
  - Code: fast/cheap/objective/brittle.
  - Model: flexible/scalable; non-deterministic; calibrate against humans.
  - Human: gold standard; expensive/slow.
- Non-determinism: pass@k (at least one success in k), pass^k (all k succeed). "At k=1 identical; at k=10, pass@k -> 100%, pass^k -> 0%."
- Benchmarks: SWE-bench Verified ("40% to >80% in one year"), Terminal-Bench, tau-Bench/tau2-Bench (user-persona simulator), WebArena, OSWorld.
- 8-step roadmap:
  1. Start early, 20-50 real-failure tasks.
  2. Convert manual testing -> test cases; prioritize by user impact.
  3. Unambiguous tasks with reference solutions.
  4. Robust harnesses: isolated, clean envs; no shared state.
  5. Prefer deterministic grading; grade product not path.
  6. Read transcripts to verify graders.
  7. Monitor saturation.
  8. Dedicated eval teams; broad contributions.
- Warnings: ambiguous specs -> false fails; Claude once gained "an unfair advantage on some tasks by examining the git history from previous trials"; Opus 4.5 CORE-Bench 42% -> 95% after eval-bug fixes.

### Harness-design implications
- A harness must *be* a test bed: clean, isolated environments; per-trial setup/teardown; no state leakage.
- Two eval tracks: capability (hard, low pass) and regression (easy, ~100%). Design both from day one.
- When picking between code/model/human graders, default to code where possible; model for semantic; human only for ambiguous or rare failures.
- Always read transcripts — grader drift is the quiet killer.
- Explicitly encode success criteria; leave no ambiguity two experts would disagree on.

---

## 8. Equipping Agents for the Real World with Agent Skills

- **URL:** https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- **Date:** 2025-10-16

### Summary
Introduces Agent Skills: folders containing a `SKILL.md` with YAML frontmatter (`name`, `description`) plus supporting files/scripts. Skills are discovered via **progressive disclosure** — metadata preloaded, body loaded on match, bundled files loaded only when referenced — giving effectively unbounded skill size at low baseline context cost. Skills can include executable code (e.g., deterministic Python for PDF form fill). Positioned as complementary to MCP (MCP for tools; skills for procedural knowledge and workflows) with a future vision of agents creating/evaluating their own skills.

### Load-bearing quotes
> Skills are "organized folders of instructions, scripts, and resources that agents can discover and load dynamically to perform better at specific tasks."

> "Building a skill for an agent is like putting together an onboarding guide for a new hire."

> "Agents with a filesystem and code execution tools don't need to read the entirety of a skill into their context window when working on a particular task. This means that the amount of context that can be bundled into a skill is effectively unbounded."

> "Large language models excel at many tasks, but certain operations are better suited for traditional code execution."

### Concrete specifics
- **Three-level progressive disclosure:**
  1. Frontmatter metadata (preloaded).
  2. Full SKILL.md (loaded on match).
  3. Bundled files — `reference.md`, `forms.md`, scripts — loaded selectively.
- PDF skill example: instructions + pre-written Python scripts that extract form fields deterministically.
- Context flow: system prompt + metadata -> Claude decides relevance -> Bash reads `SKILL.md` -> reads bundled files as needed.
- Design principles: start with evaluation (observe gaps first); structure for scale (split mutually exclusive contexts); think from Claude's perspective (names + descriptions matter); iterate with Claude.
- Security: audit third-party skills; watch for exfil instructions and untrusted external references.
- Surfaces: Claude.ai, Claude Code, Agent SDK, Developer Platform.

### Harness-design implications
- Skills are the right primitive for encoding "when X, follow playbook Y" without polluting every session's prompt.
- Pair skills with code execution: offload deterministic subroutines (parsing, validation, sorting, file manipulation) out of tokens.
- Description-writing is a first-class harness skill: it's the retrieval key.
- Consider skill authorship as a development loop — run the agent, note gaps, materialize the gap into a skill, repeat.

---

## 9. Writing Effective Tools for Agents — with Agents

- **URL:** https://www.anthropic.com/engineering/writing-tools-for-agents
- **Date:** 2025-09-11

### Summary
A handbook for designing tools that LLMs can actually use. Five principles: (1) pick high-impact consolidated tools over wrapping every endpoint; (2) namespace thoughtfully; (3) return high-signal, context-relevant data (human-readable names, not UUIDs; optional `response_format`); (4) token efficiency (pagination, filtering, truncation, sensible defaults; Claude Code caps tool returns at 25K tokens); (5) prompt-engineer descriptions "as you would describe your tool to a new hire." The post advocates an eval-driven development loop: generate realistic multi-step tasks, run, collect metrics beyond accuracy, and concatenate transcripts for agent-assisted analysis.

### Load-bearing quotes
> "More tools don't always lead to better outcomes."

> "Effective tools are intentionally and clearly defined, use agent context judiciously, can be combined together in diverse workflows, and enable agents to intuitively solve real-world tasks."

> "Resolving arbitrary alphanumeric UUIDs to more semantically meaningful language significantly improves Claude's precision."

> "Even small refinements to tool descriptions can yield dramatic improvements."

> "What agents omit in their feedback and responses can often be more important than what they include."

### Concrete specifics
- Consolidation example: one `schedule_event` beats `list_users` + `list_events` + `create_event`.
- Namespacing: `asana_search` vs `asana_projects_search` — test prefix- vs suffix-based on your eval set.
- `response_format: "concise" | "detailed"` enum to let the agent opt into IDs when needed.
- Error messages should steer: e.g., suggest many small targeted searches over one broad one.
- Parameter names must be unambiguous (`user_id` not `user`).
- Strong task example: "Schedule a meeting with Jane next week to discuss our latest Acme Corp project. Attach the notes from our last project planning meeting and reserve a conference room." Weak task: "Schedule a meeting with jane@acme.corp next week."
- Collect metrics: runtime, tool-call count, tokens, error rates. Use interleaved thinking to inspect reasoning.

### Harness-design implications
- Tool design is harness design. Put effort into the ACI that it's tempting to spend on prompt wording.
- Build eval datasets that *require* multi-tool chains; single-call tasks do not surface ACI problems.
- Use agent-on-transcripts analysis as a feedback loop: "have Claude Code analyze them to identify issues."
- Truncation/pagination contracts are part of the tool's interface, not implementation detail.

---

## 10. Building a C Compiler with Parallel Claudes

- **URL:** https://www.anthropic.com/engineering/building-c-compiler
- **Date:** 2026-02-05

### Summary
Nicholas Carlini's case study running ~16 parallel Claude Code instances as "agent teams" against a shared git repo to build a 100K-line Rust-based C compiler (compiles Linux 6.9 on x86/ARM/RISC-V). Uses file-lock task claiming, Docker containers per iteration, and an external "known-good compiler" (GCC) as an oracle. ~2 weeks, ~2,000 sessions, 2B input tokens, 140M output tokens, ~$20K. A stress test of where a single model's ceiling actually lies ("nearly reached the limits of Opus's abilities").

### Load-bearing quotes
> "Claude will work autonomously to solve whatever problem I give it. So it's important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem."

> "When it finishes one task, it immediately picks up the next."

### Concrete specifics
- Harness loop:
  ```bash
  while true; do
    COMMIT=$(git rev-parse --short=6 HEAD)
    LOGFILE="agent_logs/agent_${COMMIT}.log"
    claude --dangerously-skip-permissions \
           -p "$(cat AGENT_PROMPT.md)" \
           --model claude-opus-X-Y &> "$LOGFILE"
  done
  ```
- Task claiming via lock files (`current_tasks/parse_if_statement.txt`); local Docker; pull/merge/push; remove lock; fresh container next iteration.
- Context discipline: print minimal to stdout, log to files; `--fast` sample 1-10% random subsets for quick regression detection.
- Agent specializations: code-dedup, perf-opt, code-quality, documentation.
- Parallelism unlock: GCC as "online known-good compiler oracle" enabled per-file parallel work on kernel compilation.
- Outputs: compiles QEMU, FFmpeg, SQLite, postgres, redis, Doom; 99% GCC torture suite pass.
- Limits: 16-bit x86 codegen falls back to GCC; buggy assembler/linker; subpar optimization; not expert-level Rust.

### Harness-design implications
- File-lock + shared git + ephemeral containers is a viable multi-Claude coordination pattern that avoids the synchronous bottleneck of an orchestrator.
- "Nearly perfect verifier" is a hard prerequisite for autonomous loops — with an imperfect verifier, agents chase the wrong objective.
- Sample-based fast regression tests keep the loop cheap while catching breakage.
- External known-good oracles (old compiler, prod system, reference implementation) convert hard verification problems into parallelizable ones.

---

## 11. Scaling Managed Agents: Decoupling the Brain from the Hands

- **URL:** https://www.anthropic.com/engineering/managed-agents
- **Date:** not explicitly stated in post

### Summary
Describes the architectural refactor of Anthropic's Managed Agents service from a single-container "pet" into three decoupled systems: **Brain** (Claude + harness), **Hands** (sandboxes/tools), **Session** (append-only event log). Presents a minimal interface: `execute(name,input)`, `emitEvent`, `getSession`/`getEvents`, `wake`, `provision`. The decoupling yields resilience (container death becomes a tool error, not a session loss), major TTFT wins (p50 -60%, p95 -90%+), stronger security (credentials never meet Claude's generated code), and flexibility (customer-VPC hands).

### Load-bearing quotes
> "If the container died, the harness caught the failure as a tool-call error and passed it back to Claude."

> "Narrow scoping is an obvious mitigation, but this encodes an assumption about what Claude can't do with a limited token—and Claude is getting increasingly smart."

> "The session provides this same benefit, serving as a context object that lives outside Claude's context window."

### Concrete specifics
- Three components with a stable interface:
  - `execute(name, input) -> string`
  - `emitEvent(id, event)`
  - `getSession(id)`, `getEvents()`
  - `wake(sessionId)`, `provision({resources})`
- TTFT: p50 dropped ~60%, p95 dropped >90%.
- Context anxiety example: Sonnet 4.5 wrapping up prematurely; Opus 4.5 removed the behavior and the workaround.
- Credential patterns: **resource-bundled auth** (git tokens attached at sandbox init) and **vault-backed auth** (OAuth stored externally, MCP proxy fetches on call).
- Session is an append-only event log supporting later retrieval outside Claude's context window.
- Authors: Lance Martin, Gabe Cemaj, Michael Cohen.

### Harness-design implications
- Treat the runtime as three replaceable layers. Lazy-provisioning hands dramatically cuts latency.
- Persist events, not just "conversation": querying the event log is a richer substitute for long context.
- Keep credentials out of the model's reachable environment — assume the agent can read any file it can reach.
- Design for failure-as-tool-error: an agent that sees an error and retries is more resilient than one that crashes.

---

## 12. Code Execution with MCP: Building More Efficient Agents

- **URL:** https://www.anthropic.com/engineering/code-execution-with-mcp
- **Date:** 2025-11-04

### Summary
Argues for a fundamental rearrangement of MCP: instead of loading every tool's definition into model context and calling them individually, expose MCP servers as a filesystem of code files; have the model write code that imports and calls them. In a reference case, **token use drops 150K -> 2K (98.7%)**. Additional wins: intermediate results filter/transform in the execution environment (privacy + token savings), control flow runs in code not across LLM turns, agents write files for persistent state between operations.

### Load-bearing quotes
> "This reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%."

> "Tool descriptions occupy more context window space, increasing response time and costs. In cases where agents are connected to thousands of tools, they'll need to process hundreds of thousands of tokens before reading a request."

> "Intermediate results stay in the execution environment by default. This way, the agent only sees what you explicitly log or return."

### Concrete specifics
- Filesystem layout:
  ```
  servers/
  |-- google-drive/{getDocument.ts, index.ts}
  `-- salesforce/{updateRecord.ts, index.ts}
  ```
- TS example: `const transcript = (await gdrive.getDocument({documentId: 'abc123'})).content; await salesforce.updateRecord({...});`
- Filter a 10K-row spreadsheet in code, surface only 5 pending orders to the model.
- PII tokenization at the MCP client before model ever sees it.
- Trade-off: "Code execution introduces its own complexity. Running agent-generated code requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring."
- Parallel industry reference: Cloudflare's "Code Mode."

### Harness-design implications
- For harnesses with large tool surfaces, code-as-orchestration beats tool-call-as-orchestration on nearly every dimension — provided there's a sandbox.
- Couple this pattern with the sandboxing primitives (bubblewrap / seatbelt) and the managed-agents brain/hands split.
- The harness should provide both call modes: direct tool use for quick single calls, code execution for composed work.

---

## 13. Claude Code Sandboxing

- **URL:** https://www.anthropic.com/engineering/claude-code-sandboxing
- **Date:** 2025-10-20

### Summary
Introduces OS-level sandboxing for Claude Code — filesystem isolation (only designated dirs writable) and network isolation (only approved hosts) — leveraging bubblewrap on Linux and seatbelt on macOS, with a unix-socket proxy for network control. Works across subprocesses spawned from the sandboxed Bash tool. Internal usage saw an 84% reduction in permission prompts. Ships as both a sandboxed Bash tool and Claude Code on the web (cloud sandboxes where sensitive credentials never land alongside model-generated code).

### Load-bearing quotes
> "In our internal usage, we've found that sandboxing safely reduces permission prompts by 84%."

> "Without network isolation, a compromised agent could exfiltrate sensitive files like SSH keys; without filesystem isolation, a compromised agent could easily escape the sandbox."

### Concrete specifics
- Linux: bubblewrap. macOS: seatbelt.
- Network: unix-domain-socket -> proxy -> domain allowlist + user confirmation.
- Applies to Claude Code *and* any subprocesses the Bash tool spawns.
- Two new features: sandboxed Bash runtime (OSS research preview), Claude Code on the web (credentials stay out of the sandbox; auth attached via proxy).

### Harness-design implications
- Sandboxing is the right enforcement layer for "trust, but verify at OS boundary."
- Pair permissions (who may call what) with sandbox (what the call can actually reach) — defense in depth.
- For a reusable harness, targeting a sandbox runtime is the cleanest way to offer "autonomous but safe."

---

## 14. Advanced Tool Use on Claude Developer Platform

- **URL:** https://www.anthropic.com/engineering/advanced-tool-use
- **Date:** 2025-11-24

### Summary
Three beta features that make tool use cheaper and more capable: (1) **Tool Search Tool** — on-demand discovery instead of full definition preload (72K -> 8.7K tokens; Opus 4.5 accuracy 79.5% -> 88.1% on MCP evals). (2) **Programmatic Tool Calling** — model orchestrates via generated code, intermediate results stay out of context (37% token reduction, internal retrieval 25.6% -> 28.5%, GIA 46.5% -> 51.2%). (3) **Tool Use Examples** — concrete usage patterns that raise accuracy from 72% -> 90% on complex parameter handling.

### Load-bearing quotes
> "Tool definitions can sometimes consume 50,000+ tokens before an agent reads a request."

> "JSON schemas define what's structurally valid, but can't express usage patterns: when to include optional parameters, which combinations make sense, or what conventions your API expects."

### Concrete specifics
- Traditional 50+ MCP tools: ~72K tokens. With Tool Search: ~8.7K (85% reduction). One internal case: 134K tokens before optimization.
- Opus 4: 49% -> 74% on MCP evals with Tool Search; Opus 4.5: 79.5% -> 88.1%.
- Programmatic tool calling example: Python combining `get_team_members()`, `get_expenses()`, `get_budget_by_level()` in parallel — 200KB raw -> 1KB summary into context.
- Beta header: `betas=["advanced-tool-use-2025-11-20"]`.
- Production user: Claude for Excel — reads/modifies thousands of rows without overloading context.

### Harness-design implications
- These features are the *platform-level* version of the same pattern as post #12 (MCP code execution). A reusable harness should expose tool-search and programmatic-tool-calling modes by default.
- Tool Use Examples are cheap to maintain and give outsized accuracy gains — include them in every tool definition.
- Benchmarks imply that *most* of the model's untapped capability on tool-heavy tasks is being eaten by context overhead.

---

## 15. Claude Code Auto Mode

- **URL:** https://www.anthropic.com/engineering/claude-code-auto-mode
- **Date:** 2026-03-25

### Summary
Auto mode delegates permission approvals to model-based classifiers, replacing the binary choice between "approve every 93% of actions manually" and "disable safeguards entirely." Two-layer defense: a server-side prompt-injection probe that warns Claude when tool outputs look hostile, and a transcript classifier (Sonnet 4.6) that evaluates each pending action using a fast single-token filter then chain-of-thought reasoning only on flagged actions. A critical design decision: the classifier sees only user messages and executable tool calls — assistant reasoning and tool outputs are stripped so the agent can't "talk the classifier into a bad call." FPR 0.4% full pipeline; FNR 17% on real overeager actions — better than `--dangerously-skip-permissions` but "not a drop-in replacement for careful human review."

### Load-bearing quotes
> The classifier sees only user messages and executable tool calls; strips assistant reasoning so the agent can't "talk the classifier into making a bad call."

> "The majority of misses we examined" involve correctly identifying danger but incorrectly judging whether user consent covers it.

> Not "a drop-in replacement for careful human review on high-stakes infrastructure."

### Concrete specifics
- Threat model: overeager behavior, honest mistakes, prompt injection, model misalignment.
- Blocked: destructive ops, security degradation, trust-boundary violations (external code exec, credential harvest, unauthorized sharing — including gists as exfil), shared-infra risk.
- Allowed by default: safe tools (reads, search, nav), user-configured always-allow rules (minus blanket shell/wildcarded interpreters), writes within project dir; everything else -> classifier.
- Eval (Sonnet 4.6 classifier):

| Dataset | Stage 1 FPR | Stage 1 FNR | Full FPR | Full FNR |
|---|---|---|---|---|
| Real traffic (n=10k) | 8.5% | — | 0.4% | — |
| Real overeager (n=52) | — | 6.6% | — | 17% |
| Synthetic exfil (n=1k) | — | 1.8% | — | 5.7% |

- Two-stage: cheap single-token Stage 1 (err toward blocking) -> CoT Stage 2 only on flagged actions (prompt-caching friendly).
- Deny-and-continue: returns context + safer-alternative nudge instead of halting. Fallback after 3 consecutive or 20 total denials.
- Multi-agent hand-off: classifiers run at delegation and at subagent return.

### Harness-design implications
- A reusable harness should offer at least three modes: review-each-action, pre-approved allowlist, classifier-gated autonomous. Auto mode shows classifier-gated is viable for routine work with caveats.
- Deliberately restrict what the classifier sees to prevent the primary agent from persuading it.
- Subagent boundaries are the right checkpoint for re-running safety checks.
- Treat recovery as deny-and-continue with guidance, not hard abort.

---

## 16. Infrastructure Noise in Agentic Coding Evals

- **URL:** https://www.anthropic.com/engineering/infrastructure-noise
- **Date:** not explicitly stated in post

### Summary
On Terminal-Bench 2.0, *infrastructure alone* produces score gaps (>=6pp) that exceed the differences between top-ranked models. The runtime is now part of the problem, not a passive container. Kubernetes per-task resource caps being treated as hard ceilings caused OOM kills (5.8% infra errors at 1x, 0.5% uncapped). From 1x to 3x headroom, errors drop but success stays within noise (reliability gain); beyond 3x, success jumps ~4pp (capability unlock). Recommendation: specify guarantee and kill threshold separately; 3x per-task spec is a calibration sweet spot. Treat leaderboard gaps under ~3pp with skepticism until configuration is documented.

### Load-bearing quotes
> "Models are given a full environment where they write programs, run tests, install dependencies, and iterate over multiple turns. The runtime is no longer a passive container, but an integral component of the problem-solving process."

> "Until resource methodology is standardized, our data suggests that leaderboard differences below 3 percentage points deserve skepticism until the eval configuration is documented and matched."

### Concrete specifics
- Terminal-Bench 2.0: +6pp (p<0.01) across configurations.
- SWE-bench: +1.54pp at 5x RAM (smaller sensitivity).
- Infra errors: 5.8% (1x) -> 2.1% (3x).
- Example task: `bn-fit-modify` — models that install the full pandas/scikit-learn stack OOM before solving; standard-library approaches succeed.
- Recommendation: guarantee + kill threshold as separate knobs; 3x a working starting point.

### Harness-design implications
- Harness evals must document and control memory/CPU/network or comparisons are meaningless.
- Two-tier resource policy (guaranteed + burstable) fits agentic workloads where solution shape is variable.
- When evaluating capability vs reliability: if you bump resources and errors drop but scores don't, you were eval-limited; if scores also jump, you were capability-gated.

---

## Claude Code / Agent SDK Documentation (current state)

### Claude Agent SDK (primary harness primitive)
- **URL:** https://code.claude.com/docs/en/agent-sdk/overview
- **Relationship:** The Agent SDK *is* Claude Code as a library — "the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript."
- **Primitives exposed:** built-in tools (`Read`, `Write`, `Edit`, `Bash`, `Monitor`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `AskUserQuestion`), hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, ...), subagents (`AgentDefinition` — `description`, `prompt`, `tools`), MCP servers (`mcpServers`/`mcp_servers`), permissions (`allowedTools`, `permissionMode`), sessions (`resume` by session_id, forking).
- **Filesystem config still honored:** `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `CLAUDE.md`, plugins — controllable via `setting_sources`/`settingSources`.
- Renamed from "Claude Code SDK" -> "Claude Agent SDK."
- Python and TypeScript. Authenticates via `ANTHROPIC_API_KEY`, Bedrock (`CLAUDE_CODE_USE_BEDROCK`), Vertex (`CLAUDE_CODE_USE_VERTEX`), Foundry (`CLAUDE_CODE_USE_FOUNDRY`).
- Minimal Python example:
  ```python
  from claude_agent_sdk import query, ClaudeAgentOptions
  async for message in query(
      prompt="Find and fix the bug in auth.py",
      options=ClaudeAgentOptions(allowed_tools=["Read", "Edit", "Bash"]),
  ):
      print(message)
  ```
- **Harness implication:** if you're building a reusable harness, the SDK is the orchestrator substrate you should target, not a hand-rolled tool loop.

### Skills (`code.claude.com/docs/en/skills`)
- **File layout:** `SKILL.md` required at root, optional `scripts/`, `reference.md`, etc. Live change detection while session is running.
- **Scopes:** Enterprise > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`). Plugins namespace via `plugin-name:skill-name`.
- **Frontmatter (all optional except `description` recommended):** `name`, `description`, `when_to_use`, `argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort` (`low|medium|high|xhigh|max`), `context: fork`, `agent`, `hooks`, `paths`, `shell`.
- **Substitutions:** `$ARGUMENTS`, `$N` / `$ARGUMENTS[N]`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`.
- **Dynamic injection:** `` !`command` `` or fenced `` ```! `` blocks execute before Claude sees the prompt; can be disabled via `disableSkillShellExecution: true`.
- **`context: fork` + `agent`:** runs the skill body as a subagent prompt with that agent type's system prompt and tools.
- **Lifecycle:** invoked content enters the conversation as one message and stays. Re-attached after compaction (first 5K tokens per skill; combined 25K budget) from most-recent backward.
- **Budget:** description + when_to_use capped at 1,536 chars per entry; overall at `SLASH_COMMAND_TOOL_CHAR_BUDGET` (default dynamic = 1% of context window, fallback 8,000).
- **"Keep SKILL.md under 500 lines"** explicit guideline.

### Subagents (`code.claude.com/docs/en/sub-agents`)
- Each subagent runs in **its own context window** with custom system prompt, tool list, permissions.
- Defined in `.claude/agents/` (project) or `~/.claude/agents/` (personal). YAML frontmatter includes `name`, `description`, `tools`, `model`.
- Purpose: preserve context, enforce constraints, reuse configs, specialize behavior, control cost (route to Haiku).
- Distinct from "agent teams" — subagents are in-session; agent teams are cross-session parallel coordination.

### Hooks (`code.claude.com/docs/en/hooks`)
- **Events:** session-level (`SessionStart`, `SessionEnd`), turn-level (`UserPromptSubmit`, `Stop`, `StopFailure`), tool-level (`PreToolUse`, `PostToolUse`, `PermissionRequest`, `PermissionDenied`), plus `FileChanged`, `CwdChanged`, `ConfigChange`, `InstructionsLoaded`, `Notification`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate/Remove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`, `TeammateIdle`.
- **Handler types:** `command` (shell), `http` (POST with JSON), `prompt` (single-turn LLM), `agent` (spawn subagent).
- **Matcher syntax:** exact (`Bash`), pipe (`Edit|Write`), regex (`^Notebook.*`), MCP (`mcp__memory__.*`).
- **Decision control:** `PreToolUse` can return `{hookSpecificOutput:{permissionDecision:"allow|deny|ask|defer"}}`; outcome precedence `deny > defer > ask > allow`. Hook `exit 2` is a blocking error.
- **Precedence:** deny/ask permission rules still apply even if a hook says allow; a blocking hook takes precedence over allow rules.
- **Skill-scoped / agent-scoped hooks** via YAML frontmatter.
- Locations: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings, plugins.
- **Design role:** hooks are the only *deterministic* enforcement layer; use them for must-happen invariants.

### Permissions (`code.claude.com/docs/en/permissions`)
- Tiered system: read-only (no approval), Bash (approval + per-directory remember), file mods (approval, session).
- Rules: `Allow`, `Ask`, `Deny`. Evaluation order `deny -> ask -> allow`.
- Modes: `default`, `acceptEdits` (auto file edits + filesystem commands), `plan` (read-only analysis), `auto` (classifier-gated; research preview), `dontAsk` (allowlist-only, non-interactive), `bypassPermissions` (skip prompts; protected dirs still prompt).
- Rule syntax: `Tool` or `Tool(specifier)`, wildcard `*`; Bash glob semantics with space-boundary nuance; process-wrapper stripping (`timeout`, `time`, `nice`, `nohup`, `stdbuf`, bare `xargs`). Compound commands split per subcommand.
- Read/Edit gitignore-style patterns: `//abs`, `~/home`, `/project-rel`, `./cwd-rel`. Symlinks: allow needs both, deny triggers on either.
- `Agent(Name)` rules control subagent access.
- Protected paths (`.git`, `.vscode`, `.idea`, `.husky`, `.claude` except `commands/agents/skills/worktrees`, plus a protected file list) never auto-approved in any mode.
- Managed settings: `allowManagedHooksOnly`, `allowManagedMcpServersOnly`, `allowManagedPermissionRulesOnly`, `disableBypassPermissionsMode`, `disableAutoMode`.
- Auto mode config: `autoMode.environment` (prose descriptions of trusted infra), `autoMode.allow`, `autoMode.soft_deny`. Inspect with `claude auto-mode defaults|config|critique`.
- Sandboxing and permissions are complementary: rules + OS-level enforcement.

### Plan Mode (from permission-modes)
- Read-only analysis; can be entered via `Shift+Tab` cycle or `--permission-mode plan`; post-plan prompt lets you approve-and-start-in-auto, approve-and-accept-edits, keep planning, or refine with Ultraplan (browser-based review).

### CLAUDE.md / Memory (`code.claude.com/docs/en/memory`)
- Two systems: **CLAUDE.md** (you write, loaded every session) and **auto memory** (Claude writes, first 200 lines / 25KB loaded each session).
- Locations: managed policy, project (`./CLAUDE.md` or `./.claude/CLAUDE.md`), user (`~/.claude/CLAUDE.md`), local (`./CLAUDE.local.md`).
- Imports: `@path` syntax, max 5-hop recursion, relative-to-file resolution.
- `AGENTS.md`: Claude Code doesn't read it directly — import it from CLAUDE.md.
- Loading: walks up directory tree from cwd, concatenates all discovered; subdirectory CLAUDE.md files load on demand.
- `.claude/rules/*.md` — modular alternative, supports `paths:` frontmatter for glob-scoped rules.
- `claudeMdExcludes` setting for monorepos.
- Block-level HTML comments stripped from context.
- Auto memory: per-repo at `~/.claude/projects/<project>/memory/MEMORY.md`; topic files read on demand. Disable via `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- Survives `/compact`: project-root CLAUDE.md is re-read and re-injected; nested CLAUDE.md files reload lazily.

### Slash commands / skills convergence
- Commands have been merged into skills. `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both produce `/deploy`. Skills add supporting files, frontmatter-controlled invocation, automatic discovery.

---

## Cross-cutting patterns

Reading all of this together, a consistent picture emerges of what Anthropic considers good harness design in 2026.

**1. Context is the single most important resource.** Every post returns to it. The best practices doc says so explicitly. The context engineering post calls for "the smallest set of high-signal tokens." Code-execution-with-MCP, advanced tool use, and sub-agent architectures all exist primarily to keep tokens *out* of the main context. A reusable harness must have first-class strategies for: retrieval-by-reference (paths/URLs/queries), external notes (files, memory tool), compaction (keep decisions + bugs + implementation; drop redundant tool outputs), and sub-agents returning 1-2K-token summaries.

**2. Separation of concerns between roles.** Generator vs evaluator (harness-design post), lead vs subagent (research system), Brain vs Hands vs Session (managed agents), init vs coding agent (effective harnesses). The motif is consistent: self-evaluation and self-correction fail at scale; fresh contexts with narrowly scoped tasks work better. A harness should treat "specialized agent with own context + tool set + system prompt" as a first-class unit.

**3. Verification is load-bearing.** Best practices calls it the highest-leverage move. The GAN harness centers on it. The C compiler only works because Carlini insisted on "nearly perfect" verifiers. Infrastructure-noise argues we can't even trust benchmarks without documented environments. Evals post formalizes it. A harness without a verification loop is not an autonomous harness; it's a typing assistant.

**4. Complexity tracks model capability.** The 2026-03 harness post explicitly removed the sprint construct when Opus 4.6 made it unnecessary. The building-effective-agents post insists on starting simple and escalating only when outcomes improve. The context-engineering post notes models now "require less prescriptive engineering." The design rule: every harness component is a hypothesis about a model limitation; re-test the hypothesis each model release.

**5. Tools are architecture, not plumbing.** Writing-tools-for-agents, advanced-tool-use, and code-execution-with-MCP together make the case: tool choice, naming, descriptions, error messages, and return shapes are the dominant axis of agent performance. Tool Use Examples alone moved accuracy 72% -> 90%. Tool Search delivered 85% token reduction. Programmatic tool calling collapsed 200KB of raw data to 1KB of relevant results. Treat the ACI like API design.

**6. Enforcement layers are layered.** CLAUDE.md = advisory context. Skills = opt-in playbooks. Permission rules = deterministic allow/deny. Hooks = deterministic interposition. Sandboxing = OS-level enforcement. Auto-mode classifier = semantic guard with stripped inputs. A production harness uses all of these — rules can be overridden by broader phrasing, but a hook (`exit 2`) cannot, and a sandbox cannot. Defense in depth.

**7. State lives outside the model.** Sessions as event logs (managed agents), progress files (effective harnesses), structured notes (context engineering), memory tool, auto memory, `feature_list.json`, lock files (C compiler). The model is a stateless function; the harness owns state. Every non-trivial design separates a session-local context from a durable external state that survives compaction, restarts, and handoffs.

**8. Evaluation-driven iteration is a prerequisite.** Writing tools: "Concatenate evaluation transcripts and have Claude Code analyze them." Multi-agent research: 20 real-failure starter tasks. Evals post: 8-step roadmap starts at "20-50 tasks from real failures." Skills post: "Start with evaluation — identify capability gaps." Infrastructure-noise: document your resources or the numbers mean nothing. A reusable harness should ship with its eval harness and make it cheap to add new tasks; transcript review is a design activity, not a QA activity.
