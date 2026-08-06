# Reference artifacts

Two real review pages from 2026-08-05, kept because they are the concrete target the
rewrite has to match. They live in worktrees that get deleted, so they are copied here
before that happens.

- `example-review-request-changes.html` — PR #297, five findings, request changes.
- `example-review-approve-with-comments.html` — PR #298, eight findings none blocking,
  plus the batched nits section.

They are reference only. Nothing loads them, and the rewrite does not inherit their
markup — in particular their hand-written decision forms are the bug class the
generated form exists to remove.

The content contract they demonstrate is owned by `skills/coding/full-review.md`
(section "Build the review surface"), not by this directory.
