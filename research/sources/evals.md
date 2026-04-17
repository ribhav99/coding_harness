# Eval Methodology for Agentic Coding Harnesses

Research pass to inform harness design. Primary sources are Anthropic's 2025–2026 engineering posts; secondary are Hamel Husain, Shreya Shankar, SWE-bench, Terminal-Bench, and eval tooling docs (Braintrust, OpenAI Evals). Current date: 2026-04-16.

A note up front: the GAN-style harness post is short on granular quotes, so some of the evaluator mechanics below are paraphrased from the post's narrative rather than pulled verbatim. I flag where that's the case.

---

## 1. The core question: what does it mean to evaluate agent-produced code?

There is no single answer. Anthropic's "Demystifying evals for AI agents" (Jan 2026) factors the problem into roughly these axes:

- **Outcome vs. trajectory.** Did the final state of the environment match what was asked for, or did the agent follow the right *process*? Anthropic is emphatic that outcome wins by default:
  > "A flight-booking agent might say 'Your flight has been booked' at the end of the transcript, but the outcome is whether a reservation exists in the environment's SQL database."
  > "it's often better to grade what the agent produced, not the path it took"
  Trajectory evaluation is reserved for cases where *how* matters (e.g., security constraints, forbidden tool calls).

- **Deterministic vs. model-based vs. human.** The post lays out three grader families:
  > Code-based graders are "fast, cheap, objective, reproducible, easy to debug" but "brittle to valid variations that don't match expected patterns exactly."
  > Model-based graders are "flexible, scalable, captures nuance" yet "non-deterministic, more expensive than code, requires calibration with human graders."
  > Human graders provide "gold standard quality" but are "expensive, slow, often requires access to human experts at scale."

- **Rubric vs. binary.** Hamel Husain is the loudest advocate for binary:
  > "A binary decision forces everyone to consider what truly matters."
  > "What makes something a 3 versus a 4? Nobody knows."
  > "Don't stray from binary pass/fail judgments when starting out."
  Anthropic's advice is compatible: "grade each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions" — i.e., decompose into multiple binary checks rather than one rubric score.

- **Tests vs. behavior vs. aesthetics.** For coding, the signal set spans (a) compiles/typechecks/lints, (b) unit + integration tests pass, (c) end-to-end behavior via a browser or API client, (d) code structure and idiom quality, (e) UX/design quality for UI work.

For a reusable harness, the practical question is: **which of these signals are cheap enough to run every loop, and which are trustworthy enough to be a gate?**

---

## 2. Anthropic's position (primary sources)

### 2.1 Separate evaluator, and make it skeptical

The load-bearing claim from the GAN harness post:

> "Tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."

The corollary (paraphrased from the post) is that once skeptical external feedback exists, the generator has something concrete to iterate against. Self-evaluation is treated as a dead end, not merely suboptimal.

### 2.2 Grade outcomes, ground them in the environment

From "Demystifying evals":

> "A good task is one where two domain experts would independently reach the same pass/fail verdict."
> "Everything the grader checks should be clear from the task description; agents shouldn't fail due to ambiguous specs."

And the cautionary tale about over-rigid deterministic graders:

> "Opus 4.5 initially scored 42%" on one benchmark "until an Anthropic researcher found multiple issues: rigid grading that penalized '96.12' when expecting '96.124991…'"

So deterministic graders have to tolerate equivalent-but-not-identical outputs; model-based graders have to be calibrated against humans. Neither is a freebie.

### 2.3 LLM-as-judge guardrails

> "To avoid hallucinations, give the LLM a way out, like providing an instruction to return 'Unknown' when it doesn't have enough information."
> "LLM-as-judge graders should be closely calibrated with human experts to gain confidence that there is little divergence between the human grading and model grading."
> "grade each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions."

Also on coverage:

> "Test both the cases where a behavior should occur and where it shouldn't" — avoid class imbalance.

And the meta-point on eval-driven development:

> "build evals to define planned capabilities before agents can fulfill them, then iterate until the agent performs well."
> "An eval suite is a living artifact that needs ongoing attention and clear ownership to remain useful."
> "You won't know if your graders are working well unless you read the transcripts and grades from many trials."

### 2.4 Eval awareness and contamination

"Eval awareness in Opus 4.6 BrowseComp" (Mar 2026) reports that Opus 4.6 on BrowseComp, without being told which benchmark it was on, hypothesized a benchmark, identified it, and decrypted the answer key:

> "To our knowledge, this is the first documented instance of a model suspecting it is being evaluated without knowing which benchmark was being administered, then working backward to successfully identify and solve the evaluation itself."

The implication for a coding harness is broader than just "don't use public benchmarks":

> "running evals on the open internet may become increasingly difficult to do reliably"

The multi-agent configuration "showed 3.7x higher contamination rates than single-agent setups, suggesting architecture amplifies these risks." A GAN harness is multi-agent. That means contamination (generator or evaluator leaning on memorized answers) is a risk worth thinking about even for bespoke internal evals once models are smart enough to recognize them.

### 2.5 Infrastructure noise is a first-class eval concern

"Quantifying infrastructure noise in agentic coding evals" is sobering. On Terminal-Bench 2.0:

> The difference between most- and least-resourced setups was "6 percentage points (p < 0.01)."
> "every element of the evaluation setup can influence the final score, from cluster health to hardware specs, from concurrency to egress bandwidth."

Infrastructure error rates in their study dropped from 5.8% (strict cgroup kill-on-limit) to 0.5% (uncapped). Their recommendation: specify **two** parameters — guaranteed allocation and a separate hard kill threshold — with ~3x headroom. And:

> "leaderboard differences below 3 percentage points deserve skepticism until the eval configuration is documented and matched."

For a reusable harness, this means: results aren't comparable across machines unless the runtime envelope (CPU, memory, concurrency, network) is pinned and logged.

### 2.6 AI-resistant evaluations

"Designing AI-resistant technical evaluations" (Jan 2026) is about hiring tests, but the design principles generalize:

> "Evaluating technical candidates becomes harder as AI capabilities improve."
> "The original worked because it resembled real work. The replacement works because it simulates novel work."

Techniques: out-of-distribution problems, reduced tooling (force the agent to build its own debugging affordances), and longer time horizons (because "human experts retain an advantage over current models at sufficiently long time horizons"). For harness evals, the analogue is: if your eval looks like a Leetcode problem or a canonical React tutorial, a capable model will solve it from priors regardless of harness quality.

### 2.7 "Effective harnesses" (Nov 2025) — eval-relevant

The Nov 2025 post focuses on failure modes rather than eval methodology. The eval-relevant takeaways are implicit:

- Agents "tended to try to do too much at once" and would "declare the job done" prematurely — which means self-reported completion is not a trustworthy signal.
- The workflow uses a JSON feature-list file with `passes: false/true`, and verification goes through browser automation rather than self-report.

This matches the GAN post's thesis: trust the evaluator's ground-truth checks, not the generator's claims.

---

## 3. Hamel / Shreya / practitioner view

### 3.1 Hamel Husain: error analysis is the whole game

Hamel's loudest claim across "Your AI Product Needs Evals," the "Field Guide," and his evals FAQ:

> "You must remove all friction from the process of looking at data."
> "Error analysis is the most important activity in evals."
> "You can never stop looking at data—no free lunch exists."

His three-level hierarchy:

1. **Unit tests** — assertions on every code change, cheap, organized by feature/scenario.
2. **Human & model evaluation** — logged traces, domain-specific viewers, LLM-as-judge with human alignment tracking.
3. **A/B tests** — only when mature.

On LLM-as-judge construction (7-step process from his judge post):

1. Pick one principal domain expert.
2. Build diverse datasets (features × scenarios × personas).
3. Expert makes pass/fail + written critique.
4. Fix obvious bugs *before* building the judge.
5. Build iteratively with few-shot examples embedding the critiques.
6. Error analysis across dimensions.
7. Specialized judges only as needed.

On measuring judge quality:

> Compare LLM judgments against expert decisions using **precision and recall separately**, especially with imbalanced datasets. Track agreement across iterations until convergence. Honeycomb reached >90% agreement in three iterations.

And:

> "It often takes advanced reasoning capabilities to critique something well."

On agentic systems specifically (from the FAQ):

> "Treat agents as black boxes—measure end-to-end task success" first; "conduct step-level diagnostics once error analysis reveals failure patterns."
> "Use transition failure matrices to understand error patterns" — map last-successful-state against where failures first occur.
> "Try reproducing failures in the simplest form first; only use multi-turn tests when failures genuinely require conversation context."

### 3.2 Shreya Shankar: criteria drift and EvalGen

Shankar's "Who Validates the Validators?" paper names a phenomenon the GAN harness post implicitly encounters:

> "users need criteria to grade outputs, but grading outputs helps users define criteria" — **criteria drift**.

Some evaluation criteria are "dependent on the specific LLM outputs observed (rather than independent criteria that can be defined *a priori*)." This is the theoretical backing for the empirical practice of iterating the evaluator prompt after reading logs (which is exactly what the GAN harness author did).

On practice:

> "you can't determine effective criteria purely through theorizing about possible failure modes for your task. You need to examine actual data."
> "Binary metrics (True/False) are much easier to align and reason about from a UX standpoint."
> "The metric set that you come up with from the previous section is not meant to be static."
> "LLM APIs are constantly changing under the hood, and your ideal system behavior will evolve over time."

This is the closest thing to a theoretical argument for why an eval suite is a *living* artifact, not a fixed asset.

### 3.3 Common failure modes the community names

Composite list from the sources:

- **Positivity bias / self-praise** — models rate their own or similar outputs more favorably. The GAN harness motivation. Separate evaluator mitigates.
- **Rubric drift toward approval** — "identifying legitimate issues but then deciding they weren't significant and approving the work anyway" (GAN post).
- **Criteria drift** — Shankar; the eval target itself shifts as you observe outputs.
- **Reward hacking / Goodharting** — generators optimize for the judge rather than the task. A variant is obsequious agreement with the judge's stated preferences.
- **Over-specific trajectory grading** — Anthropic warns against "checking that agents followed very specific steps like a sequence of tool calls in the right order."
- **Ambiguous specs that blame the agent** — "agents shouldn't fail due to ambiguous specs."
- **Class imbalance** — forgetting the negative cases.
- **Generic metrics that don't measure what matters** — Hamel: "Generic evaluation metrics…measure abstract qualities that may not matter for your use case. Good scores on them don't mean your system works."
- **Contamination and eval awareness** — Anthropic Mar 2026.
- **Infrastructure noise swamping real gains** — Anthropic infra-noise post.

---

## 4. How the GAN harness evaluator was actually built

Reconstructing the evaluator mechanics from the post. I'll clearly mark what's a direct quote versus paraphrase, because the post has relatively few verbatim sentences about the evaluator specifically.

### 4.1 Structural choice: standalone evaluator

Direct quote:
> "Tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."

Paraphrased: once that external feedback exists, the generator has a concrete signal to iterate against. This is the thesis of the whole GAN loop.

### 4.2 Tools

Paraphrased from the post: the evaluator had access to **Playwright MCP** and used it to click through the running application "like a user would," exercising UI features, hitting API endpoints, and inspecting database state before grading each sprint. The evaluator navigated pages autonomously and took its own screenshots rather than being handed a static image — it chose what to look at.

### 4.3 Grading criteria (frontend design track)

Four criteria, paraphrased from the post:

- **Design quality** — coherence across colors, typography, layout, imagery.
- **Originality** — evidence of custom decisions versus template defaults.
- **Craft** — typography hierarchy, spacing consistency, color harmony.
- **Functionality** — usability and task completion.

The prompt "emphasized design quality and originality over craft and functionality" because Claude naturally handles the latter two — so calibration was tilted toward the axes where the generator was weak. This is a good design pattern: weight your rubric toward the dimensions the generator struggles on, not the ones it already nails.

### 4.4 Calibration: few-shot with score breakdowns

Paraphrased: the evaluator was "calibrated using few-shot examples with detailed score breakdowns" to align judgment with the builder's preferences and reduce score drift across iterations. This matches Hamel's 7-step process (step 5: few-shot examples embedding expert critiques).

### 4.5 The failure mode that drove the tuning loop

Paraphrased from the post: early evaluator versions showed a specific failure — it would identify real issues, then *talk itself into* deciding they weren't a big deal, and approve the work anyway. The author described repeatedly reading evaluator logs, identifying divergences between the evaluator's judgment and their own, and updating the QA prompt to close each gap. This ran for "several rounds."

This is exactly Shankar's criteria drift in practice: the criteria couldn't be specified up front; they emerged from watching the evaluator mis-grade real outputs.

### 4.6 Hard thresholds and sprint contracts

Paraphrased: the full-stack evaluator graded sprints against both discovered bugs and explicit criteria, and used **hard thresholds** — failing any single criterion meant sprint rejection. No compensatory averaging.

The **sprint contract** mechanism: before each sprint, generator and evaluator negotiated what completion looked like. The generator proposed what it would build and how success would be verified; the evaluator reviewed and pushed back on scope until they agreed. This is contract-signal evaluation: the generator's stated intent is captured as a verifiable artifact, and the evaluator then verifies against *that*, not against a floating standard.

### 4.7 What was iteratively refined, in order

Based on the post:

1. The rubric itself (which criteria, and their weighting).
2. The few-shot calibration examples.
3. The skepticism prompt (forcing the evaluator to hold issues as blocking rather than rationalize them away).
4. The contract-negotiation protocol.
5. The tool surface (adding Playwright so the evaluator could poke at behavior rather than judge screenshots).

---

## 5. Eval patterns transferable to a reusable coding harness

Concrete signals, from cheapest and most deterministic to most expensive and most subjective:

### 5.1 Deterministic signals (run every loop)

- **Build succeeds** — compile/typecheck/lint. Binary, cheap, no calibration needed.
- **Unit tests pass** — both pre-existing (PASS_TO_PASS) and newly-introduced (FAIL_TO_PASS, the SWE-bench pattern).
- **Integration tests pass** — slower, but a strong signal.
- **Static analysis** — type errors, lint, dead code, cycle detection.
- **Resource envelope** — time/memory/tokens under a threshold (these are also anti-reward-hacking signals; an agent that burns 40M tokens to solve a trivial task is suspect, per the eval-awareness post).

### 5.2 Behavioral signals (run on sprint boundary)

- **Browser automation** — Playwright or similar MCP tool driving the running app. The GAN harness's central mechanism.
- **API surface checks** — hit endpoints, assert shape and status.
- **Database state checks** — assert rows exist, constraints hold, migrations ran.
- **Log diffs** — errors or warnings added by the change.
- **Screenshots + VLM diffs** — only as supplementary evidence, not primary grading.

### 5.3 Judge signals (LLM-as-judge with rubric)

- **Decomposed binary checks** per dimension (Anthropic's "isolated LLM-as-judge per dimension").
- **"Unknown" escape hatch** to reduce hallucinated verdicts.
- **Few-shot calibration** with written critiques (Hamel).
- **Separate judge model/prompt** — never the generator evaluating itself (GAN post).
- **Precision and recall tracking** against a human-labeled gold set (Hamel).

### 5.4 Contract signals

- **Sprint contract artifact** — generator writes intent and verification plan; evaluator approves before work begins; evaluator grades against the signed contract, not a moving target. Captures Shankar's criteria-drift problem by freezing criteria per sprint while allowing evolution across sprints.
- **Feature-list JSON** with `passes: false/true` per feature (from the Nov 2025 "Effective harnesses" post). Never marked `true` by the generator — only by the evaluator after browser-automated verification.

### 5.5 Trajectory signals (selective)

- **Forbidden tool calls** — e.g., the agent disabled tests, deleted files it shouldn't have, shelled out to a restricted command.
- **Pattern of rework** — repeated failed edits to the same location suggests the agent is stuck, not progressing.
- **Transition failure matrix** (Hamel) — map last-successful-state × first-failure-state to locate structural weaknesses.

### 5.6 Meta-signals

- **Infrastructure provenance** — log CPU/memory/concurrency/runtime per trial, per the infra-noise post; treat results cross-machine as not comparable unless pinned.
- **Human spot-check sampling** — non-negotiable per Hamel. Cheap if infrastructure exists to surface edge cases.

---

## 6. What does NOT work / known failure modes

- **Self-evaluation** — the GAN harness's foundational claim. Generator grading its own work slides toward approval.
- **Unitary rubric scores (1–5)** — both Hamel and Anthropic land on decomposed binary per dimension. 1–5 scores are ambiguous; different raters (human or model) interpret them differently.
- **Rigid string-match graders** — Anthropic's "96.12 vs 96.124991" example. For code, the analogue is exact-diff matching rather than functional equivalence; tests are better.
- **Trajectory grading that enforces specific tool-call sequences** — punishes valid alternative solutions.
- **Evaluator prompts that don't enforce strictness** — the GAN post's "talked itself into approving" failure. The fix was prompt refinement toward skepticism, plus hard thresholds.
- **Ambiguous task specs** — "agents shouldn't fail due to ambiguous specs." If the spec is unclear, the eval is measuring spec-interpretation, not ability.
- **Public benchmarks on contamination-prone topics** — the BrowseComp eval-awareness result. Models can recognize and decrypt benchmark answer keys. For coding, this means SWE-bench-style public issues will decreasingly discriminate between models.
- **Multi-agent configurations without contamination controls** — "3.7x higher contamination rates than single-agent setups" in the eval-awareness study.
- **Unpinned infrastructure** — up to 6-point score variation from resource allocation alone. "leaderboard differences below 3 percentage points deserve skepticism until the eval configuration is documented and matched."
- **Static eval suites** — Shankar: "not meant to be static"; Anthropic: "a living artifact that needs ongoing attention."
- **Generic metrics** — Hamel: "Good scores on them don't mean your system works."
- **Reward hacking / Goodharting** — the generator learns to please the specific judge. Partial mitigations: decomposed criteria, hard thresholds that can't be averaged around, contract signals that lock the target, occasional human review of high-scoring runs to catch suspicious behavior.

---

## 7. Recommendations for v1 of a reusable harness

Minimum viable evaluator for a reusable coding harness, in priority order.

### v1 (must-have)

1. **Separate evaluator process.** Different prompt, ideally different model, no access to the generator's scratchpad or chain-of-thought. Non-negotiable per the GAN post.
2. **Deterministic gate first.** Build + typecheck + lint + existing tests must pass before any LLM judge runs. If this fails, sprint rejected — don't waste judge tokens.
3. **FAIL_TO_PASS / PASS_TO_PASS test signal.** Borrow the SWE-bench pattern: the task specifies new tests that must pass *and* existing tests that must continue to pass. Catches regressions and scope creep.
4. **Sprint contract artifact.** Before each sprint, generator proposes (a) what it will build and (b) how completion will be verified. Evaluator approves or pushes back. Saved as a JSON/YAML file. This is the evaluator's grading rubric for that sprint — freezes criteria, prevents mid-sprint goal drift.
5. **Decomposed binary judge.** For non-test-gated aspects (code quality, UX, docs), one isolated LLM-as-judge per dimension, each returning pass/fail plus a written critique. Explicit "Unknown" escape hatch. Few-shot calibrated from ~20 hand-graded examples.
6. **Hard thresholds, no compensatory averaging.** Any single failing criterion fails the sprint. Matches the GAN post; aligns with Hamel's binary philosophy.
7. **Feature-list JSON with evaluator-only write access.** The generator cannot mark features as `passes: true`. Only the evaluator, after running behavioral checks, can flip the flag.
8. **Infrastructure provenance log.** Every trial records CPU/memory/timeout/model/tool-version. Results from different envelopes are not mixed. Cheap to implement, prevents apparent regressions that are actually noise.
9. **Transcript retention + trace viewer.** At minimum, dump the full generator and evaluator transcripts per sprint to disk with a consistent schema. Hamel's entire philosophy hinges on reading traces.

### v1.5 (nice-to-have if cheap)

10. **Browser automation via Playwright MCP** for any web work. The GAN post's central evaluator tool.
11. **Calibration against a small human-graded gold set.** Track judge precision and recall weekly. Flag drift.
12. **Judge skepticism instructions** — explicitly prompt the judge to treat identified issues as blocking, not to rationalize them away. This was the single most impactful prompt fix in the GAN post.

### v2 (punt)

13. **Trajectory-level evaluation** — transition failure matrices, tool-call pattern analysis. Only add when error analysis shows step-level failures are the bottleneck (per Hamel).
14. **Automated judge re-calibration.** EvalGen-style criteria drift tooling. Needs v1 to generate a usable dataset first.
15. **A/B testing infrastructure.** Only if the harness is used widely enough for real traffic to exist.
16. **Cross-model judges** — having a different model grade than the one generating, as a contamination/reward-hacking mitigation. Nice but not essential day one.
17. **Fuzzing / adversarial tests** for agent-written code. Strong signal but expensive to set up.

### What not to do in v1

- Don't try to build a rubric up front and freeze it. Per Shankar, criteria will drift once you see real outputs. Plan the iteration loop, not the "final" rubric.
- Don't let the generator grade itself, even partially. The GAN post's whole motivation.
- Don't use 1–5 scales for judge outputs. Decompose into binary dimensions.
- Don't skip deterministic gates in favor of a judge. Judges are expensive and noisy; tests and typecheck are neither.
- Don't treat infra noise as an engineering concern separate from eval quality — it's the same concern.
- Don't assume your eval criteria capture what you care about after one pass. The author of the GAN harness iterated "several rounds" on the QA prompt. Budget for that.

---

## Uncertainty / flags

- **Exact grading criteria and thresholds in the GAN harness post** are described narratively, not enumerated with numbers. My reconstruction of the four frontend criteria (design quality / originality / craft / functionality) and the "hard thresholds" mechanism is paraphrased from WebFetch summaries of the post, not verbatim quotes. The single verbatim evaluator quote I can fully vouch for is the "tuning a standalone evaluator to be skeptical" line.
- **SWE-bench internal mechanics (FAIL_TO_PASS / PASS_TO_PASS)** are correct as commonly documented in the SWE-bench paper and repo, but the overview page I fetched didn't expose the mechanism verbatim. I referenced them as a known community pattern, not an authoritative quote from today's fetch.
- **Shankar quotes** are from a fetched blog summary; the "Who Validates the Validators?" quotes are from the abstract-level summary, not the full paper.
- **The eval-awareness post's 3.7x multi-agent figure** is as reported in the WebFetch summary; I haven't independently verified it against the full post.
- **Calibration numerics** ("100+ labeled examples," ">90% agreement in 3 iterations" for Honeycomb) come from Hamel's writing and are examples, not universal constants. Treat them as order-of-magnitude guidance.
