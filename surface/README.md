# surface

The page a review puts in front of Ribhav, and the way their decisions get
back to the reviewer.

No dependencies. `node surface/cli.mjs` is the whole install.

## The one idea

Nothing waits. The tool this replaces had the reviewing agent block in a
foreground long-poll until Ribhav acted; that connection died on its own
every half hour or so, and each death fed an idle session an input it did not
need, which produced a turn, which woke the supervisor. Hundreds of wakes, none
of them work.

Here:

```
  review session   writes its spec, runs `surface open`, and STOPS
  Ribhav          decides in the browser, hits send
  server           validates, writes decisions.json beside the spec,
                   and types one line into that review's tmux pane
  review session   wakes, runs `surface read`, acts, STOPS
```

A reviewer wakes exactly once per thing Ribhav sends, and never otherwise.

## Use

```sh
surface open <spec.json>   # register, start the server if needed, open the page, RETURN
surface read <spec.json>   # print decisions.json, exit 1 if Ribhav has not sent
surface url  <spec.json>   # the page URL, without opening a browser
surface list               # what this server knows about
surface claim-supervisor   # record this pane as the supervisor's, once per machine
surface stop               # shut it down
```

There is deliberately no `poll`.

## Reviews on an iPhone

Use the updated TabTail app and Mac adapter with your existing SSH-over-Tailscale
setup. The surface still listens only on `127.0.0.1:4390`. No public listener,
cloud host, second login, or copied HTML is needed. Enable it once per project:

```sh
fm remote yes --project /absolute/path/to/project
# Restore Mac-browser launches:
fm remote no --project /absolute/path/to/project
```

This preserves other `.fm2.json` fields and sets `"remote": true/false`. It is
read again whenever a review opens, including in existing workers; no live
session needs restarting. Keep that config local if the choice is personal.
Without a saved setting, `FM_REMOTE=yes fmp project` works for a newly launched
panel. Workers receive the project identity and resolved value explicitly,
rather than inheriting the shared tmux server's environment. No `.env` file is
executed or auto-loaded. `yes/true/on/1` enables remote delivery;
`no/false/off/0` or unset preserves desktop behavior. A saved project setting
wins over an inherited launch value; invalid values fail with an explanation.

In TabTail, choose the Mac, then **Reviews** (also in the terminal's collapsed
menu). The inbox labels reviews by project and separates waiting and sent
decisions. Read the same generated form, edit its comments/verdict, and send.
The terminal remains mounted behind it. Drafts stay in phone memory across
closing the sheet, backgrounding, and reconnects, scoped to device/review/round.
Force-quitting loses unsent drafts. The Mac must remain awake and reachable.
The badge refreshes while connected; there are no background push notifications.

Decisions are saved before notifying the original worker. The page distinguishes
a confirmed wake from saved decisions without a confirmed notification.
Durable submission receipts prevent a retry after a lost acknowledgment from
waking twice, including after a server restart. Old review rounds are refused.
A second, different submission cannot overwrite a saved round. Reconnecting
loads the actual saved choices if another page sent them. The original pane's
socket, PID and process birth time are checked; both typing and Enter are gated
against pane replacement and synchronized input. A dead/reused pane cannot
receive an older worker's decisions. Existing page
URLs remain valid; colliding IDs across projects get a stable path suffix.
Reopen a review from its owning worker after upgrading an old registration so
the original pane identity is recorded; reload any already-open browser page.

The local JSON endpoints are `/api/reviews`, `/api/<id>/page`, and
`/api/<id>/decisions`. The adapter forwards only list/open/submit, never arbitrary
HTTP hosts/ports/files. The embedded page bundles its assets and has no network
or native credential access. Same-origin JSON submissions still serve desktop
pages. Keep the server bound to loopback; these APIs are not a network login.
For custom `SURFACE_PORT`, install the adapter with matching
`RELAY_SURFACE_PORT`. An old/missing harness or adapter shows a setup message in
Reviews without interrupting terminal access.

A review that opens its page again for a new round rewrites its spec first. `open`
then moves the previous round's `decisions.json` aside as `decisions-<time>.json`,
so `read` waits for Ribhav's answer to this round instead of returning the last one.

`open` binds the review to the pane it runs in, via `TMUX_PANE`. **Run it from the
review's own session.** A wrong binding types Ribhav's decisions into
someone else's session, so three things guard it:

- The supervisor's pane is refused outright. Run `surface claim-supervisor` once
  from the supervisor's session, before any review registers. Without it the
  guard cannot fire — this is the mistake that happened twice while building
  this, and both times Ribhav's decisions were typed at Ribhav.
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
  "product_changes": [
    {
      "title": "The change, in a few words",
      "who": "Who notices it.",
      "today": "What they see or do today.",
      "with_pr": "What they will see or do once this merges.",
      "source": "The work order, a design, or the author's own call."
    }
  ],
  "recommendation": { "value": "request-changes", "why": "one line" },
  "findings": [
    {
      "id": "f1",
      "title": "What is wrong, in plain words",
      "severity": "medium",
      "blocks_merge": true,
      "today": "What the product does in this situation today.",
      "with_pr": "What it will do once this merges.",
      "what_breaks": "The consequence, first.",
      "when": "The concrete situation that triggers it.",
      "why": "The underlying cause, explained conceptually.",
      "where": "Named the way Ribhav would name it, not by file.",
      "found_by": "which judge, or the reviewer's own read",
      "anchor": "src/Widget.tsx:61",
      "default": "inline",
      "comment": "The comment that goes out under Ribhav's name."
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

`product_changes` renders first on the page, above the verdict: what the PR
changes for the people using the product, each as today and with this PR. A
finding's `today` and `with_pr` render at the top of its card. All of them are
optional, and a side that is absent is left out rather than shown empty.

## Comments, or changes

The page carries one control above everything else: may this review touch the
branch?

- **Comments only** — the default, always. Findings become comments Ribhav
  approves; nothing is committed or pushed. Per-finding options are
  `inline | summary | drop`.
- **Apply the fixes I approve** — for Ribhav's own projects, where they are
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
Ribhav's name.

## Tests

```sh
node --test surface/test/surface.test.mjs
```

## Reference

`reference/` holds two real review pages from the tool this replaces. They are
the target to match, not markup to inherit — their hand-written decision forms
are exactly the bug class above.
