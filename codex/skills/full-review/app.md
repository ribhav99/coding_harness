# Full Review

Perform this review in the current Codex task. Use collaboration subagents for
the judges; create a separate user-facing task only if the user explicitly asks
for one. The deliverable is a set of verified, actionable findings in the app,
with a recommendation and the evidence needed to decide what to do.

## Establish scope and authority

Read the target repository's instructions, including applicable path-scoped
rules, before reviewing its files or running checks. Its architecture, branch,
test, and PR conventions take precedence over generic harness conventions.

Resolve the repository, requested PR or local changes, head revision, and base
from the user's request and git/forge metadata. Inspect the worktree before
switching anything; preserve existing changes. For a PR, verify its actual head
and base rather than assuming the checkout matches. For a local review, include
uncommitted changes only when they are in the requested scope. Read the full
work order or issue when available, using its explicit reference or the branch
name; the review does not require a ticket or harness environment variables.

Establish author or reviewer mode from the PR author and authenticated account.
Without a PR, use commit authorship and the user's context. Mixed or uncertain
authorship means reviewer mode. State the mode briefly. Authorship alone is not
permission to change code or publish a review; carry forward the user's actual
authorization, including any previously approved fixes or posting decisions.

Keep code actions and the review verdict separate. A request to apply fixes is
not an instruction to approve a PR, and approval of a PR is not permission to
edit its branch. A review request by itself produces findings.

## Independent review

Read the diff and commit history to identify the raw scope. Then launch all six
judge lenses using `collaboration.spawn_agent`, with a separate fresh context
for each (`fork_turns: "none"`):

| Skill | Responsibility |
| --- | --- |
| `code-spec-judge` | Acceptance criteria and interface compliance |
| `code-regression-judge` | Breakage outside the changed lines |
| `code-quality-judge` | Maintainability and repository hygiene |
| `code-security-judge` | Security boundaries across the stack |
| `code-design-judge` | Architectural fit |
| `code-adversarial-judge` | Missing guarantees and incomplete behavior |

Locate and read each installed judge skill before dispatch, and give its exact
path to the corresponding agent. Pass the repository path, base/head revisions,
scope of uncommitted changes if any, and paths or full raw text for the work
order, issue, and relevant source documents. Ask for full findings with concrete
trigger, consequence, evidence, location, and verdict. Do not pass your findings,
other judges' findings, a prior review summary, or a suspected fix as context.
Each judge must read the repository instructions and source for itself. Require
read-only review apart from agreed test artifacts, and no external posting.

Run the judges in bounded waves within the actual available concurrency. Omit
model and effort overrides so they inherit the configured settings. Give each
judge its full remit; a slot limit is a scheduling constraint, not a reason to
drop a lens. Do not run competing test suites against the same server or shared
database. Coordinate execution ownership separately from read-only analysis.
If subagents are unavailable, perform the six lenses sequentially and disclose
that they were not independent agents.

While judges run, complete your own independent pass before reading their
results or any prior review log:

- Read the full diff and follow changed data flows into callers and consumers.
- Check interfaces, error paths, naming, dead code, and repository requirements.
- Run the relevant project checks, including required preflight gates, or assign
  their execution to one runner and inspect its actual results.
- Cross-check the work order against the authoritative PRD and architecture
  sources, including a sibling PRD repository when the project identifies one.
  Verify scope, release phasing, ownership, and terminology.
- For migrations, verify revision links, schema/model alignment, reversibility,
  and the repository's migration-count constraint.
- Look for omitted operations, permissions, edge cases, and guarantees that a
  user or downstream consumer relies on.

Read `temp/review-log.md` if it exists only after your independent pass. Respect
recorded resolutions and accepted risks when they still apply; a changed premise
requires fresh evidence, not automatic suppression or repeated argument.

Use collaboration completion events and bounded waits to collect every judge.
If the user cancels, interrupt each running judge and confirm their states before
claiming the review stopped. Report any judge that failed to complete; do not
treat an absent report as a pass.

## Reconcile and present

Take the union of findings, deduplicate by underlying cause, and verify each
survivor yourself against the current code. Re-derive severity from the concrete
failure and the system's existing protections. Drop claims disproved by the
evidence. Distinguish uncertainty from a reproduced failure.

Separate behavior or contract judgments from mechanical nits. A conditional,
error path, test assertion, migration, exported name, or uncertain refactor is
a judgment. Batch cosmetic or linter-proven nits into one short summary. Finish
the review before applying authorized fixes so the evidence has a stable basis.

Open the native diff with `mcp__codex_app__open_in_codex` using a review target
and the verified base revision for a branch review, or the appropriate staged
or unstaged view for local changes. Emit one `::code-comment` directive for each
actionable anchored finding, using an absolute file path, verified one-based
line number, priority, and a short title carrying a stable ID such as `F1`.
These local review annotations present findings; they do not post to GitHub.
For a finding without a valid line anchor, keep it in the concise task response.

Explain the consequence first: what breaks, when, why, and where in the product.
Include severity and whether it blocks merge. Show exact proposed outgoing
comment text before asking for its approval. Keep code and diff excerpts in the
native review panel; the explanation should stand on plain language. Summarize
the recommendation, judge completion, checks run, PRD alignment, and material
limits without repeating every inline finding in chat. If there are no findings,
say so and emit no code-comment directives.

There is no review HTML file, server, tmux binding, or decisions-file loop.
Decisions arrive as replies in this task. If user decisions are still required,
present the complete review first, ask once for the specific outstanding
decisions, and end the turn. Never poll for an answer or start a reminder unless
the user requested one. If a permission question is required by this skill,
link this skill and explain the exact requirement: "Publish only the findings,
wording, and review event the user approved."

## Act on decisions

Track each finding by its stable ID: fix, comment inline, raise in summary,
defer, or drop. Honor existing authorization. An explicit instruction covering
all displayed findings can authorize that identified batch; do not ask again
for each item already covered. Unaddressed findings remain unsent and unfixed.

For fixes, recheck the data flow, implement only the authorized scope, and run
the checks appropriate to the change. In author mode, keep any authorized
mechanical cleanup separate from behavior fixes when that makes the commits
reviewable; do not create empty or arbitrary commits. On someone else's PR,
a decision to apply an identified fix means deliver it on the PR's own branch,
committed and pushed, unless the user restricted the change to local work or
withheld publication. Preserve its history and use ordinary fast-forward pushes.
If a push is rejected, stop and report the mismatch; never force-push or quietly
move the fix to a different branch. A fix-only instruction does not authorize
publishing review comments. Explain any approved fix that cannot be completed.
If the user also approved a review verdict on the expectation of those fixes,
verify they reached the PR before submitting that verdict; report an unlanded
fix instead of approving a different revision from the one they chose.

Publish only the findings, wording, and review event the user approved. Submit
one PR review for that approved batch: anchored comments, cross-cutting summary
points, and at most one approved nits paragraph. Omit dropped findings entirely.
`approve-with-comments` means an `APPROVE` event. Never infer `APPROVE` or
`REQUEST_CHANGES` from green checks or from permission to comment. If the user
authorized comments but chose no verdict, use a comment review. Do not downgrade
an explicit approval because its comments describe remaining work.

Before posting, re-read the PR head and validate every approved anchor against
the current diff. If the head changed, recheck affected findings and report any
material change before sending different text. Check existing reviews before
retrying an uncertain submission so the approved batch is not posted twice.
Confirm the result on the forge and report the actual outcome with the PR URL.

Record defer/drop decisions and their reasons in an existing project review log
when its convention permits, preserving prior entries. Otherwise retain them
in this task. Do not create review scaffolding inside a project that does not
use it. State which findings remain unsent or unresolved.

Do not merge, archive the task, or message the author/Slack merely because the
review is finished. After pushing fixes to another author's branch, report that
their review is needed. Send that request only with explicit authorization to
message them, after verifying the pushed commit is on the branch.
