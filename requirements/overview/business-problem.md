# Business Problem

Autonomous long-horizon coding through Claude Code today is manual at the seams. The operator interactively authors requirements, breaks them into features by hand, writes work orders, then executes each one in a Claude Code session with in-session subagents for verification. Every step is valuable on its own, but the operator is the bottleneck, and verification across steps is ad-hoc — a passing test suite on incoherent requirements still produces unmaintainable code.

The operator needs a way to go from a drafted product description to merged pull requests without spending their day on the intermediate decomposition and scoping work. The harness solves this by promoting verification to a first-class concern at every stage — requirements, blueprints, and code — and by collapsing the intermediate authoring steps into autonomous loops that run under operator supervision rather than operator control.
