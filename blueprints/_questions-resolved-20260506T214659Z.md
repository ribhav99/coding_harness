# Pending architectural questions

Open questions the blueprint generator surfaced for operator adjudication. Each block is a genuine source-artifact contradiction or architectural pick that the generator cannot resolve autonomously without violating a priority anchor (grounding or coverage).

Operators answer by editing the relevant source artifact (FRD, `BLUEPRINT.md`, or another blueprint) and filling in the `Your answer:` line in-place — or by renaming this file to `_questions-resolved-<timestamp>.md` for git-history audit once all questions are resolved.

---

## Post-exit protocol-retry for malformed reviewer verdicts: keep, drop, or revise?

**Where:** `blueprints/components/subprocess-runtime.md` — `#ProtocolRetryStrategy` component and the related `protocol_failures[]` field on `PerLoopState` in `blueprints/components/state-store.md`. Composed by `@Feature(requirements-loop)`, `@Feature(blueprint-loop)`, `@Feature(work-orders-loop)`, and `@Feature(coding-loop)`.

**Context:** There is a direct contradiction between two source artifacts on whether the orchestrator should run a post-exit recovery layer when a reviewer subprocess emits a malformed `VERDICT:` trailer:

- **`requirements/features/python-orchestrator.md` REQ-ORCH-013** (approved FRD, with detailed ACs AC-ORCH-013.1 through AC-ORCH-013.5) defines a post-exit protocol-retry layer: when a reviewer subprocess exits with malformed stdout (no clean `VERDICT: pass|fail` trailer), the orchestrator re-prompts the same reviewer with a fresh `claude -p` subprocess up to 2 protocol-retries per reviewer per loop attempt. After exhaustion, the verdict is recorded as `fail` in a `protocol_failures[]` array.
- **`BLUEPRINT.md` §1.1 step 5** explicitly disclaims this: "the orchestrator records that reviewer's verdict as `fail` for aggregation and the loop continues — **no post-exit recovery layer**. The trade-off: simpler orchestrator, at the cost of treating rare malformed-output cases as soft fails rather than recovering." Reinforced by §1.6: `max_agent_retries` "caps **two** layers — post-spawn rate-limit re-spawns with doubling backoff (§1.9) and in-session `Stop`-hook retries that nudge the model to re-emit a malformed VERDICT trailer (§9)."

The blueprint as currently written is grounded in the FRD (REQ-ORCH-013 has explicit ACs that bind the orchestrator's behaviour). But `BLUEPRINT.md` is the operator's pinned implementation architecture and explicitly disclaims the post-exit layer. One of the two must give.

**Options:**

1. **Drop `#ProtocolRetryStrategy` and `protocol_failures[]`; let the in-session `Stop` hook be the only enforcement layer.** Match `BLUEPRINT.md`. The FRD's REQ-ORCH-013 would need to be edited (or a follow-up requirements-loop run would catch the now-unmet AC).
   - Pros: simpler orchestrator (one fewer recovery layer); matches `BLUEPRINT.md` verbatim; the `Stop` hook self-cap (§9) already bounds the in-session ping-pong; rare malformed-output cases become soft `fail` and the loop continues, which is a reasonable trade.
   - Cons: in pathological cases (truncated stdout, hook bypass, subprocess crash) a single bad spawn yields a `fail` verdict and consumes a loop-level attempt unnecessarily; FRD requires editing (REQ-ORCH-013 deletion) before re-running the requirements loop.

2. **Keep `#ProtocolRetryStrategy` as-is; revise `BLUEPRINT.md` §1.1 / §1.6 to acknowledge a third layer.** Match the FRD. `BLUEPRINT.md` would be edited so the "no post-exit recovery layer" sentence is replaced with a brief description of the protocol-retry; §1.6's "two layers" becomes "three layers" with `max_agent_retries` capping all three.
   - Pros: keeps the FRD's REQ-ORCH-013 contract intact (no requirements-loop rework); the recovery layer covers genuine pathological output (crash, truncation, hook bypass) without consuming a loop attempt; the cost is small (3 invocations max per malformed reviewer per attempt).
   - Cons: orchestrator is slightly less simple than `BLUEPRINT.md`'s current framing; introduces a third counter alongside in-session Stop-hook retries and rate-limit retries (though all three already share the `max_agent_retries` budget).

3. **Compromise: keep `#ProtocolRetryStrategy` as a single-shot retry (1 attempt, not 2), and tighten its trigger to crash/truncation only (i.e. only fire when stderr or exit code indicates a non-clean exit, not just a clean exit with a malformed trailer).** Closer to `BLUEPRINT.md`'s "no recovery for what the model did or didn't say" while still recovering from genuinely-broken subprocesses. FRD REQ-ORCH-013 would need to be tightened (the existing ACs over-promise relative to this option).
   - Pros: middle ground — simpler than option 2 but recovers from infrastructure-shaped failures (crash, truncation) the way option 1 cannot; `BLUEPRINT.md`'s philosophy that "agent retries don't consume `max_attempts` — they're recovery from infrastructure throttling … not from anything the model did or didn't say" is preserved (model-did-emit-something cases become soft `fail`; subprocess-truly-crashed cases recover).
   - Cons: requires editing both the FRD and `BLUEPRINT.md`; defining the "crash/truncation only" trigger precisely is non-trivial (what if stdout is truncated mid-VERDICT line because the subprocess hit OOM?).

**Recommended:** Option 2 — keep `#ProtocolRetryStrategy` and revise `BLUEPRINT.md` to acknowledge the third layer. The FRD's REQ-ORCH-013 has specific ACs that the operator (or the requirements loop) approved as binding, and the recovery layer is small and bounded. The operational cost (one extra paragraph in the orchestrator code; one additional state-file field; up to 2 extra spawns per malformed reviewer per attempt) is small relative to the resilience benefit, and it keeps the FRD as canonical input rather than as something the blueprint loop unilaterally undercut.

**Your answer:** yes go with option 2.

---
