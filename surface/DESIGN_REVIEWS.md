# Private image and design reviews in TabTail

This workflow requires the image-capable harness runtime from this change to be
reviewed and activated. Source files or new instructions alone do not update a
running server. It uses the existing released TabTail review WebView and Mac
adapter protocol 1; neither needs an update for reviews within the limits below.
Choose **TabTail → selected Mac → Reviews**. The Mac must be reachable over the
existing authenticated SSH connection. No image host, extra login, public URL,
file server, adapter install or phone release is involved.

## Agent recipe

Run from the **owning worker**, never the controller or another worker's pane.
Keep the spec and selected exports in a meaningful, private artifact directory
outside disposable worktrees, for example `~/.fm2/briefs/<task>/design/`.
Use a separate directory for each review: decisions and receipts live beside its spec.

1. Export actual product screenshots, mockups or generated designs as static PNG
   or JPEG. Copy only the intended images into `images/` under that directory.
   A Mac source path, localhost URL or remote image URL in prose is insufficient.
   Use a unique, stable ID for each image (such as `before`, `home-a`, `home-b`).
2. Write `review.json` using the schema below. For standalone design review use
   `review_type: "design"`, with real design questions and alternatives. Do not
   invent code defects or create a PR just to collect design feedback.
3. Enable remote delivery for this invocation without changing project settings:
   `FM_REMOTE=yes surface open /absolute/artifact/directory/review.json --no-open`.
   `--no-open` guarantees the Mac browser stays closed. A saved project `remote`
   setting takes precedence over the environment flag; if it is explicitly false,
   the controller can set `fm remote yes --project /absolute/project` after this
   feature is active. See [delivery precedence](README.md#reviews-on-an-iphone).
4. Tell the user the design is available in that Mac's Reviews, then **stop the
   turn**. Do not poll. Do not open a Mac browser or publish the images.
5. On the decision wake, run `surface read /absolute/artifact/directory/review.json`.
   Read the actual saved choice and exact comments. Design approval approves the
   displayed direction only: it does **not** authorize code edits, GitHub review
   posting, public sharing or merging. Continue only within separately authorized
   work; a request for more mockups can be handled as another design round.

For an existing code/product review, add only `media` to its normal spec. Its
finding IDs, modes, verdicts and decision semantics stay the same. Refer to image
IDs in the finding prose. Product images are an explicit exception to the review
page's no-code rule; source screenshots, diffs, code excerpts and stack traces
remain forbidden.

## Schema

```json
{
  "id": "workout-home-design",
  "review_type": "design",
  "title": "Workout home — choose a direction",
  "summary": "Compare the current screen with two proposed directions.",
  "media": [
    { "id": "before", "path": "images/before.jpg", "title": "Before", "alt": "Current workout list", "caption": "Baseline for comparison." },
    { "id": "home-a", "path": "images/home-a.jpg", "title": "A — focused next workout", "alt": "Workout home with one prominent start button", "caption": "Next action leads." },
    { "id": "home-b", "path": "images/home-b.jpg", "title": "B — progress first", "alt": "Workout home with a weekly progress hero", "caption": "Progress leads." }
  ],
  "design_questions": [
    {
      "id": "home_direction",
      "title": "Which direction should we explore?",
      "options": [
        { "id": "focused", "label": "A — focused next workout", "media": ["before", "home-a"] },
        { "id": "progress", "label": "B — progress first", "media": ["before", "home-b"] }
      ]
    }
  ]
}
```

`media` also works on ordinary code reviews. Paths are relative to the spec's
containing directory, must stay inside it, and cannot traverse symlinks. Paths
are read by the trusted local CLI only at registration, never supplied by phone
input. `id`, `path`, `title` and `alt` are required; `caption` is optional. IDs use
1–64 letters, digits, underscores or hyphens. Titles/alt text/paths have a 2,000
character limit; captions have a 4,000 character limit. Unknown fields fail
rather than disappearing. Image IDs and question IDs must be unique within their
respective arrays; option IDs must be unique within each question. Option media
references must name attached images.

Standalone design reviews have 1–12 questions, each with 2–12 options. They do not
carry `pr`, `own_pr`, code `findings` or `nits`. No option is preselected and the
verdict defaults to discussion. Approval requires an explicit selection for every
question; change/discussion feedback can leave a question undecided. The page
shows before/after and alternatives sequentially on a phone. Image reference
buttons jump back to the matching figure without navigating the WebView. Enlarge
opens an in-page viewer with fit / 2× / 4× / 8× controls and horizontal/vertical
scrolling; the original raster is retained. Closing it preserves the form draft.

### Saved feedback and compatibility

The released phone accepts only the existing decision fields. Design questions
therefore travel in `findings` as **design feedback records**, not fake defects:

```json
{
  "review_type": "design",
  "mode": "comment",
  "verdict": "approve-with-comments",
  "findings": {
    "home_direction": {
      "decision": "summary",
      "comment": "{\"choice\":\"focused\",\"comment\":\"A is clearer; increase chart contrast.\"}"
    }
  },
  "nits": null,
  "message": "Make another mockup before implementing."
}
```

The server adds `review_type: "design"` and explanatory `_fields` to the saved
file; the phone still sends only `mode`, `verdict`, `findings`, `nits`, `message`,
round and submission ID. Parse each question's `comment` as JSON `{choice,
comment}`. `choice` is an option ID or `null`; resolve it and its image references
against the spec for that round. Preserve the user's exact feedback. Design
verdict values reuse `approve`, `approve-with-comments`, `request-changes`,
`needs-discussion` with **design-only** labels and meaning. Never feed a design
record into the code-review posting/fixing procedure. The server rejects design
`mode: change`, code findings, unknown choices and approval without a choice.

Drafts retain the existing phone behavior: in-memory, scoped to device/review/
round, preserved across sheet close/background/reconnect, lost on force quit.
The page does not approve anything when an image loads. All attached images must
decode before the Send button enables. A corrupt/unsupported raster shows an
explicit image error; the owning worker replaces it and opens a new round.
Decision commits and media registration share a lock, so a delayed submission
cannot answer a generation superseded while its body was arriving. Decisions save
before notification. Retries reuse durable receipts and cannot
wake twice. Dead/reused/synchronized/controller panes retain the existing wake
protections. Stale and closed reviews refuse submissions.

## Limits and durable rounds

| Boundary | Supported limit |
| --- | --- |
| Formats | Static PNG and JPEG only; no SVG, HTML, GIF, animated PNG, WebP or URLs |
| Count | Up to 8 images per review |
| Encoded bytes | At most 640 KiB combined original raster bytes, including metadata |
| Dimensions | At most 8 megapixels per image, 8192 pixels on either side; 24 megapixels combined |
| Embedded response | Entire serialized JSON page at most 1 MiB (existing adapter limit) |
| Quality | No automatic resizing/recompression; exact exported pixels/bytes retained |

A runnable example includes **three 1170 × 2532 JPEG mockup screenshots**, exported
at JPEG quality 80, plus a choice between two directions and a before image. It
fits the unchanged adapter response limit. This is sufficient for multiple
full-size app designs, not an unlimited image delivery service. Photo-heavy,
lossless, unusually tall or larger collections may exceed the budget. Export
optimized JPEGs at full resolution, shorten the prose/feedback or split into
separate focused reviews. Never silently shrink, omit or replace an image to fit.
The CLI preflights image-bearing pages with metadata headroom; the server also
measures the actual JSON response and saved-form projection. Overages fail with
an actionable error. Supporting bigger bundles in one page would require a
separately reviewed adapter/app transport change and the deferred release flow.

On `surface open`, only declared images are snapshotted into content-addressed,
private `.surface-media/` files beside the spec. The registry records exact image
descriptors and digests. Subsequent source-image replacement/deletion cannot
change an opened round; reads use and verify the snapshots. Retain that artifact
directory, registry and decisions until the review record is no longer needed.
Do not overwrite/delete `.surface-media` files. A missing or altered snapshot
fails explicitly. Updating attachment descriptors requires `surface open` again.
Reopening after an exported source changes snapshots the new bytes, changes the
round even if the JSON/mtime did not change, and archives stale decisions. Old
pages and phone drafts cannot answer the new round. `surface read` likewise
returns only current-round decisions. Keep the normal new-round practice of
rewriting the spec first, including when only prose or questions change.

## Runnable example

After the reviewed harness is active, from the owning agent's pane:

```sh
# Point HARNESS at the reviewed, retained checkout used by surface.
HARNESS=/absolute/path/to/reviewed/coding_harness
artifact="$HOME/.fm2/briefs/my-design-task/design"
mkdir -p -m 700 "$artifact/images"
cp "$HARNESS/surface/examples/design-review/review.json" "$artifact/review.json"
cp "$HARNESS/surface/examples/design-review/images/before.jpg" "$artifact/images/before.jpg"
cp "$HARNESS/surface/examples/design-review/images/calm.jpg" "$artifact/images/calm.jpg"
cp "$HARNESS/surface/examples/design-review/images/bold.jpg" "$artifact/images/bold.jpg"
FM_REMOTE=yes surface open "$artifact/review.json" --no-open
# STOP. On the owning worker's decision wake:
surface read "$artifact/review.json"
```

For real work, replace those three explicit copies and descriptors with the
agent's selected exports; retain meaningful IDs, titles and alt text. On macOS a
full-resolution PNG export can be converted without resizing with
`sips -s format jpeg -s formatOptions 80 source.png --out "$artifact/images/home-a.jpg"`.
Check the output visually before registering it. `mockup.html` beside the example
is the illustrative UI source, **not** a review page to open or ship to the phone.

Controller instruction for fitness design agents, **only after activation**:

> Read the active harness's `surface/DESIGN_REVIEWS.md`. Package your selected
> screenshots/mockups in `~/.fm2/briefs/<your-task>/design/images/`, write a
> standalone `review_type: "design"` spec with titled images and real design
> choices, and run `FM_REMOTE=yes surface open <absolute-review.json> --no-open` from your
> own worker pane. Keep delivery remote, then stop. Read `surface read <spec>` on
> wake; treat the result as design feedback, with no code or GitHub action unless
> separately authorized. Preserve the exports and `.surface-media` for that round.

## Verification and activation

Run `node --test surface/test/*.test.mjs`. The opt-in WebKit check is
`node surface/test/media.webkit.mjs`; supply `SURFACE_PLAYWRIGHT_MODULE` (absolute
path to `playwright/index.mjs`), `SURFACE_EVIDENCE` (durable output folder)
and, if needed, `PLAYWRIGHT_BROWSERS_PATH` / `SURFACE_PYTHON`. Set
`SURFACE_MOBILE_REPO` to the read-only mobile_build repository. The test exports
only `common.py` and `reviews.py` from pinned released commit
`c3f41d3b4b3e282031386e227f8f31d69ffbfb20` into its private fixture package,
then uses the checked-in `surface/test/adapter_fixture.py` wrapper. It never
installs or restarts the adapter. For example, with an isolated Playwright install:

```sh
SURFACE_PLAYWRIGHT_MODULE=/absolute/test-deps/node_modules/playwright/index.mjs \
SURFACE_MOBILE_REPO=/absolute/path/to/mobile_build \
SURFACE_EVIDENCE="$HOME/.fm2/briefs/my-design-task/evidence" \
node surface/test/media.webkit.mjs
```

The check uses a private temporary surface home, ephemeral loopback port and
private tmux socket/pane. It exercises actual registration → bundled page →
unchanged restricted adapter → WebKit decode, with no file/network access from
the embedded page. It saves gallery, enlarged-image, feedback and corrupt-image
screenshots, the embedded response, and a machine-readable result. It checks
exact draft restoration, choice/comment submission, one wake on retry, stale and
closed rejection, and CSP request blocking. It is browser emulation at
390 × 844 CSS pixels / DPR 3, **not a physically observed phone test**. The viewer
uses the native HTML dialog supported by [WebKit since Safari 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

Activation remains separate from source delivery and requires the fresh full
review and resolved merge decisions. No install/restart is performed by this
assignment. Before a later authorized update, preserve the primary checkout's
local commits/files and back up `~/.surface/reviews.json`, supervisor bindings,
and each registered spec directory with its decisions, receipts and media. Use
a retained reviewed checkout/runtime path or deliberately reconcile the primary
local commits; do not reset or overwrite that checkout. Keep the same
`SURFACE_HOME` and `SURFACE_PORT`. The normal updated CLI detects a changed build
stamp on the next authorized `surface open` and restarts only that surface
process, restoring registrations/decisions from disk. Existing text-only entries
need no migration; reopen from their owning workers only if old entries lack
pane identity. Reload already-open pages. New media specs must be opened by the
updated CLI; old running code will reject their fields. Update installed skill
links/instructions through the normal reviewed installer workflow; reading this
file alone does not activate agent instructions. Do not change/restart the Mac
adapter, alter phone releases, or reopen workers from a controller pane.
