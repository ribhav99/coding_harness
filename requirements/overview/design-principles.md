# Design Principles

Eight principles drive every concrete decision in the harness.

**Every generation step is a gen/review loop.** The same pattern — generator writes, reviewers judge, generator fixes — runs at three levels: requirements, blueprint, code. One loop mechanic, three sets of reviewers. Autonomy lives inside each loop; handoffs between loops are discrete, operator-visible gates.

**Verification and generation quality are co-equal.** The harness must confirm the artifact is correct (verification) and that it will hold up as input to the next loop (quality). A passing but incoherent FRD wrecks the blueprint loop; a passing but hand-wavy blueprint wrecks the coding loop. The reviewer stack at each level is designed to prevent the downstream failure, not just the local one.

**Claude Code is the runtime.** The orchestrator never makes direct Anthropic API calls. Every model interaction happens through `claude -p`. This inherits Claude Code improvements for free and lets the operator keep paying one subscription rather than billing per token.

**In-session work uses hooks; cross-session work uses Python.** Hooks are deterministic and reactive, enforcing output contracts and preventing premature session termination. The Python orchestrator is the only thing that initiates sessions, transitions state, enforces budgets, and detects clarification-pending pauses.

**The artifacts are ground truth.** Reviewers never trust generator self-reports. They read the written files (or `git diff` in the coding loop) and run gates against those. A generator that claims to have done something it did not do is caught by the reviewers.

**Local files are the source of truth; external backends are optional outbound mirrors.** The canonical PRD, FRDs, blueprints, work orders, and execution state live at the project repo's root under `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/`. The orchestrator always reads from and writes to local files. Software Factory or any other system is a sync target, never the queue itself.

**Machine-readable state for agents; human-readable artifacts for the operator.** Agents read and write JSON in `harness/state/`. The operator authors and reads markdown plus meta files in the rest of the project repo. A sync script mirrors updates to PR comments on GitHub and, when configured, to external mirrors.

**Clarification questions are first-class, and non-blocking.** Both upstream autonomous loops surface operator-required input via the same mechanism: an append-only `_questions-pending.md` file alongside the artifact tree (`requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop). The block shape differs by loop because the response shape differs: requirements-loop questions are always bare ("what does X mean?", "did you intend Y or Z?") because the answer is "clarify the PRD" — there's nothing for the generator to pre-research; blueprint-loop questions are bare *or* carry 2–4 pre-researched options with pros, cons, and a recommended default when the choice is genuine (e.g. "Postgres vs DynamoDB"), because architectural decisions benefit from pre-research in a way PRD clarifications usually don't. In both loops, the generator keeps producing everything that does not depend on the blocked input, and the loop only terminates as incomplete when it has done as much as it can without operator input. The operator resolves asynchronously; subsequent loop runs consume the answers and continue. Both loops exit with the same `awaiting_clarification` verdict — one mechanism, one verdict, two file locations, two question shapes.
