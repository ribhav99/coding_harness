# Design Principles

Eight principles drive every concrete decision in the harness.

**Every generation step is a gen/review loop.** The same pattern — generator writes, reviewers judge, generator fixes — runs at three levels: requirements, blueprint, code. One loop mechanic, three sets of reviewers. Autonomy lives inside each loop; handoffs between loops are discrete, operator-visible gates.

**Verification and generation quality are co-equal.** The harness must confirm the artifact is correct (verification) and that it will hold up as input to the next loop (quality). A passing but incoherent FRD wrecks the blueprint loop; a passing but hand-wavy blueprint wrecks the coding loop. The reviewer stack at each level is designed to prevent the downstream failure, not just the local one.

**Claude Code is the runtime.** The orchestrator never makes direct Anthropic API calls. Every model interaction happens through `claude -p`. This inherits Claude Code improvements for free and lets the operator keep paying one subscription rather than billing per token.

**In-session work uses hooks; cross-session work uses Python.** Hooks are deterministic and reactive, enforcing output contracts and preventing premature session termination. The Python orchestrator is the only thing that initiates sessions, transitions state, enforces budgets, and detects bubble-up pauses.

**The artifacts are ground truth.** Reviewers never trust generator self-reports. They read the written files (or `git diff` in the coding loop) and run gates against those. A generator that claims to have done something it did not do is caught by the reviewers.

**Local files are the source of truth; external backends are optional outbound mirrors.** The canonical PRD, FRDs, blueprints, work orders, and execution state live at the project repo's root under `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/`. The orchestrator always reads from and writes to local files. Software Factory or any other system is a sync target, never the queue itself.

**Machine-readable state for agents; human-readable artifacts for the operator.** Agents read and write JSON in `harness/state/`. The operator authors and reads markdown plus meta files in the rest of the project repo. A sync script mirrors updates to PR comments on GitHub and, when configured, to external mirrors.

**Bubble-ups are first-class, and non-blocking.** Both upstream autonomous loops surface operator-required input via append-only files that sit alongside their artifacts. The requirements loop logs PRD-clarification requests to `requirements/_questions-pending.md`; the blueprint loop logs architectural decisions to `blueprints/_decisions-pending.md` with pre-populated options and a recommended default. The generator keeps producing everything that does not depend on the blocked input, and the loop only terminates as incomplete when it has done as much as it can without operator input. The operator resolves asynchronously; subsequent loop runs consume the answers and continue.
