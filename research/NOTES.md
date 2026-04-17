# Working Notes — Coding Harness Research (Synthesized)

Synthesis of the four workstreams in `sources/`. The goal is informed design discussion, not a finished plan.

---

## 1. The critical reframe: three layers, not two kinds

My first-pass dichotomy (project scaffold vs orchestration harness) was too coarse. The research exposes **three nested layers**, each building on the one below. You can ship any subset:

| Layer | What it is | Primitive | Canonical reference |
|---|---|---|---|
| **L1 — Project scaffold** | Files shaping a single Claude Code session | `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `.claude/settings.json` hooks | spec-kit, anthropics/skills |
| **L2 — In-session orchestration** | One session dispatches subagents with contracts | Task tool + subagent prompts + TodoWrite | `obra/superpowers/skills/subagent-driven-development/` |
| **L3 — Multi-session autonomous loop** | A program outside Claude Code drives multiple sessions | **Claude Agent SDK** (Python/TS) — `ClaudeSDKClient`, `AgentDefinition`, `HookMatcher` | `anthropics/riv2025-long-horizon-coding-agent-demo` |

L1 alone is what most "awesome-claude-code" template repos are. L1+L2 is what obra/superpowers demonstrates with the GAN-style generator-reviewer flow inside one session. L1+L2+L3 is the Anthropic GAN blog post made real — a Python process that spawns Claude sessions, persists state externally, uses Playwright as the ground-truth evaluator.

**Load-bearing discovery:** Anthropic shipped the L3 reference as open source at `anthropics/riv2025-long-horizon-coding-agent-demo` (1,866-line `claude_code.py`, Agent SDK). Low star count (~59), but it IS the code behind the blog post.

## 2. What the primary sources agree on (high confidence)

Across Anthropic's 16 engineering posts, the practitioner canon, and the serious OSS repos, a few claims appear over and over:

1. **Context is the scarce resource.** "The context window is the most important resource to manage" (Claude Code best practices). Context engineering is now on Thoughtworks Radar v34 as Adopt.
2. **Verification is the single highest-leverage investment.** "Include tests, screenshots, or expected outputs so Claude can check itself" (Anthropic). Superpowers' iron law: "No completion claims without fresh verification evidence."
3. **Separate generator from evaluator.** "Tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work." (GAN post, verbatim.)
4. **Context resets beat compaction for long tasks.** riv2025 treats `prompt_too_long` as "start fresh" and carries state via external files — not chat history.
5. **Hooks are the only deterministic layer.** Everything in CLAUDE.md / skills / subagent prompts is advisory. If it MUST happen, use a hook.
6. **Binary pass/fail > rubric scores.** Unanimous among Hamel, Shankar, and Anthropic's "demystifying evals" post. "What makes something a 3 versus a 4? Nobody knows."
7. **Model tiering by task.** Haiku for mechanical, Sonnet for integration, Opus for architecture/review. Confirmed in `claude-agent-sdk-demos`, superpowers, and the C-compiler case study.
8. **Harness complexity decays with model improvement.** Opus 4.5 needed sprint decomposition; Opus 4.6 removed the need. Every component encodes a model-capability assumption; audit them.
9. **Script-first rule.** Never have an LLM compute what a 20-line bash script can compute (ccpm, Ronacher).
10. **MCP minimalism.** Ronacher, Huntley, Steinberger all arrived here independently — CLIs + code execution beat MCP for most tool surfaces. Anthropic's own "Code execution with MCP" post (98.7% token reduction) agrees in effect.

## 3. What's actually contested

| Axis | Camp A | Camp B |
|---|---|---|
| **Specs** | Huntley (`@specs/`), Harper Reed (spec → plan → todo), Spec Kit | Steinberger ("just talk to it"), Scott Logic ("10x slowdown") |
| **Review rigor** | Hamel (eval is the whole game), Willison (TDD) | Steinberger ("I don't read much code anymore") |
| **Subagents** | Huntley (500 subagents), superpowers (Task-tool fan-out) | Ronacher (one job per agent), Steinberger (terminal grid of top-level CLIs) |
| **MCP** | Anthropic platform (Playwright MCP in GAN harness) | Ronacher / Huntley / Steinberger |
| **Autonomy** | Ralph loop, riv2025 (24/7 autonomous) | Willison (accountability; "vibe engineering") |

These are genuine disagreements among credible practitioners — the harness has to pick a position, or be explicit that position is configurable.

## 4. Ready-to-use components

Things that already exist and slot into a harness:

- **Claude Agent SDK** (`claude_agent_sdk` Python / `@anthropic/claude-agent-sdk` TS) — the L3 substrate. Don't hand-roll a tool loop.
- **`anthropics/riv2025-long-horizon-coding-agent-demo`** — L3 reference. Two-field state file, context-reset-on-prompt-too-long, Playwright evaluator, progress artifact.
- **`obra/superpowers/skills/subagent-driven-development/`** — L2 reference. Two-stage review (spec-compliance → code-quality).
- **`anthropics/skills/webapp-testing`** — bring-your-own browser evaluator. Tiny SKILL.md + `scripts/with_server.py` black box.
- **`hamelsmu/evals-skills`** — six skills (`eval-audit`, `error-analysis`, `write-judge-prompt`, `validate-evaluator`, `evaluate-rag`, `build-review-interface`). Hamel's evaluation playbook as Claude Skills.
- **`github/spec-kit`** — 9 slash commands for spec-driven flow. 30-agent integration registry (portable to Cursor/Codex/Aider/etc.).
- **`EveryInc/compound-engineering-plugin/agents/review/adversarial-reviewer.md`** — "chaos engineer" reviewer persona, verbatim-steal-worthy.
- **`trailofbits/skills/spec-to-code-compliance`** — security-minded spec compliance skill.
- **`automazeio/ccpm`** — `parallelization_factor` file-overlap analysis before spawning worktree agents.

## 5. The v1 menu (what to pick from)

Things to consider including, grouped by layer.

### L1 — Project scaffold (low cost, high portability)
- `AGENTS.md` as cross-agent source of truth, `CLAUDE.md` as thin Claude-specific add
- `.claude/skills/` with 3–5 high-value skills: verification-before-completion, writing-plans, executing-plans, red-green-tdd, webapp-testing
- `.claude/agents/` with an adversarial-reviewer and a spec-compliance-reviewer
- `.claude/commands/` for the spec→plan→tasks flow (optionally import from spec-kit)
- `.claude/settings.json` hook on `PreToolUse` or `Stop` that runs `make check`
- `Makefile` with `dev / test / lint / typecheck / check` as canonical entry points

### L2 — In-session orchestration (medium cost, high leverage)
- Subagent-driven-development controller (adapted from superpowers)
- Two-stage review: spec-compliance first, quality second
- Model tiering: Haiku for mechanical, Sonnet/Opus for review and planning
- TodoWrite as the task ledger
- Verification-before-completion as a hook-enforced gate
- Git worktrees for parallel subagents where conflicts matter

### L3 — Autonomous loop (high cost, high ambition)
- Python/TS program using Claude Agent SDK
- Two-field `agent_state.json` (desired vs current)
- `claude-progress.txt` as the persistent, never-deleted memory
- Context reset on `prompt_too_long` rather than compaction
- External evaluator: Playwright for web work, `pytest` + typecheck for library work
- Hard-threshold sprint contracts; evaluator-only write access to feature status
- Token budget + cost tracking exported for monitoring
- Sandbox via bubblewrap/seatbelt (or Docker for stronger isolation)

### Eval layer (needed for L2+L3, optional-but-recommended for L1)
- Deterministic gate: build + typecheck + lint + existing-tests-pass
- FAIL_TO_PASS / PASS_TO_PASS test signal
- Sprint contract artifact (generator proposes, evaluator approves, signed)
- Decomposed binary LLM-as-judge (one call per dimension, "Unknown" escape)
- Few-shot calibrated from ~20 hand-graded examples
- Transcript retention + a simple trace viewer
- Infrastructure provenance log per trial

## 6. Cost/ambition matrix

| Shape | Build effort | Per-run cost | When it pays off |
|---|---|---|---|
| L1 only | 1 day | $-$ | Every project. Strictly better than bare `/init`. |
| L1 + L2 | 1 week | $$ | Features ≥ 1 day of human work. Obvious payoff. |
| L1 + L2 + L3 | 2–4 weeks for a reusable core | $$$$ | Greenfield apps, autonomous long-running work. 20× cost for 5–10× quality only when quality matters more than speed. |

GAN-style L3 costs were $200 / 6 hours for a retro game maker (20× vs solo) and $124 / 3h50 for a DAW (C compiler case study: ~$20K over two weeks). Rule of thumb: L3 pays off when either (a) the task is genuinely long-horizon (hours+) or (b) the quality bar is high enough that 20× is cheap.

## 7. Unresolved questions for decision

In priority order:

1. **Layer ambition**: L1 only? L1+L2? Full L1+L2+L3? Each layer is additive, but L3 is a serious engineering project of its own.
2. **Portability**: cross-agent (`AGENTS.md` + spec-kit-style multi-integration) or Claude-only?
3. **Specs stance**: full spec-kit flow, Harper-style trio, or Steinberger-style "just talk to it"?
4. **Distribution**: copy-per-project vs git submodule vs plugin (Claude Code 2.0 plugin format)?
5. **Language coupling**: language-agnostic skeleton vs per-language flavors (Go/Python/TS)?
6. **Evaluator depth**: deterministic gates only (fast) vs judges + Playwright (slow, expensive, harder to tune)?
7. **Starting scope for v1**: MVP = the scaffold + three skills + one hook; or ship L2 controller from day one?
8. **Reusability target**: your personal workflow, team-internal, or open-source release candidate?

## 8. My recommendation (to react to, not to accept)

**Build L1+L2 as a reusable template repo; defer L3 until you have a concrete project that needs it.**

- **Concrete v1**: `AGENTS.md` (portable) + thin `CLAUDE.md` (Claude-specific) + `.claude/skills/{verification-before-completion, red-green-tdd, writing-plans, webapp-testing}` + `.claude/agents/{adversarial-reviewer, spec-compliance-reviewer}` + `.claude/commands/` seeded from spec-kit + `.claude/settings.json` with a `PostToolUse` hook running `make check` on edits + a `Makefile` with canonical targets.
- **L2 controller**: adapt `obra/superpowers/skills/subagent-driven-development/` — an implementer → spec-reviewer → quality-reviewer loop using the Task tool. Model tiering baked in.
- **Evals**: adopt `hamelsmu/evals-skills` wholesale. Don't build your own.
- **Distribution**: copy-per-project initially (simplest). Reconsider plugin format after two projects.
- **L3**: only when you have a real autonomous task. Then vendor-in the riv2025 structure; don't rebuild from scratch.

This gets you 80% of the value for maybe 10% of the build effort of a full L3 harness, and the 80% compounds with every project you use it on.

## 9. Biggest things still uncertain / worth flagging

- Some GAN-post specifics (exact rubric thresholds, exact few-shot counts) are paraphrased from narrative — not verbatim. Flagged in `sources/evals.md`.
- `obra/superpowers` and `affaan-m/everything-claude-code` have anomalously high star counts for their age. Noted but not fully explained.
- Claude Code 2.x plugin format maturity is unclear from research; might be worth confirming before picking distribution mechanism.
- The Fowler-hosted "Harness Engineering" piece by Böckeler is cited by practitioners as foundational but I haven't quoted it in depth — could be worth a deeper read before locking in a position.
