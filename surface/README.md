# surface

The page a review puts in front of the captain, and the way their decisions get
back to the reviewer.

No dependencies. `node surface/cli.mjs` is the whole install.

## The one idea

Nothing waits. The tool this replaces had the reviewing agent block in a
foreground long-poll until the captain acted; that connection died on its own
every half hour or so, and each death fed an idle session an input it did not
need, which produced a turn, which woke the supervisor. Hundreds of wakes, none
of them work.

Here:

```
  review session   writes its spec, runs `surface open`, and STOPS
  captain          decides in the browser, hits send
  server           validates, writes decisions.json beside the spec,
                   and types one line into that review's tmux pane
  review session   wakes, runs `surface read`, acts, STOPS
```

A reviewer wakes exactly once per thing the captain sends, and never otherwise.

## Use

```sh
surface open <spec.json>   # register, start the server if needed, open the page, RETURN
surface read <spec.json>   # print decisions.json, exit 1 if the captain has not sent
surface url  <spec.json>   # the page URL, without opening a browser
surface list               # what this server knows about
surface claim-supervisor   # record this pane as the supervisor's, once per machine
surface stop               # shut it down
```

There is deliberately no `poll`.

`open` binds the review to the pane it runs in, via `TMUX_PANE`. **Run it from the
review's own session.** A wrong binding types the captain's decisions into
someone else's session, so three things guard it:

- The supervisor's pane is refused outright. Run `surface claim-supervisor` once
  from the supervisor's session, before any review registers. Without it the
  guard cannot fire — this is the mistake that happened twice while building
  this, and both times the captain's decisions were typed at the captain.
- A pane already claimed by another review is refused rather than stolen.
- Moving a review to a new pane is legitimate, since reviews get respawned, but
  it is reported rather than done silently.

## The spec

A review writes JSON; the page is generated from it. Reviews do not write HTML,
and specifically do not write forms.

```json
{
  "id": "pr-297",
  "title": "PR #297 review — toasts over overlays",
  "pr": "https://github.com/o/r/pull/297",
  "summary": "One sentence on what this branch changes for someone using the product.",
  "recommendation": { "value": "request-changes", "why": "one line" },
  "findings": [
    {
      "id": "f1",
      "title": "What is wrong, in plain words",
      "severity": "medium",
      "blocks_merge": true,
      "what_breaks": "The consequence, first.",
      "when": "The concrete situation that triggers it.",
      "why": "The underlying cause, explained conceptually.",
      "where": "Named the way the captain would name it, not by file.",
      "found_by": "which judge, or the reviewer's own read",
      "anchor": "src/Widget.tsx:61",
      "default": "inline",
      "comment": "The comment that goes out under the captain's name."
    }
  ],
  "nits": ["one line each"],
  "tests": "what ran and what passed",
  "judges": [{ "name": "Design", "verdict": "fail", "note": "what it turned on" }],
  "scope": "does the change match what was asked for"
}
```

`verdict` is `approve | approve-with-comments | request-changes | needs-discussion`.
Nits are `batched | all | skip`.

## Comments, or changes

The page carries one control above everything else: may this review touch the
branch?

- **Comments only** — the default, always. Findings become comments the captain
  approves; nothing is committed or pushed. Per-finding options are
  `inline | summary | drop`.
- **Apply the fixes I approve** — for the captain's own projects, where they are
  the only developer. Per-finding options become `fix | inline | drop`.

The default is set by the renderer, not the spec, so a review cannot hand over a
page already primed to edit someone's code. An absent or unrecognised mode in a
submitted payload is treated as comments, and an unknown one is refused outright.

What belongs on a page — the prose, the severity, whether a finding blocks merge —
is owned by `skills/coding/full-review.md`, not by this component. This renders
and collects.

## What cannot go wrong here

Three failures shipped before this existed. Each is now structural, not a rule
someone has to remember:

- **A control the form cannot see.** Every control is generated with a `name`.
  A verdict once had an id and no name, so `FormData` never saw it and a
  request-changes went out as a plain comment.
- **A draft that reads back empty.** Comment drafts are `<textarea>` read through
  `FormData`, and nothing reads rendered text from the DOM. Eight edited drafts
  once came back empty because they were read with `innerText` inside a collapsed
  `<details>`, which returns `""` for anything not rendered.
- **A blank page.** Pages are served from disk by id, with no negotiated token, so
  a reloaded tab or one reopened tomorrow behaves identically.

And a partial payload is refused twice — in the browser, and again on the server,
because the browser can be bypassed and what lands on disk gets posted under the
captain's name.

## Tests

```sh
node --test surface/test/surface.test.mjs
```

## Reference

`reference/` holds two real review pages from the tool this replaces. They are
the target to match, not markup to inherit — their hand-written decision forms
are exactly the bug class above.
