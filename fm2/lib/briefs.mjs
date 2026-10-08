// The opening prompt each kind of session is launched with. Each one carries
// only what the harness owns - where its work goes and that stopping is the
// report - and leaves the work itself to the spec or the skill it names.

// Kicking off a review is invoking the review skill on the PR. Nothing else.
//
// This brief was once fifty lines re-deriving the skill's own rules - the modes,
// the surface, comments-only by default, what an approve means, where fixes get
// pushed. All of it already lives in `full-review`, which is the thing that
// actually runs. A second copy in the launch prompt does not reinforce the skill,
// it competes with it: the moment the skill changes, the brief is stale
// instructions arriving first and outranking it by being in the prompt.
//
// What stays is only what the skill cannot know, because it belongs to the
// harness rather than the review: where the report goes so the findings outlive
// the session, and that stopping is how a worker reports at all.
export const REVIEW_BRIEF = (prUrl, reportPath, specPath) => `Run the \`full-review\` skill against ${prUrl}, and follow it to completion.

Two things the skill does not know about, because they are this harness's and not its:

Keep your review's own files out of the worktree - put the spec at ${specPath} and
write your outcome to ${reportPath}. The project's pre-push gate lints everything it
finds in its tree and will fail the author's gate on scaffolding that is not theirs,
and the report is what survives this session.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so make it two or three lines saying what you
concluded and what, if anything, you need. Anything you need him to decide goes on
the review page, not in that message - he answers decisions from the pages.`;

// Not every review wants the judge panel. A dependency bump Ribhav wants checked
// and landed is a review in the harness's eyes - a cold session at the PR head,
// a report, a close that asks for one - but the brief is his words, not the
// skill's. What the harness owns is unchanged; only what is asked differs.
export const PLAIN_REVIEW_BRIEF = (spec, prUrl, reportPath) => `You are reviewing ${prUrl}. Do not run the \`full-review\` skill; this is what is asked instead:

${spec}

You are in an isolated git worktree, detached at the PR's head. Keep your own files out of
it - write your outcome to ${reportPath}. The project's pre-push gate lints everything it
finds in its tree, and the report is what survives this session.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so make it two or three lines saying what you
concluded and what, if anything, you need.`;

export const SHIP_BRIEF = (spec) => `You are an autonomous worker. Work on your own; do not wait for a human.

${spec}

You are in an isolated git worktree on your own branch. Implement it, push, and open a
PR. Do not merge it.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so end with two or three lines saying what you built
and the PR's full URL.`;

// `attach` puts a worker on a branch that already exists, usually one with a PR
// open. The ship brief was wrong there on both counts: it said to open a PR that
// already exists, and never to merge, when the task it carries is often exactly
// the merge - take develop, fix the clash, squash it in. One such worker did all
// of that and then refused the merge it was sent for (#515). The task decides.
export const ATTACH_BRIEF = (spec) => `You are an autonomous worker. Work on your own; do not wait for a human.

${spec}

You are in a worktree on a branch that already exists, usually one with a PR open. Do
the task as written: it decides whether you push to that PR, open one, or merge it.
Push with plain pushes only - never force, and never skip hooks.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so end with two or three lines saying what you did and
the PR's full URL.`;

// Not every worker is shipping something. An open question - how should this
// work, what is this costing us, is this approach even right - handed the brief
// above gets a worker that opens a PR to look finished, which is the opposite of
// what an unanswered question needs.
export const INVESTIGATE_BRIEF = (spec) => `You are a worker on an open question. Think it through. Do not implement it.

${spec}

You are in an isolated git worktree on your own branch. Read as widely across the project
as the question needs, and keep whatever you produce - notes, a proposal, a throwaway
prototype used only as evidence - inside this worktree. Do not open a PR, and do not
change how the project works to prove a point.

Ribhav is going to work this through WITH you, so what this first pass owes them is
a proposal worth arguing with: what the real constraint is, the options you can actually
see and what each costs, and which one you would pick and why. Where you are guessing,
say you are guessing - a confident wrong answer costs more here than an open question.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so end with two or three lines saying what you found
and the call you would make.`;
