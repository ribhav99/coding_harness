# Open-Source Coding Harnesses & Agent Frameworks — Adoption Research

**Target case:** an individual developer who wants a reusable coding harness to drop into personal projects.
**Research date:** 2026-04-17. All GitHub stats pulled from the GitHub REST API on this date; citations link to the specific issues, commits, or files referenced.

The evaluation focuses on **where projects actually fail in practice** — real-world pain, maintenance health, and integration cost. Marketing-page claims are ignored. Stats are normalized (commits-in-last-4-weeks uses GitHub's `stats/participation` endpoint; PR counts come from pagination `Link` headers on `/pulls?state=open`).

---

## 1. OpenHands (formerly OpenDevin)

- **URL:** https://github.com/All-Hands-AI/OpenHands
- **Stars:** 71,381 · **Forks:** 8,976 · **Open PRs:** 207 · **Closed PRs:** 9,503 · **Open issues:** ~428 · **Last commit:** 2026-04-17 (same-day) · **Language:** Python · **License:** MIT · **Created:** 2024-03-13
- **One-line positioning:** Full-stack autonomous coding agent — web UI, Docker/K8s runtimes, cloud offering, bug-fix-my-repo integration.

### Strengths
- **Runtime isolation is a first-class concern.** Every conversation spawns a Dockerized sandbox; K8s and cloud sandboxes exist as first-party options. Few other projects in this list even ship a sandbox abstraction.
- **Commercially backed with real engineering throughput.** 468 contributors, 190 commits in the last 4 weeks, top non-bot contributor `xingyaoww` has 613 commits. All Hands AI (the company) employs several core contributors — not a one-person hobby. See https://openhands.dev/blog/one-year-of-openhands-a-journey-of-open-source-ai-development.
- **Competitive on SWE-bench** and now ships a self-improving PR-review bot loop (many recent closed issues carry `openhands-ai[bot]` auto-PRs).
- **MCP + ACP support.** https://github.com/All-Hands-AI/OpenHands/issues/13991 shows first-class ACP tool-call rendering in the UI.

### Failure modes
- **Runtime startup is a well-documented wall.** Containers take 30–60s per new session; through the front-end, even `npm i` can take 2+ minutes when it takes seconds in the underlying Docker. See https://github.com/OpenHands/OpenHands/issues/8555 and https://github.com/OpenHands/OpenHands/issues/6259.
- **Chown storms on SWE-bench eval.** Recursive chown on `/openhands/poetry`, `/openhands/workspace`, `/openhands/micromamba` can take ~41 minutes on overlay2 — a real blocker for anyone trying to reproduce eval numbers. https://github.com/OpenHands/OpenHands/issues/12043.
- **Runtime-container communication flakiness.** https://github.com/OpenHands/OpenHands/issues/11188 (`openhands serve` hangs at "starting runtime" even when container is up), https://github.com/OpenHands/OpenHands/issues/9753 ("cannot connect runtime").
- **Self-cannibalizing port conflicts.** https://github.com/OpenHands/OpenHands/issues/13927 — OpenHands kills its own process on port 8000 during local web deployment.
- **Heavy dep graph.** The `pyproject.toml` main dependencies list includes `anthropic[vertex]`, `boto3`, `browsergym-core==0.13.3`, `docker`, `fastmcp`, `google-api-python-client`, `google-cloud-aiplatform`, `google-genai`, `kubernetes>=33.1`, `libtmux`, `litellm`, `mcp`, `playwright`, `pexpect`, three pinned `openhands-*` first-party packages, plus OpenAI/Anthropic/LiteLLM. `python>=3.12,<3.14` — if your target env is 3.11 or 3.14+, you're blocked.
- **Settings-UX regressions keep landing.** Bug cluster on 2026-04-16/17 alone: MCP settings lost on LLM save (#13975), Tavily settings reset between modes (#13969), Verification basic/advanced are identical (#13971), layout alignment broken (#13982), provider-detection broken for LM Studio (#13948). These are same-day freshly-opened issues — a useful snapshot of what "using OpenHands today" feels like.
- **Loop bugs on infra-local setups.** https://github.com/OpenHands/OpenHands/issues/13949 — infinite retry loop on invalid tool calls with llama-server.

### Maintenance health
Excellent on throughput (9,503 closed PRs, same-day active), but **207 open PRs** and rapidly-accumulating bug labels suggest the team ships faster than it fixes. Top contributor is `dependabot`, which is a positive signal (dep hygiene automated). Bus factor low (real company backing). 428 open issues is moderate for a ~70k-star repo.

### Integration cost: **4/5 (major commitment)**
You don't integrate OpenHands — you either run it as a product or you fork the whole thing. It is not designed to be "embedded as a harness" in your own project. The UI, runtime, agent loop, and tool definitions are tightly coupled. If you want *just the agent loop*, you'll want `openhands-sdk` (separate package) instead of the monorepo.

### Lock-in severity: **High**
Your conversation state, event logs, and runtime abstractions are all OpenHands-specific. Moving off means re-implementing the sandbox abstraction.

### Who should NOT use it
Anyone who wants a library to embed. Anyone on Python <3.12 or >3.13. Anyone who can't afford 30–60s startup latency per session. Anyone on Windows native (Docker runtime explicitly not supported there — https://github.com/OpenHands/OpenHands/issues/9806).

---

## 2. SWE-agent + SWE-ReX

- **SWE-agent URL:** https://github.com/SWE-agent/SWE-agent
- **SWE-agent stats:** 19,000 stars · 16 open PRs · 750 closed PRs · 44 open issues · Last commit 2026-03-24 · Python · MIT · Created 2024-04-02
- **SWE-ReX URL:** https://github.com/SWE-agent/SWE-ReX
- **SWE-ReX stats:** 483 stars · 10 open PRs · 183 closed PRs · 45 open issues · Last commit 2026-03-02 · Python · MIT
- **One-line positioning:** Academic-origin agent-computer-interface (ACI) for SWE-bench-style tasks; SWE-ReX is the sandboxed-execution backend spun out of it.

### Strengths
- **Cleanest mental model in the field.** An "agent" is a prompt template + tool bundle + parser. SWE-ReX is an orthogonal sandbox-execution library. The decoupling is something other projects wish they had.
- **Proven benchmark pedigree.** NeurIPS 2024 paper; `mini-swe-agent` (100-line variant) scores >74% on SWE-bench Verified — proves the harness is not doing the heavy lifting.
- **Massively parallel execution.** SWE-ReX is explicitly designed for running thousands of agent rollouts on Modal/AWS — the best-in-class option if you want to do evals.
- **SWE-ReX is the right abstraction.** Local/Docker/Modal/Fargate/AWS/Daytona — single interface. Other projects (OpenHands, Goose) have reinvented worse versions of this.

### Failure modes
- **Cadence has collapsed.** **2 commits in the last 4 weeks** on SWE-agent, **0 on SWE-ReX**. Top contributor `klieret` has 1,539 commits (SWE-agent) and 246 (SWE-ReX) — bus-factor-of-one. Core academics (Ofir Press, Kilian Lieret) are visibly slowing.
- **Python-version mismatch bugs haunt long-tail images.** https://github.com/SWE-agent/SWE-agent/issues/1313 — SWE-bench Docker images use Python 3.5 so `edit_anthropic` tool can't run at all. Partial fix discussed but never carried through — maintainer literally says "we never quite carried this through" on 2026-02-10.
- **SWE-ReX version-skew footgun.** Two versions of SWE-ReX coexist — one on host, one installed into container at runtime — and nothing guarantees they match. https://github.com/SWE-agent/SWE-ReX/issues/232. A contributor's open question from 2025-09-28 is still unresolved.
- **DockerDeployment blows up under asyncio.gather.** https://github.com/SWE-agent/SWE-ReX/issues/261 — parallel deployment (the whole point of SWE-ReX) has a race condition.
- **Interactive commands fundamentally broken.** https://github.com/SWE-agent/SWE-ReX/issues/287 — wrong output when interacting with Python; the shell env doesn't play well with `less`, `vim`, etc.
- **Permissions bug in Fargate deployment unfixed since Sep 2025.** https://github.com/SWE-agent/SWE-ReX/issues/258 — fix-PR #260 exists, contributor has been pinging for 7 months with no merge.
- **Setup cost for a new user is real.** SWE-bench eval needs 120GB free disk + 16GB RAM + custom Docker images with Node/npm/swe-rex runtime pre-installed (per https://search.feep.dev/blog/post/2025-04-05-swe-agent).

### Maintenance health
Worrying. SWE-agent has slowed to 2 commits/4 weeks; SWE-ReX is functionally stalled at 0. Open PRs trickle (16 and 10 respectively), but the bus factor is extreme. The project feels like it's being handed off back to the academic-paper artifact state. 44+45 open issues is small only because users have given up filing them.

### Integration cost: **3/5**
SWE-ReX as *just a sandbox runtime*: drop-in-ish — the API is clean, `BashAction` / `BashObservation` / `Command` style. Good choice if all you want is "give me a container, let me exec commands, let me grab files." SWE-agent-as-harness: harder — it's tightly coupled to the YAML-config ACI and prompt template system, and adding new tool categories means writing tools-in-a-DSL that only SWE-agent understands.

### Lock-in severity: **Medium (SWE-ReX alone), Low-Medium (SWE-agent)**
SWE-ReX's sandbox abstraction is replaceable (the API is small). SWE-agent's tool-DSL and config system are not — but since it's so small and mostly-inactive, forking is a legitimate option.

### Who should NOT use it
Anyone who needs a long-term-maintained product. Anyone whose task is interactive (Python REPL, `less`, `vim`) rather than batch. Anyone who wants a rich UI.

---

## 3. LangGraph Deep Agents

- **URL:** https://github.com/langchain-ai/deepagents
- **Stars:** 21,058 · **Open PRs:** 88 · **Closed PRs:** 1,996 · **Open issues:** 231 · **Last commit:** 2026-04-17 · **Python** · **MIT** · **Created 2025-07-27**
- **One-line positioning:** An opinionated LangGraph-based harness with planning, subagents, virtual filesystem, middleware — LangChain's bet on "agent as harness plus model".

### Strengths
- **Dominant commit cadence.** **415 commits in the last 4 weeks** — by an order of magnitude, the most active project on this list. Top contributor `mdrxy` has 647 commits; team of ~6 LangChain employees visibly engaged daily.
- **Harness engineering is first-class.** LangChain explicitly calls out that tweaking the harness (not the model) raised Terminal Bench 2.0 scores by 13.7 points. https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
- **Planning tool + virtual FS + subagent isolation out of the box.** The exact abstractions you'd rebuild for a personal harness.
- **Middleware pattern is the extension story.** Unlike OpenHands' monorepo, deepagents lets you add behavior hooks cleanly (`@after_agent`, `@before_tool`).

### Failure modes
- **Subagent state leaks into the parent thread on interruption.** https://github.com/langchain-ai/deepagents/issues/2781 — a careful external contributor traced the bug to `runtime.config` being passed unmodified to `subagent.ainvoke`, corrupting the parent's checkpoint on any interrupt. Opened 2026-04-17; unfixed at time of writing.
- **ACP dependency broke silently on a minor version bump.** https://github.com/langchain-ai/deepagents/issues/2678 — `agent-client-protocol` 0.9.0 removed `SessionConfigOption`; deepagents pinned `>=0.8.0` with no upper bound, so fresh installs started failing with a misleading "ACP dependencies not available" error. A contributor diagnosed it in detail.
- **Provider bundler is incomplete.** https://github.com/langchain-ai/deepagents/issues/2663 — Together AI not registered in the deploy bundler; `/offload` fails with non-OpenAI providers (https://github.com/langchain-ai/deepagents/issues/2741).
- **Middleware gap: can't customize built-in middleware settings.** https://github.com/langchain-ai/deepagents/issues/2784 — e.g. `FilesystemMiddleware.tool_token_limit_before_evict` is not exposed. So "batteries-included" hits a ceiling for customization.
- **Custom middleware doesn't propagate to general-purpose subagent.** https://github.com/langchain-ai/deepagents/issues/2744 — this is a deep architectural wart: your custom policy middleware doesn't protect subagents.
- **ripgrep glob mismatch with directory components.** https://github.com/langchain-ai/deepagents/issues/2732 — silently matches nothing for `src/foo/**`. Agents that rely on glob search silently fail.
- **LangChain lock-in is real.** Deps: `langchain-core>=1.2.27,<2`, `langchain>=1.2.15,<2`, `langchain-anthropic>=1.4`, `langchain-google-genai>=4.2` — LangChain v1 ecosystem only. On a LangChain major breaking change, you move when they move.
- **HN criticism: overcomplication.** Discourse consistently says "this doesn't introduce anything fundamentally new" and that LangChain over-abstracts. Legitimate concern if you're building your own harness — the abstractions may be the opposite of what you want.
- **Pre-1.0 API volatility.** At 0.5.3 with 88 open PRs and 231 open issues on an 8-month-old project — expect breaking changes.

### Maintenance health
**The healthiest project on this list for day-to-day cadence.** 415 commits last 4 weeks, LangChain-employed maintainers (`mdrxy`, `ccurme`, `eyurtsev`, `jacoblee93`) actively triage, strong external contributor flow. The risk is the opposite of Plandex — it's moving so fast that stability across upgrades is a concern.

### Integration cost: **3/5**
Easy to drop in if you're already in LangChain land. Hard to drop in otherwise — the paradigm is LangGraph graphs + LangChain message types, not POJOs. If your project uses a different LLM client, you inherit LangChain's wrapper layer.

### Lock-in severity: **High**
This is the most locked-in option per kg of adopted code. Your state schemas, middleware hooks, checkpointers, config objects, message types all come from LangChain-specific libraries. Migrating off = re-implementing the harness.

### Who should NOT use it
Anyone allergic to LangChain. Anyone who wants a stable API. Anyone whose project isn't in Python.

---

## 4. Open SWE

- **URL:** https://github.com/langchain-ai/open-swe
- **Stars:** 9,575 · **Open PRs:** 68 · **Closed PRs:** 765 · **Open issues:** 77 · **Last commit:** 2026-04-17 · **Primary language:** Python (multi-language monorepo) · **MIT** · **Created 2025-05-21**
- **One-line positioning:** LangChain's asynchronous, GitHub-integrated coding agent — think "competitor to OpenHands + Copilot workspace."

### Strengths
- **Opinionated GitHub integration.** First-class bot that takes an issue, plans, sandboxes, writes a PR, comments back.
- **LangGraph-native** — inherits the same middleware/streaming story as Deep Agents.
- **41 commits in the last 4 weeks**, top contributor `bracesproul` 348 commits — real team ownership. 18 contributors, small and coherent.
- **Sandbox is Daytona by default** — offloads the sandbox operational pain that kills OpenHands users.

### Failure modes
- **Stability with Daytona reported as rough.** https://github.com/langchain-ai/open-swe/issues/1180 — "OPEN-SWE stability with Daytona sandboxes" is an open concern.
- **Stale SANDBOX_CREATING sentinel causes indefinite timeout after server restart.** https://github.com/langchain-ai/open-swe/issues/1116 — classic orphaned-state bug.
- **Security issue: SSRF protection bypass via DNS rebinding in `http_request.py`.** https://github.com/langchain-ai/open-swe/issues/1186 — open.
- **Non-Anthropic models skip the final `github_comment` tool call.** https://github.com/langchain-ai/open-swe/issues/1118 — breaks the whole workflow for anyone not using Claude. Middleware workaround proposed by external contributor but not merged.
- **GitLab support is a feature request, not shipped.** https://github.com/langchain-ai/open-swe/issues/1074 — so your mono-Git-host lock-in is real.
- **Spam issue: off-topic "I built an unrelated tool" comments.** https://github.com/langchain-ai/open-swe/issues/1115 — an engagement-farming link chain inside a serious bug discussion. Minor signal of low moderation attention.

### Maintenance health
Solid. Single-company backed, active, but small contributor pool (18) means a couple of resignations would hurt. 68 open PRs on a ~1-year-old project is healthy, not stagnant.

### Integration cost: **3/5** if your workflow is GitHub-centric, **5/5** if it isn't
Fundamentally designed around "GitHub issue → PR"; adapting it to non-GitHub environments is a full rewrite of the source abstraction.

### Lock-in severity: **High on GitHub, Medium on LangGraph**
If you want to stop using Open SWE but keep your workflows, you're re-implementing everything.

### Who should NOT use it
Anyone not on GitHub. Anyone who needs a library, not a "put-this-on-your-server" service. Anyone using primarily non-Anthropic models.

---

## 5. Plandex

- **URL:** https://github.com/plandex-ai/plandex
- **Stars:** 15,247 · **Open PRs:** 16 · **Closed PRs:** 65 · **Open issues:** 53 · **Last commit:** 2025-10-03 · **Go** · **MIT** · **Created 2023-10-24**
- **One-line positioning:** CLI-first, plan-oriented coding agent in Go, designed for larger projects than Aider.

### Strengths
- **Only mature Go option on this list.** If your infra is Go, the blast radius of adopting Plandex is smaller than the Python alternatives.
- **Plan-oriented architecture** — explicit plan/branch/stash concepts, unusual in this landscape.
- **Sandboxed file edits with review step** — safer-by-default than most.

### Failure modes
- **Project is dormant.** **Last commit 2025-10-03 — 6.5 months stale** as of 2026-04-17. **0 commits in the last 4 weeks.** The top contributor `danenania` (Dane Schneider, founder) has 821 commits; the #2 contributor has 23.
- **Critical nil-pointer panics in the server when LLM responses fail.** https://github.com/plandex-ai/plandex/issues/304 and https://github.com/plandex-ai/plandex/issues/339 — documented stack traces showing `panic: runtime error: invalid memory address or nil pointer dereference` from `loadTellPlan`. https://github.com/plandex-ai/plandex/issues/337 is an explicit request to "replace panic() with error returns in model validation init" — open, unaddressed.
- **Tmux detection is broken.** https://github.com/plandex-ai/plandex/issues/320 — "Unsupported terminal" inside tmux, an extremely common setup.
- **Docker compose: Ollama-only.** https://github.com/plandex-ai/plandex/issues/321 — not actually a portable containerized deployment.
- **Known blockers since August 2025 never resolved.** https://github.com/plandex-ai/plandex/issues/294 — listed blockers: no parallel agents, no multi-repo support. Workarounds via shell scripts exist in comments; nothing upstream.
- **Model pack `\set-model google` is a mandatory workaround for large-context tasks.** https://github.com/plandex-ai/plandex/issues/89 (still open).

### Maintenance health
**Effectively abandoned as an OSS project** as of this research date. If the founder returns it might revive, but adoption is betting on a revival. 15k stars is mostly historical momentum.

### Integration cost: **2/5** for "use it as-is", **5/5** for "keep it alive as a fork"
The CLI is simple. Forking a Go project is easier than forking a Python megarepo. But the code quality issues (panic-in-production) mean maintaining your fork costs more than you'd expect.

### Lock-in severity: **Low**
Because Plandex is CLI-only and session-scoped, swapping it out is straightforward. Worst case, you keep using it until it breaks.

### Who should NOT use it
Anyone who needs a supported project. Anyone who can't tolerate server panics. Anyone using tmux. Anyone wanting multi-repo or parallel-agent support.

---

## 6. Aider

- **URL:** https://github.com/Aider-AI/aider
- **Stars:** 43,481 · **Open PRs:** 284 · **Closed PRs:** 650 · **Open issues:** 1,486 · **Last commit:** 2026-04-09 · **Python** · **Apache-2.0** · **Created 2023-05-09**
- **One-line positioning:** The benchmark terminal-based AI pair programmer. Included here for *reference* — it is interactive, not a headless harness.

### Strengths
- **Best SOTA-tracking** — Aider publishes the polyglot benchmark that labs now target.
- **Conservative, edit-review-friendly UX.** Its diff-based edit prompting pattern is the gold standard. The `/architect` + `/code` split (two-model workflow) is something most harnesses don't replicate.
- **Broad model support** via LiteLLM.

### Failure modes
- **Single-maintainer bus factor is extreme.** `paul-gauthier` has **12,634 commits**; the #2 contributor has **47**. **1 commit in the last 4 weeks.** Cadence has visibly slowed in early 2026 — the commit log shows Paul batching releases weekly-or-longer rather than daily.
- **Issue pile is an unmanaged 1,486-deep backlog.** A huge fraction are auto-filed "Uncaught X in file.py line N" crash reports: https://github.com/Aider-AI/aider/issues/4957, https://github.com/Aider-AI/aider/issues/4958, https://github.com/Aider-AI/aider/issues/4962, https://github.com/Aider-AI/aider/issues/4976, https://github.com/Aider-AI/aider/issues/4988, https://github.com/Aider-AI/aider/issues/5029, https://github.com/Aider-AI/aider/issues/5038 — opened over recent weeks, zero comments, no triage. This means a large class of bugs is being auto-reported and silently ignored.
- **`ANY_GIT_ERROR` silently catches programming bugs.** https://github.com/Aider-AI/aider/issues/5008 — `TypeError`/`AttributeError` hidden by over-broad exception handler, so real bugs look like git issues.
- **Not a harness.** It's an interactive CLI. Embedding Aider into your own program means shelling out or consuming internal classes. Not designed for automation.
- **Install friction on Alpine.** https://github.com/Aider-AI/aider/issues/4949 — broken on Alpine + virtual Python env, reported fresh.
- **Provider semantics broken.** https://github.com/Aider-AI/aider/issues/4955 — aider doesn't ignore API key when using custom OpenAI provider from LiteLLM.

### Maintenance health
**Single-maintainer slowdown is the defining recent trend.** The project is not abandoned but is visibly constrained by Paul's time. 284 open PRs with only 650 total closed is a red flag — means most external contribution is not being merged. Issue autofile flood makes the issue tracker un-usable as a priority signal.

### Integration cost: **2/5** if used as-is; **5/5** as embeddable library
Great out-of-the-box product. Terrible library — internals are not a stable API.

### Lock-in severity: **Low** (you can stop using Aider anytime)
Your edits are in git, your config is a YAML file, swap days are cheap.

### Who should NOT use it
Anyone wanting headless automation. Anyone wanting to embed it in a larger system. Anyone whose workflow needs rapid bug-fix cadence from maintainers.

---

## 7. Goose (by Block)

- **URL:** https://github.com/block/goose
- **Stars:** 42,438 · **Open PRs:** 95 · **Closed PRs:** 6,205 · **Open issues:** 340 · **Last commit:** 2026-04-17 · **Rust** · **Apache-2.0** · **Created 2024-08-23**
- **One-line positioning:** Rust-native, MCP-first terminal AI agent; Block employees + 435 contributors.

### Strengths
- **Massive maintenance engine.** 259 commits in last 4 weeks, 435 contributors, top contributor 255 commits — **no single-point-of-failure**. Compare to Aider (12,634 / 47) or Plandex (821 / 23). Goose is the most distributed project on this list by far.
- **MCP-first.** Clean integration story for external tools; MCP Apps inline rendering is actively being built (https://github.com/block/goose/issues/8591, #8593, #8594).
- **Rust = single-binary distribution, no Python dep hell.** This is the real distribution-cost win.
- **Goose2 is a platform** — ACP websocket bridge, summon/skills architecture.

### Failure modes
- **Custom OpenAI-compatible providers break silently.** https://github.com/block/goose/issues/8517 — URL parsing bug where paths like `zen/go/v1` don't get `/chat/completions` appended, producing a confusing "empty URL" 404. A commenter traced it in detail; fix not merged as of this date.
- **Nix flake broken.** https://github.com/block/goose/issues/8514 — git-dependency checksum hashes missing in Cargo.lock; OTel crates declared as git deps despite being on crates.io.
- **macOS Metal runtime break.** https://github.com/block/goose/issues/8548 — "Symbol not found: _OBJC_CLASS_$_MTLResidencySetDescriptor" — crash on some macOS versions.
- **Goose2 websocket bridge has an auth gap.** https://github.com/block/goose/issues/8601 — no client-auth gate on the localhost ACP bridge. Security concern that's non-trivial on a shared dev machine.
- **Skills discovery platform-specific bugs.** https://github.com/block/goose/issues/8552 — detects project skills but not user-level skills on Windows.
- **Chain-of-thought leakage and UX complaints.** https://github.com/block/goose/issues/8590 and https://github.com/block/goose/issues/8551 — thinking messages don't collapse on Mac.
- **MCP elicitation doesn't work with custom MCP servers.** https://github.com/block/goose/issues/8531 — fundamental MCP feature broken with non-default servers.
- **Learning curve gripe is real.** Community reports say Goose "requires more setup effort" and isn't "zero-config, plug-and-play." If you want something to *just work*, Claude Code / Cursor will feel easier.

### Maintenance health
**Best-in-class.** Block employees + real OSS community. 6,205 closed PRs. The corporate backer has strategic interest (Block uses Goose internally). Open-issue count is proportional to usage, not to neglect.

### Integration cost: **3/5** if you're OK with Rust; **5/5** if you want Python
You can't `pip install` it into your Python project. You either run Goose's binary or you fork Rust source. However, its MCP stance means extending *via tools* is very cheap.

### Lock-in severity: **Low to Medium**
Because Goose leans on MCP (an external standard), tools/skills you build can be reused with other MCP-compatible hosts (Claude Desktop, Claude Code). That's portability by construction. The Goose-specific part is the UX and runtime coordination.

### Who should NOT use it
Python-only shops that want a library. Users who want one-command install on Windows without friction. Anyone who wants "batteries included" with zero configuration.

---

## 8. MetaGPT

- **URL:** https://github.com/FoundationAgents/MetaGPT
- **Stars:** 67,173 · **Open PRs:** 91 · **Closed PRs:** 940 · **Open issues:** 119 · **Last commit:** 2026-01-21 · **Python** · **MIT** · **Created 2023-06-30**
- **One-line positioning:** Multi-agent "AI software company" simulation. A research-y, SOP-driven framework.

### Strengths
- **Well-documented research concept** — the "SOP over a team of specialized roles" model is genuinely interesting.
- **Still the canonical academic reference** for multi-agent software engineering from China/THU circles.

### Failure modes
- **Nearly dead.** **Last commit 2026-01-21 — 3 months ago.** **0 commits in last 4 weeks.** Commit log shows `better629` and a few authors pushing in bursts of months apart.
- **Core bug: incremental mode crashes on `with_srcs first` ValueError.** https://github.com/FoundationAgents/MetaGPT/issues/2007 — opened 2026-04, users diagnosing it themselves.
- **Issue tracker is overrun with crypto/AI-safety spam.** https://github.com/FoundationAgents/MetaGPT/issues/1990 ("claim your agent on AgentFolio"), https://github.com/FoundationAgents/MetaGPT/issues/1994 (bizarre "hardware verification gate" thread), https://github.com/FoundationAgents/MetaGPT/issues/2001 (clear LLM-generated "0x42-HERMES handshake" ARG spam). Thread policing is effectively zero — a signal the maintainers are not watching.
- **Heavy framework coupling.** The Role/SOP/Action tree is the whole programming model. If you don't want that, there's nothing to extract.

### Maintenance health
Low. Single-digit bus factor, concentrated maintainership (`better629`, `geekan`), long gaps between commits. The project doesn't communicate a clear future.

### Integration cost: **4/5**
You buy into the SOP paradigm or you write your own.

### Lock-in severity: **High**
Your code is written in MetaGPT's DSL.

### Who should NOT use it
Essentially anyone building something they need to ship in 2026. Valuable as a read of how 2023-era multi-agent frameworks thought; not valuable as infrastructure.

---

## 9. Continue.dev

- **URL:** https://github.com/continuedev/continue
- **Stars:** 32,617 · **Open PRs:** 124 · **Closed PRs:** 5,267 · **Open issues:** 581 · **Last commit:** 2026-04-17 · **TypeScript** · **Apache-2.0** · **Created 2023-05-24**
- **One-line positioning:** IDE-extension autocomplete + chat + agent; also ships a CLI. Tagline has pivoted to "source-controlled AI checks, enforceable in CI."

### Strengths
- **Strong IDE integration** (VS Code, JetBrains). Real UX polish.
- **Active, company-backed.** 507 contributors, 119 commits last 4 weeks, top contributor `sestinj` with 9,634 commits (founder) but three other contributors have 1,000+ — better distribution than Aider.
- **Repo is pivoting toward CI-enforceable rules** — if your use case is "apply coding rules to every PR," Continue is uniquely positioned.

### Failure modes
- **Chat tool-calling broken for most open-weights models.** https://github.com/continuedev/continue/issues/12131 — Qwen 3.5 and Gemma 4 can't call tools. Commenters report workaround for Qwen, nothing for Gemma; maintainers silent in thread. This is a core product function failing for a big user segment.
- **Workspace focus-steal bug.** https://github.com/continuedev/continue/issues/12088 — keyboard input jumps to editor while user is typing in chat during agent edits.
- **Docker-in-VS Code terminal capture broken.** https://github.com/continuedev/continue/issues/12102.
- **Extension host unexpectedly terminates.** https://github.com/continuedev/continue/issues/12149 — a random crash that shows up in fresh issues.
- **CSS fails to load on Firefox v149 in code-server.** https://github.com/continuedev/continue/issues/12135.
- **Issue tracker has spam farms.** Duplicate "Integration: PaperClaw" spam twice in the top results (#12152, #12160). Same phenomenon as MetaGPT — not as extreme but real.
- **Rapid product repositioning.** "Source-controlled AI checks enforceable in CI" vs. "AI pair programming in your IDE" — the project has strategic churn. Don't assume the thing you adopt today is the thing they'll be pushing in 12 months.

### Maintenance health
Good. Company-backed (Continue.dev raised funding), active, diverse enough contributor base.

### Integration cost: **5/5** as a library; **1/5** as a VS Code extension user
Continue is **not** meant to be a library. It's a product. If you want to embed it, you're forking. If you just want to use it in your editor, one-click install.

### Lock-in severity: **Low (as product), High (as embedded library)**
Configuration is YAML; data stays in your repo.

### Who should NOT use it
Developers building headless/CI harnesses. People who prefer terminal-based workflows. Open-weights-only shops running Qwen/Gemma/Ollama for chat tool-calling.

---

## 10. CrewAI

- **URL:** https://github.com/crewAIInc/crewAI
- **Stars:** 49,088 · **Open PRs:** 449 · **Closed PRs:** 2,843 · **Open issues:** 529 · **Last commit:** 2026-04-17 · **Python** · **MIT** · **Created 2023-10-27**
- **One-line positioning:** Role-play multi-agent framework. "Create a crew of agents, give them roles and tasks."

### Strengths
- **Quick onboarding ramp.** Low ceremony to write "a researcher + a writer + a reviewer."
- **287 contributors, 209 commits last 4 weeks, company-backed** (CrewAI Inc.).
- **Real production adoption** (enterprise users in the wild).

### Failure modes
- **Post-v1.0 async performance regression.** https://github.com/crewAIInc/crewAI/issues/5230 — users report that `kickoff_async()` / `akickoff()` throughput has collapsed vs. pre-1.0; synchronous LLM calls are being invoked from async paths in `_export_output` / converter. PR in progress from external contributor; fix not merged.
- **`output_pydantic` leaks into tool-calling loop, breaks non-OpenAI LLMs.** https://github.com/crewAIInc/crewAI/issues/5472 — design flaw where response_format and tools share the same call; breaks on vLLM, Gemini, Cohere, Mistral.
- **`base_url` silently discarded.** https://github.com/crewAIInc/crewAI/issues/5204 — `_create_instructor_client()` ignores `base_url` from the LLM config, breaking all OpenAI-compatible local endpoints (Ollama, LM Studio, vLLM). Commenter: "Such a critical bug. Unable to use crewai." Fix PR exists, not merged 2+ weeks later.
- **CrewAI 1.12.2 literally uninstallable on Intel Macs.** https://github.com/crewAIInc/crewAI/issues/5327 — mandatory lancedb dep has no macOS x86_64 wheels; users stuck on 1.9.3 and miss 10 weeks of security patches including the project's own CVEs.
- **Security: 1.13.0 pins vulnerable uv 0.9.30 (GHSA-pjjw-68hj-v9mw).** https://github.com/crewAIInc/crewAI/issues/5520.
- **Module-import blocking LLM call crashes containers.** https://github.com/crewAIInc/crewAI/issues/5510 — `ChatWithCrewFlow.__init__` makes a blocking LLM call at import time; any LLM hiccup crashes container startup.
- **Tool bugs shipped broken.** https://github.com/crewAIInc/crewAI/issues/5269 — BrightData SERP tool uses *JavaScript template syntax* in Python f-strings, breaking all search queries. A three-character fix open.
- **449 open PRs** — a huge review backlog. Users visibly begging for review (https://github.com/crewAIInc/crewAI/issues/5202 — "Hello Reviewers, Sorry for tagging like this but I'm not sure how to communicate this").
- **Issue tracker has aggressive SEO spam** (`meridianmindx`, `Aigen-Protocol`, `Jairooh`, etc. dropping unrelated product links into threads — see any top-commented issue).

### Maintenance health
**Mixed to poor despite corporate backing.** 209 commits/4wks is good, but a 449-PR backlog with users pinging for reviews on 2-week-old critical-bug fixes is a throughput-at-ingress / throughput-at-merge mismatch. Production users are hitting uninstallability, security CVEs, and "unable to use crewai"-level bugs.

### Integration cost: **3/5**
Adding CrewAI to a Python project is easy; debugging it when it silently misbehaves (tool loop not running, output_pydantic leakage) is hard.

### Lock-in severity: **High**
Role/Task/Crew DSL is the whole programming model. Migrating off is a rewrite.

### Who should NOT use it
Anyone not on OpenAI's API (high risk of subtle breakage on other providers). Intel Mac users (until they fix lancedb). Anyone on the latest CrewAI who needs security-patch freshness. Anyone building headless coding agents — CrewAI is optimized for conversational/role-play scenarios, not SWE-bench-style task execution.

---

## 11. AutoGen (Microsoft)

- **URL:** https://github.com/microsoft/autogen
- **Stars:** 57,170 · **Open PRs:** 263 · **Closed PRs:** 3,201 · **Open issues:** 770 · **Last commit:** 2026-04-06 · **Python** · **CC-BY-4.0** (sic — unusual for code) · **Created 2023-08-18**
- **One-line positioning:** Microsoft's multi-agent framework; v0.4 rewrite introduced async event-driven core.

### Strengths
- **Concepts are well-specified.** GroupChat, SocietyOfMindAgent, and the post-0.4 Core/AgentChat/Extensions split map cleanly onto real systems.
- **533 contributors** — enormous but diffuse community.
- **Microsoft backing** (nominally).

### Failure modes
- **Cadence has collapsed. 2 commits in the last 4 weeks.** Top contributor `ekzhu` 473 commits. Commit log shows clear slowdown from October 2025.
- **v0.2 → v0.4 rewrite left major scars.** Per community writeups: breaking changes with no viable migration path drove teams to AG2 (the community fork) or off AutoGen entirely. https://github.com/microsoft/autogen/discussions/4208 is the official discussion; https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/migration-guide.html is the official migration doc that readers found insufficient.
- **Governance split.** The framework forked into AutoGen (Microsoft, v0.4+), AG2 (community, v0.2 preservationists), and AutoGen Studio. https://dev.to/maximsaplin/microsoft-autogen-has-split-in-2-wait-3-no-4-parts-2p58 summarizes.
- **SocietyOfMindAgent message leakage.** https://github.com/microsoft/autogen/issues/6123 — inner team messages leak to outer GroupChat stream; isolation is broken.
- **Weak validation.** https://github.com/microsoft/autogen/issues/7580 — RoundRobinGroupChat throws raw `AttributeError`/`TypeError` on invalid participants instead of a clear validation error.
- **Issue tracker is heavily polluted by crypto/agent-payments spam.** Multiple top-commented "integrations" (Merxex, Hive, Signet, AgentShield) are engagement farms with no actual integration happening. Moderation is visibly absent.
- **CC-BY-4.0 license is unusual for executable code** — check with your legal about whether this is actually safe.

### Maintenance health
Microsoft Research project dynamics — the researchers left/moved on; the AG2 community fork (by Qingyun Wu / Chi Wang post-departure) is arguably now the "real" community home. Autogen-the-repo is drifting.

### Integration cost: **4/5**
Because of the v0.2/v0.4 schism, any integration decision first requires picking a side.

### Lock-in severity: **Medium**
Because v0.4's core is async/event-driven and well-decoupled, you can theoretically swap models and transports — but the GroupChat patterns are autogen-shaped.

### Who should NOT use it
Anyone building a coding harness in 2026 — the cadence has slowed, the field has moved on, and the split has made it unclear which variant to bet on. Use AG2 if you need the v0.2 patterns long-term; use LangGraph or Deep Agents if you want something actively engineered.

---

## 12. smolagents (Hugging Face)

- **URL:** https://github.com/huggingface/smolagents
- **Stars:** 26,680 · **Open PRs:** 246 · **Closed PRs:** 1,108 · **Open issues:** 494 · **Last commit:** 2026-04-15 · **Python** · **Apache-2.0** · **Created 2024-12-05**
- **One-line positioning:** "Barebones library for agents that think in code." Very small core, HF-Hub-integrated model side.

### Strengths
- **Smallest-possible harness.** The `CodeAgent` approach (agent outputs Python, Python runs, result goes back) is genuinely minimal.
- **Clean deps:** `huggingface-hub`, `requests`, `rich`, `jinja2`, `pillow`, `python-dotenv`. That's it for the core. Everything else is optional-extras. This is the opposite of LangChain/deepagents.
- **Python 3.10+** — wider than most.
- **MCP client built in.**
- **HF brand + Hub distribution** — you can push tools as HF repos.

### Failure modes
- **Cadence has halved.** **Only 4 commits in last 4 weeks.** Main author `aymeric-roucher` appears to have moved on (not in top-5 recent committers); top contributor `albertvillanova` 360 commits but he's a general-HF person, not dedicated. Releases are slowing.
- **`LocalPythonExecutor` timeout doesn't actually interrupt.** https://github.com/huggingface/smolagents/issues/2197 — timeout waits for worker completion before returning. A core primitive of a code-executing agent — broken.
- **`ManagedAgent` swallows tool errors from sub-agents.** https://github.com/huggingface/smolagents/issues/2166 — manager sees empty/None result; silent failure on sub-agent errors. This is the *exact* bug class you'd want a harness to *prevent*.
- **No built-in retry/backoff for transient model API errors.** https://github.com/huggingface/smolagents/issues/2165 — an out-of-the-box production requirement that's absent.
- **No interrupt/cancel reason.** https://github.com/huggingface/smolagents/issues/2178 — can't cleanly stop a running agent.
- **Transformers 5.x blocked by `huggingface-hub` version constraint.** https://github.com/huggingface/smolagents/issues/2160 — dep-conflict keeping users on old Transformers.
- **Configurable-timeout request: only just being added.** https://github.com/huggingface/smolagents/issues/2162 — HTTP timeouts in `WebSearchTool` weren't configurable for months.
- **Serialization of callbacks: long-missing feature.** https://github.com/huggingface/smolagents/issues/2142 — can't persist agents with custom callbacks across processes cleanly. External-contributor PR exists.
- **Issue tracker is heavily spammed** with "integration proposal" posts pushing obscure MCP servers (Chart Library, WhichModel, PaperClaw) and crypto-agent products — shared pattern with MetaGPT/AutoGen/CrewAI.

### Maintenance health
**Concerning.** 4 commits/4wks is low for a 26k-star library; 246 open PRs and 494 open issues indicate ingress-without-egress. The original author signal is fading. Hugging Face as a company is not demonstrating sustained investment, at least in throughput terms.

### Integration cost: **2/5**
The library itself is small enough that wrapping/forking is cheap. It will be the easiest of these projects to read end-to-end.

### Lock-in severity: **Low**
Because the abstractions are so minimal, tearing out smolagents is cheap.

### Who should NOT use it
Anyone needing production-grade robustness (timeout/retry/cancel primitives are incomplete). Anyone whose sub-agent errors must not be swallowed. Anyone wanting confident forward-velocity from HF.

---

## Comparison table

(Maturity = "how production-ready the core abstractions feel". Maintenance = last-4-week commit cadence + bus factor. Install cost = what it takes to get a minimal thing running locally. Lock-in = cost to leave later. 1 = low / 5 = high.)

| Project | Maturity | Maintenance | Install cost | Lock-in | Best-fit user |
|---|---|---|---|---|---|
| **OpenHands** | 4 | 4/5 (very active, company-backed) | 4 (Docker, Py 3.12–3.13 only, 60+ deps) | 5 | Team that wants a turnkey autonomous coding product, not a library |
| **SWE-agent / SWE-ReX** | 3 | 2/5 (slowing, bus factor 1) | 3 (Docker + heavy SWE-bench images) | 2 (SWE-ReX), 3 (SWE-agent) | Researcher running SWE-bench-style evals at scale |
| **Deep Agents** | 3 | 5/5 (fastest-moving on list) | 3 (LangChain v1 ecosystem) | 5 | Dev already in LangChain land who wants planning + subagents + middleware out of box |
| **Open SWE** | 3 | 4/5 | 3 (Daytona sandbox setup) | 5 | GitHub-centric team wanting a "bot that fixes issues" workflow |
| **Plandex** | 2 | 1/5 (stale 6+ months) | 2 (Go binary + optional Docker) | 2 | Nobody right now — revisit if project revives |
| **Aider** | 4 | 2/5 (single-maintainer) | 1 (pipx install) | 1 | Solo dev using terminal pair-programming interactively |
| **Goose** | 4 | 5/5 (diverse contributor base) | 2 (single Rust binary) | 2 (MCP-based tools are portable) | Dev who wants a stable terminal agent + MCP ecosystem |
| **MetaGPT** | 2 | 1/5 (quasi-dormant, spam-polluted issues) | 3 | 4 | Academic reader, not a production user |
| **Continue.dev** | 4 | 4/5 | 1 (VS Code extension) | 2 (as product), 5 (as library) | IDE-bound dev who wants chat/edit inside VS Code or JetBrains |
| **CrewAI** | 3 | 3/5 (busy but review-starved, security-lagged) | 2 (pip) | 5 | Prototypers building role-play multi-agent demos |
| **AutoGen** | 2 | 2/5 (fragmented, cadence collapsed) | 3 (Py + pick-a-version) | 3 | Nobody starting fresh; legacy v0.2 users on AG2 |
| **smolagents** | 3 | 2/5 (slowing) | 1 (tiny deps) | 1 | Someone who wants a readable, minimal code-agent loop to extend |

---

## Net assessment (for a developer dropping a reusable coding harness into personal projects)

**Active-harness frontier.** The genuinely alive, production-grade options are **Deep Agents**, **Goose**, **OpenHands**, **Open SWE**, and **Continue.dev**. Of those, only Deep Agents and smolagents present themselves as *libraries* rather than *products*. Goose and OpenHands are monoliths you run; Continue is an IDE extension. So for someone who wants to *embed* a harness into their own Python tooling rather than adopt a product, the practical choices narrow quickly.

**What's overkill for a personal-project harness.** OpenHands is the clearest case — you're adopting Docker runtime orchestration, a React frontend, Kubernetes support, and 60+ deps when what you actually needed was probably a planning loop + tool-call executor. AutoGen v0.4's event-driven/actor model is built for distributed multi-agent orchestration at a scale a personal project doesn't have. CrewAI's Role/Task/Crew abstraction is oriented at "multiple agents talking" scenarios, which is the wrong shape for "fix this function" tasks. MetaGPT's SOP model is a whole programming paradigm.

**What's actively risky.** **Plandex** is ~6 months stale with known server panics; adoption means maintaining a fork. **MetaGPT** has slowed to zero weekly commits and its issue tracker is polluted with ARG-flavored LLM spam that maintainers aren't moderating. **Aider** as a library is risky (1,486 open issues, most auto-filed crash reports with zero triage; single maintainer at 1 commit/4 weeks in early 2026). **AutoGen** as a new-start choice is risky because of the unresolved v0.2/v0.4 split plus collapsed cadence. **CrewAI** carries real security-patch lag and "unable to use crewai"-severity open bugs on OpenAI-compatible endpoints.

**Pragmatic recommendation by use case:**

- **If you want a library you can actually understand end-to-end and extend:** start from **smolagents** or **SWE-agent**. Read the source, understand the loop, fork or extend. Both carry the risk that upstream has slowed, but because the surface is small, that matters less than it would for LangChain.
- **If you want opinionated primitives (planning, subagents, virtual FS, middleware) and you're already in the LangChain ecosystem:** **Deep Agents** is the only project on this list moving fast enough and opinionated enough to not regret in 6 months. Accept the LangChain lock-in consciously; it's the price.
- **If you want a product to use daily, not embed:** **Goose** (terminal, MCP-first, highest distribution of contributors, single-binary install) or **Continue.dev** (IDE).
- **If your task is SWE-bench-style eval at scale:** SWE-ReX (just the runtime, not the agent) with your own loop on top. Don't adopt SWE-agent as a framework; adopt SWE-ReX as a sandbox.
- **If your harness needs to run arbitrary LLM-generated code safely:** none of these solve the sandboxing problem well for a personal-project scale. OpenHands and SWE-ReX have real Docker isolation; Goose is tool-scoped, not code-scoped; smolagents' `LocalPythonExecutor` has the timeout bug above.

**Gaps in the OSS landscape.** A lightweight Python harness that treats LLM-as-model and sandbox-as-execution as separate concerns (SWE-ReX-style), with a stable MCP-compatible tool interface (Goose-style), and a minimal middleware hook system (Deep Agents-style), and zero LangChain coupling, does not currently exist. The closest approximations each sacrifice one of those properties. If you're evaluating "adopt vs. build," this gap is the most defensible reason to build: **no OSS harness simultaneously is (a) library-shaped, (b) not LangChain-coupled, (c) sandbox-abstracted, and (d) actively maintained by a team larger than one person.** Deep Agents hits (a)(c)(d) but fails (b); smolagents hits (a)(b) but fails (c)(d); SWE-ReX hits (c) on its own but isn't a harness; Goose hits (d) but fails (a)(b).

**Lock-in asymmetry warning.** Every project in the "heavy" tier (OpenHands, Deep Agents, CrewAI, AutoGen, MetaGPT) ships with a bespoke programming model — Role/Task/Crew, Graph/Node/State, SOP/Role/Action, middleware stacks — and your application code gets written against that model. These are the options with the highest *unwind cost*. The "light" tier (smolagents, SWE-ReX-as-runtime, Aider-as-product) leave your code mostly framework-independent. For a personal project whose scope might change, prefer the light tier.

---

### Sources (beyond inline GitHub citations)

- [OpenHands one-year retrospective (All Hands AI blog)](https://openhands.dev/blog/one-year-of-openhands-a-journey-of-open-source-ai-development)
- [Microsoft Autogen Has Split in 2... Wait 3... No, 4 Parts (dev.to)](https://dev.to/maximsaplin/microsoft-autogen-has-split-in-2-wait-3-no-4-parts-2p58)
- [AutoGen v0.2 to v0.4 migration guide (official)](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/migration-guide.html)
- [AutoGen v0.4 status discussion #4208](https://github.com/microsoft/autogen/discussions/4208)
- [A morning with SWE-agent (feep.dev)](https://search.feep.dev/blog/post/2025-04-05-swe-agent)
- [Fixing OpenHands: Hardened Docker Compose for Production (interconnectd.com)](https://interconnectd.com/blog/31/fixing-openhands-hardened-docker-compose-for-production/)
- [Improving Deep Agents with harness engineering (LangChain blog)](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)
- [LangGraph vs CrewAI vs AutoGen production comparison (Medium / Python in Plain English)](https://python.plainenglish.io/autogen-vs-langgraph-vs-crewai-a-production-engineers-honest-comparison-d557b3b9262c)
- [Goose review (Effloow, 2026)](https://effloow.com/articles/goose-open-source-ai-agent-review-2026)
