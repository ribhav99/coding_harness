# Success Metrics

Success is judged by whether the harness lets a single operator carry a project end to end without doing the work the loops are meant to automate. Four indicators matter:

A single operator takes a drafted PRD to a stream of merged pull requests without writing Python code between steps and without hand-authoring individual work orders. The pipeline runs, artifacts flow, PRs open — the operator reviews and merges but does not break glass mid-loop to produce intermediate artifacts.

Autonomous loops converge. A typical run passes within a bounded number of attempts. Exhaustion — hitting the retry cap — is rare. When exhaustion does happen, the fix is almost always to improve the input artifact (tighten the PRD, resolve a bubble-up, amend a blueprint), not to patch the harness itself.

The harness is self-maintainable by one operator. Adding a reviewer, tweaking a prompt, or adjusting the loop mechanic does not require a multi-person review cycle. The design keeps orchestration thin and pushes complexity into prompts and skills so that single-file edits are the normal change unit.

Per-loop operator involvement stays bounded. The operator reviews and responds to bubble-ups — blueprint-loop decisions, PR reviews — but does not do the authoring, decomposition, or scoping work the loops are meant to automate. If bubble-up frequency or PR rework climbs, the loops have lost their leverage.
