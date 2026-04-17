# Community Practitioner Research on Agentic Coding

Deep read of named authors for the design of a reusable coding harness. Compiled 2026-04-16.
Primary sources read directly; quotes preserved verbatim where they appeared in the source material.

---

## Armin Ronacher (lucumr.pocoo.org)

### Canonical URLs read
- https://lucumr.pocoo.org/2025/6/12/agentic-coding/ — "Agentic Coding Recommendations" (Jun 2025)
- https://lucumr.pocoo.org/2025/7/3/tools/ — "Tools: Code Is All You Need" (Jul 2025)
- https://lucumr.pocoo.org/2026/1/31/pi/ — "Pi: The Minimal Agent Within OpenClaw" (Jan 31, 2026)
- https://lucumr.pocoo.org/2026/1/18/agent-psychosis/ — "Agent Psychosis: Are We Going Insane?" (Jan 18, 2026)
- https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/ — "The Final Bottleneck" (Feb 13, 2026)

### Position in his own words

On MCP vs. CLI:
> "Claude Code is very capable of just running regular tools. So MCP for me is really only needed if I need to give Claude access to something that finds too hard to use otherwise."

> "try completing a GitHub task with the GitHub MCP, then repeat it with the `gh` CLI tool. You'll almost certainly find the latter uses context far more efficiently."

> "I can only encourage people to bypass MCP and to explore what else is possible. LLMs can do so much more if you give them the power to write code."

On tool design:
> "Tools need to be fast. The quicker they respond (and the less useless output they produce) the better."
> "Tools need to provide the right debuggability and observability"
> "Tools need to be protected against an LLM chaos monkey using them completely wrong"

On the review bottleneck:
> "If the machine writes the code, the machine better review the code at the same time."
> "You can't triage, you can't review, and many of the PRs cannot be merged after a certain point because they are too far out of date."

On minimal-core agent architecture (Pi):
> "it has a tiny core. It has the shortest system prompt of any agent that I'm aware of and it only has four tools: Read, Write, Edit, Bash."
> "if you want the agent to do something that it doesn't do yet, you don't go and download an extension or a skill or something like this. You ask the agent to extend itself."
> "sessions in Pi are trees. You can branch and navigate within a session"

### Concrete patterns
- Runs `claude --dangerously-skip-permissions`, aliased `claude-yolo`. Assigns one job to one agent; rarely interrupts.
- Makefile-based harness: `make dev` starts services through a process manager that (1) guards against duplicate spawns, (2) tails logs to a file so the agent can run `make tail-log` to diagnose itself. Email verification codes are logged to stdout in debug mode so the agent can complete sign-in flows unattended. The `CLAUDE.md` references these affordances.
- Language choice skews to Go: explicit `context` type, cached tests, structural interfaces, low ecosystem churn. Python is harder because of "magic (eg: Pytest's fixture injection)" and slow interpreter startup.
- Code style: "Prefer functions with clear, descriptive and longer than usual function names over classes"; "Use plain SQL"; keep permission checks local.
- Pi's four-tool core (Read/Write/Edit/Bash) with an extensions system that can persist state between sessions and be authored by the agent itself.
- Parallelization via containerized environments (e.g., `container-use` MCP) to isolate shared state.

### Where he disagrees
- Disagrees with Anthropic's push of MCP servers — favors CLIs and code generation instead.
- Disagrees with the tool-proliferation school: Pi deliberately has four tools and no MCP.
- Disagrees with spec-heavy schools (Huntley's specs/, Spec Kit) implicitly — his Pi piece and workflow posts emphasize a minimal agent that extends itself, not a large corpus of markdown specs.

### Implications for harness design
- Optimize tool response latency and signal density; treat tool output as a cost center.
- Local logs + CLI entry points are the canonical surface an agent should hit — not MCP unless unavoidable.
- Project layout should be "legible to agents": explicit context, minimal magic, named functions, `make`-level entry points.
- Build in a review/throttling mechanism: the bottleneck is reviewer capacity, not token throughput. The harness needs to help the reviewer, not flood them.
- Keep the core tiny; allow the agent to synthesize its own custom tools per project as an extension layer.

---

## Simon Willison (simonwillison.net)

### Canonical URLs read
- https://simonwillison.net/guides/agentic-engineering-patterns/ — "Agentic Engineering Patterns" guide (Mar 2, 2026)
- https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/
- https://simonwillison.net/2025/Oct/7/vibe-engineering/ — "Vibe engineering"
- https://simonwillison.net/2025/Oct/5/parallel-coding-agents/ — "Embracing the parallel coding agent lifestyle"
- https://simonwillison.net/2025/Nov/6/async-code-research/ — "Code research projects with async coding agents"
- https://simonwillison.net/2025/Dec/25/claude-code-transcripts/ — claude-code-transcripts tool release
- https://simonwillison.net/2026/Mar/24/auto-mode-for-claude-code/ — Auto mode analysis

### Position in his own words

Defining vibe engineering (vs. "vibe coding"):
> "[vibe engineering is] experienced professionals who accelerate their work with LLMs while staying proudly and confidently accountable."
> "your agent might claim something works without having actually tested it at all"
> AI tools "amplify existing expertise"; you must be "at the top of your game."

On parallel agents:
> The code itself "doesn't lie: if they write code and execute it and it does the right things then they've demonstrated…that something really does work."

On Claude Code's auto-mode classifier:
> Prefers "robust sandbox by default" with deterministic restrictions over AI-based injection protections because of the non-deterministic nature of the latter.

On transcripts as artifacts:
> "these days I'm writing significantly more code via Claude Code than by typing text into a text editor myself."

### Concrete patterns
- Guide structure: Principles → Working with Coding Agents → Testing & QA → Understanding Code → Annotated Prompts → Appendix of reusable prompts.
- "Red/Green TDD" as a shorthand prompt directive: `"Build a Python function to extract headers from a markdown string. Use red/green TDD."` Model must write failing tests, confirm they fail, then implement.
- Separate throwaway repos for "code research" (e.g., `simonw/research`) rather than polluting main codebases. Creates roughly one new project/day; tags with `noindex`.
- Runs Claude Code (Sonnet 4.5) + Codex CLI + Codex Cloud; uses fresh `/tmp` checkouts instead of git worktrees for most parallel work; containerizes local agents where risk matters.
- Built `claude-code-transcripts` to convert Claude Code sessions into shareable HTML — treats transcripts as first-class project artifacts because they "contain crucial project context — prompts, suggestions, implementation decisions — previously captured in issue trackers."

### Where he disagrees
- Disagrees with Anthropic's reliance on the Sonnet-4.6-based Auto Mode classifier as primary safety — prefers deterministic sandboxing.
- Pushes back implicitly on Steinberger's "stop reading code" approach — Willison emphasizes code review culture as "essential for managing agent output."
- Less prescriptive than Huntley on specs; favors Red/Green TDD as the forcing function rather than a multi-stage spec pipeline.

### Implications for harness design
- The harness must enforce "test before implementation." Red/Green TDD is a one-word prompt escape hatch; a harness could install it as a default skill.
- Treat every transcript as a reusable artifact; ship a transcript extractor by default.
- Sandbox-by-default; don't rely on classifier-based permission models alone.
- First-class support for "research repositories" — ephemeral, wide-permission workspaces separate from production.

---

## Geoffrey Huntley (ghuntley.com)

### Canonical URLs read
- https://ghuntley.com/ralph/ — the Ralph Wiggum post
- https://ghuntley.com/agent/ — how-to-build-a-coding-agent
- https://ghuntley.com/six-month-recap/
- https://ghuntley.com/cursed/ — "i ran Claude in a loop for three months…"
- https://ghuntley.com/specs/ — referenced; most content is gated to subscribers

### Position in his own words

The core Ralph loop:
```bash
while :; do cat PROMPT.md | claude-code ; done
```
> "a Bash loop [that] can replace the majority of outsourcing at most companies for greenfield projects"
> "Only one thing. Now, this might seem wild, but you also need to trust Ralph to decide what's the most important thing to implement."
> "The items that you want to allocate to the stack every loop are your plan (@fix_plan.md) and your specifications."
> "Building software with Ralph requires a great deal of faith and a belief in eventual consistency."
> "You may use up to 500 parallel subagents for all operations but only 1 subagent for build/tests."

On agent architecture:
> A coding agent is "300 lines of code running in a loop with LLM tokens."
> "Less is more, folks. Less is more."
> Sonnet is "a mechanical squirrel" — trained to chase tool calls, favoring incremental action.
> Context window: "Treat context like a Commodore 64"; 200k advertised becomes ~176k usable; "Clear context between activities" to prevent "autoregressive failure."

On MCP proliferation (Aug 2025):
> "The more you allocate into the context window of an LLM… the worse the outcomes you're going to get"

Prompt directives inside Ralph's `PROMPT.md`:
> "Before making changes search codebase (don't assume an item is not implemented) using subagents."
> "After implementing functionality or resolving problems, run the tests for that unit of code that was improved."
> "DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS."
> "When you learn something new about how to run the compiler or examples make sure you update @AGENT.md using a subagent."
> "When you discover a parser, lexer, control flow or LLVM issue. Immediately update @fix_plan.md with your findings."

### Concrete patterns
- Canonical file layout for a Ralph project:
  - `PROMPT.md` — per-loop instruction
  - `@fix_plan.md` — priority-ordered bullet list of outstanding work
  - `@AGENT.md` — how to build/run + accumulated learnings
  - `@specs/*` — specification files
  - `src/`, `examples/`, `tree-sitter/`
- Two-phase mental model: (1) **Generate** (cheap) and (2) **Backpressure** (hard: tests, type checks, static analysis, security scanning). Tests passing triggers a scripted `git add -A` + commit + `git push` + version tag (starting 0.0.0).
- Five core tool primitives: Read File, List Files, Bash, Edit File, Code Search.
- Separate planning loop that spawns up to 500 subagents to analyze code and refresh `@fix_plan.md`.
- For community contributors: `"study specs/* to learn about the programming language… Come up with a plan to implement XYZ as markdown then do it"`.

### Where he disagrees
- Disagrees with Ronacher (and Steinberger) on scope of specs: Huntley's `specs/` directory and planning loop are much heavier.
- Agrees with Ronacher on MCP minimalism (his "Less is More" post is in Steinberger's Essential Reading).
- Disagrees with the "single-agent-at-a-time" posture Ronacher describes; Huntley runs up to 500 subagents and champions "multi-boxing."
- Disagrees with the "stop reading code" school — he emphasizes backpressure via tests, type checks, security scans.

### Implications for harness design
- File-layout conventions matter. Ship an opinionated skeleton: `PROMPT.md`, `@fix_plan.md`, `@AGENT.md`, `@specs/`.
- Context is a finite memory budget — the harness should aggressively clear context between loop iterations and expose a cheap "subagent" primitive for fan-out research.
- Automated backpressure (tests + lint + type check + security scan, with auto-commit on green) is the most reusable harness primitive across projects.
- Plan loop and implementation loop should be separate processes with distinct prompts.

---

## Harper Reed (harper.blog)

### Canonical URLs read
- https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/ — "My LLM codegen workflow atm" (Feb 16, 2025)

### Position in his own words

Greenfield idea-honing prompt (verbatim):
> "Ask me one question at a time so we can develop a thorough, step-by-step spec for this idea… Remember, only one question at a time."

After brainstorming:
> "Now that we've wrapped up the brainstorming process, can you compile our findings into a comprehensive, developer-ready specification?"

Planning prompt emphasis:
> "Prioritize best practices, incremental progress, and early testing, ensuring no big jumps in complexity."
> "Each prompt should be tagged as text using code tags. The goal is to output prompts, but context, etc is important as well."

Todo prompt:
> "Can you make a `todo.md` that I can use as a checklist? Be thorough."

> "This entire process will take maybe 15 minutes."

Code review prompt for iteration:
> "You are a senior developer. Your job is to do a thorough code review of this code… Review every part, and don't hallucinate."

Missing-tests prompt:
> "Write out a list of missing test cases, and code tests that should exist… Do Not Hallucinate."

### Concrete patterns
- Three-step greenfield workflow producing three persisted artifacts:
  1. `spec.md` (from a question-at-a-time chat with GPT-4o/o3)
  2. `prompt_plan.md` (generated by a reasoning model; each step tagged as a text/code block prompt)
  3. `todo.md` (checklist derived from the plan)
- Execution modes: manual pair-programming with Claude (paste prompts, copy code into IDE) OR automated with Aider ("watch aider dance").
- Non-greenfield flow: **Repomix** concatenates repo → `output.txt` → piped through `llm` CLI with templates for "code review" and "missing tests."
- Mise tasks for bundling code snapshots; Repomix for context extraction; `llm` CLI for template-based generation.
- Reed caveats these prompts as "old and busted" and due for refactoring.

### Where he disagrees
- Aligns with Huntley on explicit specs; disagrees with Steinberger's "Just Talk To It" stance.
- Differs from Willison's TDD-prompt approach: Reed's artifact is a step-by-step prompt plan, not a red/green loop directive.
- Less opinionated about MCP/CLI — his stack is pre-Claude-Code, using Aider and the `llm` CLI.

### Implications for harness design
- Persisted artifacts (`spec.md`, `prompt_plan.md`, `todo.md`) are the reusable contract — a harness should scaffold these as first-class files.
- Include a Repomix-style "pack the repo for a prompt" primitive for non-greenfield work.
- Provide opinionated templates for "senior code review" and "missing tests" prompts.

---

## Hamel Husain (hamel.dev)

### Canonical URLs read
- https://hamel.dev/blog/posts/evals/ — "Your AI Product Needs Evals" (Mar 29, 2024)
- https://hamel.dev/blog/posts/llm-judge/ — "Using LLM-as-a-Judge For Evaluation: A Complete Guide" (Oct 29, 2024)
- https://hamel.dev/blog/posts/field-guide/ — "A Field Guide to Rapidly Improving AI Products" (Mar 24, 2025)
- https://hamel.dev/blog/posts/evals-skills/ — "Evals Skills for Coding Agents" (Mar 2, 2026)

### Position in his own words

Root cause of AI product failure:
> "Success with AI hinges on how fast you can iterate."
Many teams "addressing one failure mode led to the emergence of others, resembling a game of whack-a-mole."

On tooling:
> "Keep it simple. Don't buy fancy LLM tools."
> "You can never stop looking at data — no free lunch exists."

On multi-dimensional scoring (a hard position):
> "If your evaluations consist of a bunch of metrics that LLMs score on a 1-5 scale…you're doing it wrong."

On judges:
> "Judges often use larger models or more compute than the systems they evaluate."
> "The real business value comes from looking at your data. But hey, potato, potahto."
Achieved >90% judge/human agreement in three iterations on the Honeycomb case via critique-shadowing.

On data viewers:
> "Teams with thoughtfully designed data viewers iterate 10x faster than those without them."

On the evals-skills toolkit:
> "Improving the infrastructure around the agent mattered more than improving the model."

### Concrete patterns
- Hierarchical evaluation:
  - Level 1 — **Unit tests** (feature/scenario scoped, CI-integrated, synthetic test cases)
  - Level 2 — **Human + model eval** (trace logging, custom data viewers, LLM critics calibrated against humans)
  - Level 3 — **A/B tests** (only after confidence)
- Seven-step "Critique Shadowing" for judges: principal-expert → diverse dataset (features × scenarios × personas) → binary pass/fail + critique → fix obvious failures → iterate judge prompts to human agreement → error analysis → specialized judges.
- `evals-skills` toolkit (github.com/hamelsmu/evals-skills) — six skills:
  - `eval-audit` (run this first)
  - `error-analysis`
  - `generate-synthetic-data`
  - `write-judge-prompt` (binary)
  - `validate-evaluator` (TPR/TNR vs human labels)
  - `evaluate-rag` (separate retrieval and generation)
  - `build-review-interface`
- Synthetic input generation along three axes: **features × scenarios × personas**. Generate inputs, not outputs.
- Binary pass/fail judgments with detailed critiques — no 1–5 Likert scales.
- Custom data annotation interfaces with full context + keyboard shortcuts + one-click feedback are the single highest-leverage investment.

### Where he disagrees
- Disagrees sharply with off-the-shelf eval frameworks and multi-dimensional scoring.
- Agrees with Shankar that evals are non-negotiable.
- Disagrees with lightweight-workflow schools (Steinberger) when inferential backpressure is required — a harness without evaluator calibration is, to Hamel, a blind system.

### Implications for harness design
- Evaluation is *the* harness. Ship `eval-audit`, `error-analysis`, `write-judge-prompt`, and `validate-evaluator` as canonical skills.
- Bake binary pass/fail + critique into default test/judge templates.
- Treat a custom trace viewer as a first-class deliverable — not a stretch goal.
- Provide `generate-synthetic-data` primitives parameterized by features × scenarios × personas.
- Skills-as-packaging model (the `evals-skills` repo) suggests the harness itself should ship as Claude Skills.

---

## Peter Steinberger (steipete.me)

### Canonical URLs read
- https://steipete.me/posts/2025/essential-reading-august-2025 — "Essential Reading for Agentic Engineers – August 2025"
- https://steipete.me/posts/2025/optimal-ai-development-workflow — "My Current AI Dev Workflow" (Aug 25, 2025)
- https://steipete.me/posts/just-talk-to-it — "Just Talk To It" (Oct 14, 2025)
- https://steipete.me/posts/2025/shipping-at-inference-speed — "Shipping at Inference-Speed" (Dec 28, 2025)
- Note: the `/posts/2025/essential-reading-agentic-engineers` URL originally requested returns 404; the August 2025 edition at the URL above is the canonical Essential Reading post.

### Position in his own words

On MCP:
> Eliminated his last MCP because Claude "would go off spinning up Playwright unasked when it could simply read the code — which is faster and pollutes the context less."

On specs:
> "Just talk to it. Play with it. Develop intuition."
Moved away from spec-driven development (which he practiced in June 2025) toward conversational iteration.

On tests:
> "The model almost always finds issues when you ask it to write tests IN THE SAME CONTEXT."

On reading code:
> "These days I don't read much code anymore."
> "I do know where which components are and how things are structured."
> "I simply commit to main."

Tools:
> Primary: Ghostty + Claude Code; now adds Codex CLI and runs 3–8 concurrent instances.
> Rejected VS Code terminal ("too unstable") and Zed ("visual terminal appearance concerns").
> "look at ../vibetunnel and do the same" — cross-project pattern lift.

Blast radius:
> Before implementing, estimates "blast radius" — scope and files affected — to choose between small modifications and larger refactors.

Essential Reading endorsements include:
- Thomas Dohmke "Developers, Reinvented" (role evolution)
- Namanyay Goel "Hidden Cost of AI-Assisted Learning"
- Colton Anglin "Reality Check" (20–30% realistic gains, not 10x)
- Austin Parker "The End of Platform Dominance"
- Geoffrey Huntley "Less is More: Hidden Costs of MCP Server Proliferation"

### Concrete patterns
- Statusline shows topic + session ID so account/session switching is trivial.
- Agent parallelism: 1–2 for focused work, ~4 for cleanup/testing/UI. With Codex he runs 3–8.
- "Ghostty + Claude Code + minimal tooling = maximum productivity."
- CLAUDE.md: minimal, mostly database connection examples and pointers to CLIs (Vercel, psql, gh, Axiom).
- Commits directly to `main`; uses `docs/` folders agents reference; 50%+ of prompts include screenshots.
- Trigger words: "take your time," "comprehensive."
- Spends ~20% of time on agent-driven refactoring: duplication removal, dead code, modernization.

### Where he disagrees
- Flatly disagrees with spec-heavy approaches (Huntley, Spec Kit, Kiro). Dropped specs after ~June 2025.
- Disagrees with Willison and Hamel on review rigor — he explicitly "doesn't read much code anymore."
- Agrees with Ronacher on CLI-over-MCP.
- Agrees with Huntley on parallel agents but disagrees on subagent fan-out (Steinberger uses concurrent top-level CLIs, not nested subagents).

### Implications for harness design
- Support many concurrent top-level agents cheaply — terminal-grid, not subagent-tree.
- Keep the agent-facing configuration minimal; CLIs beat MCP.
- Include a default "write tests in the same context as implementation" skill.
- Treat screenshots as a first-class input pathway.
- Provide a "blast radius estimator" step before writes — even if informal.

---

## Shreya Shankar

### Canonical URLs read
- https://www.sh-reya.com/blog/in-defense-ai-evals/ — "In Defense of AI Evals, for Everyone" (Sep 5, 2025)
- https://www.sh-reya.com/blog/ai-engineering-flywheel/ — "Data Flywheels for LLM Applications" (Jul 1, 2024)
- SPADE: https://arxiv.org/abs/2401.03038 — "SPADE: Synthesizing Data Quality Assertions for LLM Pipelines"
- "Who Validates the Validators" (EvalGen): referenced secondarily; paper not fetched here.

### Position in her own words

Definition:
> Evals are "the systematic measurement of application quality."

On teams that claim to skip evals:
> "Usually lying to themselves."

When lighter rigor is acceptable:
1. Tasks well-represented in posttraining (e.g., coding agents riding on upstream eval investment).
2. Teams with strong domain expertise and disciplined dogfooding who can "steer by feel."

On anti-eval sentiment:
> "Damaging" — especially for newcomers without data-analysis backgrounds.

On metric design:
> "Words like 'delve' and 'crucial' commonly give off a 'GPT smell'" — you only learn such things from looking at data.
> Binary metrics "easier to align" and "easier for humans to consistently judge."

### SPADE method
Automatically synthesizes data quality assertions for LLM pipelines by analyzing prompt-version histories; identifies candidate assertions from developer-observed issues, then selects a minimal set. "SPADE efficiently reduces the number of assertions by 14% and decreases false failures by 21% when compared to simpler baselines." Deployed in LangSmith; >2,000 production pipelines.

### Concrete patterns
- Three-part flywheel: Evaluation → Monitoring → Continual Improvement.
- Node-specific validation for pipeline graphs:
  - **Classifiers**: accuracy/precision/recall
  - **Writers**: quality/coherence/brand
  - **Code generators**: static analysis, linters, dynamic execution
- Dynamic few-shot learning: retrieve examples by input similarity, weight by recency, prioritize cases where human judgment diverged from LLM.
- Binary metrics + systematic error analysis + LLM-as-Judge at scale.

### Where she disagrees
- Strongly aligned with Hamel; disagrees with practitioners who skip formal evals.
- Implicit disagreement with Steinberger's "steer by feel" posture — she permits it *only* when paired with deep domain expertise and disciplined dogfooding.

### Implications for harness design
- Ship a "node-type-aware" evaluator pattern (classifier vs. writer vs. code-gen) as templates.
- Incorporate SPADE-style assertion synthesis from prompt-version history.
- Binary-only metrics as default.
- Dynamic few-shot retrieval is a first-class runtime primitive.

---

## Thoughtworks Technology Radar (v34, April 2026)

### Canonical URLs read
- https://www.thoughtworks.com/en-us/radar/techniques
- https://www.thoughtworks.com/radar

### Relevant blips

**Adopt**
- **Context engineering** — "treating the context window as a design surface and intentionally constructs the AI's information environment."

**Trial**
- **Agent Skills** — "open standard for modularizing context by packaging instructions, executable scripts and associated resources."
- **Feedback sensors for coding agents** — "Deterministic quality gates integrated directly into agent workflows so failures trigger auto-correction."
- **Spec-driven development** (Trial on one view, Assess on another) — "Structure workflows and guide agents through planning, design and implementation." Flow: spec → plan → implement.
- **Measuring collaboration quality with coding agents** — "points toward a broader redefinition of what it means to be a software developer."
- **Mapping code smells to refactoring techniques** — "instructing an agent to handle specific issues with a defined approach."
- **Progressive context disclosure** — "Instead of overwhelming an agent with instructions upfront, you give it a lightweight discovery phase."
- **Architecture drift reduction with LLMs** — "Combining deterministic structural rules with LLM-based evaluation."

**Assess**
- **Team of coding agents** — "small set of role-specific agents to collaborate on a coding task."
- **Feedback flywheel** — "teams capture successes and failures during a coding agent session and use them to improve predictability."

**Hold / Caution**
- **Agent instruction bloat** — "instructions become long and sometimes conflict with each other" as teams add guidelines over time.

### Implications for harness design
- Context engineering graduating to **Adopt** confirms the community position that the harness = the context construction system. Design the harness around this explicit premise.
- Progressive context disclosure + Agent Skills say: the harness should not front-load all instructions; it should expose a lightweight discovery surface the agent pulls from on demand.
- Feedback sensors in **Trial** validate Huntley's backpressure pattern.
- **Agent instruction bloat** is a named anti-pattern; the harness must fight instruction accretion (periodic pruning, conflict detection).

---

## Martin Fowler's site (martinfowler.com)

### Canonical URLs read
- https://martinfowler.com/articles/harness-engineering.html — Birgitta Böckeler, "Harness Engineering for Coding Agent Users" (Apr 2, 2026)
- https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html — "Understanding Spec-Driven Development: Kiro, spec-kit, and Tessl" (Oct 15, 2025)
- https://martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html — "Humans and Agents in Software Engineering Loops" (Mar 4, 2026)
- https://martinfowler.com/articles/reduce-friction-ai/feedback-flywheel.html — Rahul Garg, "Feedback Flywheel" (Apr 8, 2026)
- https://martinfowler.com/articles/reduce-friction-ai/encoding-team-standards.html — Rahul Garg, "Encoding Team Standards" (Mar 31, 2026)

### Position in their own words (Böckeler)

Harness framing:
> "Agent = Model + Harness"
> "feedback-only produces repeated mistakes; feedforward-only encodes rules but never validates effectiveness."
> "A good harness should direct human input toward where it matters most, not eliminate it entirely."

Three positionings for humans:
> "Human runs the why loop, agent runs the how loop."
> "Agents can generate code faster than humans can manually inspect it."
Humans on the loop: "change the harness that produced the artefact so it produces the results we want."

On SDD tools:
> "I'd rather review code than all these markdown files."
> "neither of them is suitable for the majority of real life coding problems."
> Warns of "Verschlimmbesserung" — making things worse while trying to improve.
> SDD risks inheriting MDD's "inflexibility *and* non-determinism."

### Position (Rahul Garg)

> "two developers on the same team, using the same tool, same codebase, same project context, producing materially different results"
> "the priming document tells the AI how the project works; the executable instruction tells the AI how the team works"
> "What distinguishes a team that merely uses AI from one that gets better with it is not the model. It is whether the team has a way to turn each interaction into a small improvement in its shared artifacts."
> "When the AI keeps using the deprecated Prisma 4.x API, that is not a model failure; it is a priming gap."

### Concrete patterns

Böckeler's harness taxonomy:
- **Feedforward** (guides) vs **Feedback** (sensors)
- **Computational** (linters, type checks, tests) vs **Inferential** (code-review agents, semantic analysis)
- Three regulatory categories: **Maintainability**, **Architecture Fitness**, **Behaviour** (weakest)
- Change lifecycle: pre-commit (LSP, linters) → pre-integration (tests, coverage) → post-integration (mutation testing, broad review) → continuous monitoring (drift detection)
- **Harness templates** bundled around common service topologies (CRUD APIs, event processors, dashboards).
- **Harnessability** / **ambient affordances**: strongly typed code and clear module boundaries make projects legible to agents.

SDD tool comparison (Böckeler):
- Three levels: **spec-first** → **spec-anchored** → **spec-as-source**.
- **Kiro**: Requirements → Design → Tasks; steering files `product.md`, `structure.md`, `tech.md`. Over-produces ("4 user stories with 16 acceptance criteria" for a small bug).
- **Spec-kit**: Constitution → Specify → Plan → Tasks; cyclical; "Constitution" as immutable principles.
- **Tessl**: private beta; only one targeting spec-as-source; `// GENERATED FROM SPEC — DO NOT EDIT`; one spec → one file.

Garg's four feedback signals: context, instruction, workflow, failure. Four cadences: per-session → standup → retro → quarterly. Four-element instruction anatomy: role + context requirements + categorized standards (critical vs. advisory) + output format.

### Where they disagree
- Böckeler aligns with Scott Logic in being skeptical of pure SDD; finds it over-engineered.
- Agrees with Huntley's backpressure via "feedback sensors."
- Disagrees with Steinberger's "stop reading code" — she wants humans on the loop, actively shaping the harness rather than abdicating review.

### Implications for harness design
- Explicit framework: guides + sensors, computational + inferential. Design the harness as a 2×2 coverage matrix.
- Ship **harness templates** per service topology rather than a single monolithic harness.
- Treat team-standards artifacts as repo-versioned, PR-reviewed infrastructure, with the structure: **role + context + prioritized standards + output format**.
- Build a **feedback flywheel loop** into the harness UX: per-session reflection prompts that nominate artifact updates.
- Avoid pure spec-as-source unless you can also provide spec-level static analysis.

---

## Scott Logic blog (spec-kit critique)

### Canonical URL read
- https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html

### Position
- SDD was ~10x slower: 33.5 minutes agent time + 3.5 hours reviewing markdown vs. 8 minutes iterative.
- Planning produced >2,000 lines of markdown across five docs, much of it "duplicative, and faux context."
- Despite ceremony, the implementation still shipped with "a small, and very obvious, bug."
- Calls pure SDD "an interesting concept, a radical idea" but not "a viable process, at least not in its purest form."
- Philosophical jab: "Code is law because it is formal language you can reason about" — markdown specs aren't.

### Implications for harness design
- SDD workflows must be optional, not mandatory. A spec phase should be a switch, not a staircase.
- Markdown-heavy planning phases should still be followed by cheap functional verification; the harness should interleave review with generation, not serialize them.

---

## Nice-to-have authors (lighter coverage)

### Jason Liu (Instructor)
Not fetched in this pass. Known position (flagged as secondary): structured outputs via Pydantic/Instructor remove an entire category of parse-failure eval work and should be a harness default when schemas are known.

### Phillip Carter (ex-Honeycomb)
Not fetched in this pass. His public work on Honeycomb's NLQ is the canonical example Hamel uses for critique shadowing and the >90% judge-agreement case.

### Chip Huyen, Swyx (Latent Space)
Not fetched in this pass.

---

## Points of disagreement across the community

1. **MCP vs. CLI-and-code.** Ronacher, Huntley, and Steinberger converge against MCP proliferation as a context-waster. Anthropic's docs and ecosystem still lean MCP. For the harness: default to CLI-as-tool and admit MCP only where a CLI doesn't exist.

2. **Specs: source-of-truth vs. lightweight checklist vs. none.** Huntley (heavy `@specs/`), Harper Reed (persisted `spec.md`/`prompt_plan.md`/`todo.md`), and SDD tools (Kiro / spec-kit / Tessl) sit on one end. Böckeler, Scott Logic, and Steinberger warn that spec pipelines are slow and don't catch bugs any better than iterative prompting. The harness should treat specs as optional scaffolding and never as mandatory gates.

3. **Single vs. multi-agent.** Ronacher uses one agent at a time. Huntley fans out to 500 subagents. Steinberger runs 3–8 concurrent top-level CLIs. Willison embraces "parallel coding agent lifestyle." The harness should support all three topologies and let the user pick; the load-bearing question is isolation (containers, separate checkouts, worktrees).

4. **Reading code vs. not reading code.** Steinberger has stopped reading most code; Willison and Böckeler insist code review culture is non-negotiable; Ronacher calls the review bottleneck "the final bottleneck" and doesn't let the agent short-circuit it. The harness must make review *cheaper* (transcripts, diffs, test artifacts, harness-generated review notes) rather than picking a side.

5. **Evals: formal infra vs. "steer by feel."** Hamel and Shankar demand hierarchical evals with calibrated judges; Steinberger and Ronacher operate more on vibes and fast iteration. Shankar explicitly permits the latter *only* with deep domain expertise + disciplined dogfooding. The harness default should be toward Hamel/Shankar (binary judges + trace viewers + critique shadowing), with a lightweight mode for experts.

6. **Classifier-based safety vs. deterministic sandboxing.** Anthropic's Auto Mode uses a Sonnet-4.6 classifier; Willison and Huntley prefer deterministic sandboxes/containers. The harness should default to deterministic sandboxing and treat classifier-based permission models as complementary, not primary.

7. **Instruction richness vs. instruction bloat.** Thoughtworks flagged "Agent Instruction Bloat" in v34. Garg's Encoding Team Standards wants rich, categorized instructions; Ronacher's Pi goes the other way with the shortest known system prompt. The harness needs explicit affordances to *prune* and *load just-in-time* (Progressive Context Disclosure in Thoughtworks v34; Skills as the packaging unit).

8. **What the harness actually is.** Böckeler defines it as model + surrounding scaffolding. Ronacher treats it as a set of fast, legible CLIs plus a tiny core agent. Huntley treats it as a file-layout + loop + backpressure. Hamel treats it as evals infrastructure. These aren't conflicting — they're four complementary faces of the same artifact. A reusable harness needs: (a) a fast tool surface, (b) an opinionated file layout, (c) guides + sensors at computational and inferential layers, and (d) an eval loop with calibrated judges.
