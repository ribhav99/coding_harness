# Research Plan: Coding Harness for Agentic Development

## Goal
Inform the design of a reusable coding harness Ribhav will drop into future projects to accelerate agentic development. Must decide between (1) project scaffold, (2) orchestration harness, (3) both integrated — after seeing the full landscape.

## What went wrong in pass 1
- Delegated a single broad agent with no concrete source list. It returned a shape that looked thorough but missed foundational primary sources, most notably Anthropic's own "Harness design for long-running application development" (Mar 2026, the GAN post) and "Effective harnesses for long-running agents" (Nov 2025).
- Relied on the agent's judgment about what to cover instead of enumerating the source set first.

## Corrections for pass 2
1. Enumerate primary sources *before* delegating. Anthropic engineering blog has 23 posts; at least 12–15 are directly relevant. Enumerated in this plan.
2. Delegate by *source type*, not by theme — this prevents agents from skipping primary sources in favor of easier-to-find secondary coverage.
3. Require direct quotes + URLs + dates in every finding. No summaries of summaries.
4. Each agent writes to a dedicated file in `research/sources/` so findings are auditable and I can cross-check.
5. Synthesize myself into `research/NOTES.md` after agents return — don't delegate synthesis.

## Source inventory to cover

### Anthropic engineering blog (primary)
Directly relevant posts to read in full:
- **Harness design for long-running application development** (2026-03-24) — GAN architecture
- **Effective harnesses for long-running agents** (2025-11-26) — likely predecessor
- **Claude Code: Best practices for agentic coding** (2025-04-18)
- **Building effective agents** (2024-12-19) — foundational taxonomy
- **How we built our multi-agent research system** (2025-06-13)
- **Effective context engineering for AI agents** (2025-09-29)
- **Demystifying evals for AI agents** (2026-01-09)
- **Equipping agents for the real world with Agent Skills** (2025-10-16)
- **Writing effective tools for agents — with agents** (2025-09-11)
- **Building a C compiler with a team of parallel Claudes** (2026-02-05)
- **Scaling Managed Agents: Decoupling the brain from the hands** (date TBD)
- **Code execution with MCP: Building more efficient agents** (2025-11-04)
- **Beyond permission prompts** (2025-10-20)
- **Claude Code auto mode** (2026-03-25)
- **Advanced tool use** (2025-11-24)

### Claude Code docs (primary)
- Skills authoring guide
- Subagents
- Hooks
- MCP integration
- Settings / permissions
- Agent SDK (critical — this is the primitive for building orchestration harnesses)
- Plan Mode
- Slash commands
- CLAUDE.md conventions

### Community practitioners (secondary but credible)
- Armin Ronacher: "Agentic Coding Recommendations", "Tools: Code Is All You Need", any 2026 follow-ups
- Simon Willison: "Agentic Engineering Patterns" substack series, best-practices coverage
- Geoffrey Huntley: Ralph loop, how-to-build-a-coding-agent
- Harper Reed: spec/plan/todo workflow post
- Hamel Husain: eval guides (LLM-as-judge, evals for LLMs)
- Peter Steinberger: "Essential Reading for Agentic Engineers"
- Shreya Shankar: SPADE, eval methodology
- Thoughtworks Radar v33/v34: techniques list
- Martin Fowler site comparative writeups (Spec Kit vs Kiro vs Tessl)

### Open-source repos to read at code level
- github/spec-kit (code and commands, not just README)
- Real GAN-style orchestrator implementations (search required)
- Multi-agent team-of-claudes implementations
- High-star claude-code templates / scaffolds
- Competing agent-tool scaffolds (Cursor, Aider, Codex, Cline)

### Eval methodology
- Anthropic's demystifying-evals post (in full)
- Hamel's eval guide ("Your AI Product Needs Evals", LLM-as-judge posts)
- Shreya Shankar: Who Validates the Validators, SPADE
- OpenAI evals framework
- Braintrust, Langfuse, Arize Phoenix — how the tooling shapes practice

## Workstreams (4 parallel agents)

### Agent A — Anthropic primary sources
Read every post in the engineering blog inventory above in full. Read Claude Code docs on Skills, Subagents, Hooks, MCP, Agent SDK, Plan Mode, Settings. Output: `research/sources/anthropic.md`.

Required format per post/doc:
- URL, date published/last updated
- 3–5 sentence summary
- Direct quotes of the load-bearing architectural claims
- Any concrete examples (code, prompts, config) shown in the post
- Connections to harness design

### Agent B — Community practitioners
Deep-read named authors above. Extract specific techniques, not vibes. Output: `research/sources/practitioners.md`.

Required format per author:
- URLs of specific posts read
- The author's actual position (not my summary of it)
- Where they disagree with Anthropic / with each other
- Concrete patterns they recommend, with quotes

### Agent C — Open-source harnesses & scaffolds (code-level)
Find actual implementations and read their code. Output: `research/sources/code-repos.md`.

Required format per repo:
- URL, stars, last commit date
- Directory structure
- What's in their CLAUDE.md / AGENTS.md / .claude/
- Any orchestration code (if present, read it and describe the loop)
- One honest line: is this useful reference, or hype?

### Agent D — Evals & verification
The GAN harness rests entirely on a good evaluator. Understand the state of the art. Output: `research/sources/evals.md`.

Required format:
- Primary sources on eval methodology
- LLM-as-judge: what works, what breaks
- Trajectory vs outcome evals
- How the Anthropic GAN harness constructed and tuned its evaluator (re-read that section carefully)
- Concrete patterns for evaluating agent-produced code (tests, typecheck, visual diff, runtime behavior)
- What can we put in the harness to make evaluation tractable by default?

## Synthesis (me)
After agents return:
1. Read all four `sources/*.md` files.
2. Update `research/NOTES.md` with:
   - Revised landscape (correcting pass-1 errors)
   - Architectural options with real tradeoffs from primary sources
   - Open questions for Ribhav, informed by the deeper material
3. Present findings to user for the real decision conversation.

## Non-goals
- Deciding the harness architecture in this pass (that's the user's call after research)
- Writing any harness code in this pass
- Exhaustive coverage of every agent framework — focus on patterns transferable to Claude Code
