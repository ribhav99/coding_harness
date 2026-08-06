// Render a review spec into the page the captain decides on.
//
// This module is the reason the surface exists. Every review used to hand-write
// its own decision form, and two of them got it wrong in different ways on the
// same afternoon: one put an id but no name on the verdict control, so the
// captain's choice never entered the form data and a request-changes went out as
// a plain comment; another read comment bodies with innerText inside a collapsed
// <details>, which returns "" for anything not rendered, so eight edited drafts
// came back empty and the reviewer posted its own text instead.
//
// Both are structurally impossible here, because reviews no longer write forms.
// They write content; this generates every control exactly once:
//
//   - every control carries a name, unique per finding
//   - comment drafts are <textarea>, read by .value, which reports whether or
//     not the element is visible, collapsed, or scrolled out of view
//   - nothing in the client reads text out of the DOM, so innerText never
//     appears and cannot silently return empty
//
// Content - what a finding says, in what words - is not decided here. That
// contract belongs to skills/coding/full-review.md. This file decides only how a
// decision is collected.

// Two modes, and the default is never in doubt.
//
// On someone else's branch a fix is not yours to make, and the captain's rule is
// blunt: review sessions do not touch review branches. On their own projects,
// where they are the only developer, applying an approved fix is the point. So
// the page carries the choice - but "comment" is chosen by the renderer, not
// supplied by the review, so a review cannot hand the captain a page that is
// already set to change their code.
const MODES = [
  ['comment', 'Comments only — the branch is not touched'],
  ['change', 'Apply the fixes I approve'],
];
export const DEFAULT_MODE = 'comment';

const DECISIONS = [
  ['inline', 'Comment inline'],
  ['summary', 'Raise in summary'],
  ['drop', 'Drop'],
];

// What a decision means when the captain has allowed changes.
const CHANGE_DECISIONS = [
  ['fix', 'Fix it'],
  ['inline', 'Comment only'],
  ['drop', 'Drop'],
];

const VERDICTS = [
  ['approve', 'Approve'],
  ['approve-with-comments', 'Approve with comments'],
  ['request-changes', 'Request changes'],
  ['needs-discussion', 'Needs discussion'],
];

const NIT_CHOICES = [
  ['batched', 'One batched line in the summary'],
  ['all', 'All of them, individually'],
  ['skip', 'Skip entirely'],
];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A finding needs a stable id: it keys the controls, the submitted decisions, and
// the validation error that points back at the card. Reviews may supply one;
// where they do not, position is stable enough for a page that is generated once.
function findingId(finding, index) {
  const raw = String(finding.id ?? `f${index + 1}`).trim();
  return raw.replace(/[^A-Za-z0-9_-]/g, '-') || `f${index + 1}`;
}

function radioGroup(name, options, selected) {
  return options
    .map(([value, label]) => {
      const id = `${name}-${value}`;
      const checked = value === selected ? ' checked' : '';
      return `<label class="choice" for="${escapeHtml(id)}">
  <input type="radio" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${checked}>
  <span>${escapeHtml(label)}</span>
</label>`;
    })
    .join('\n');
}

function severityBadge(finding) {
  const severity = String(finding.severity ?? '').toLowerCase();
  if (!severity) return '';
  const blocks = finding.blocks_merge === true;
  return `<span class="badge sev-${escapeHtml(severity)}">${escapeHtml(severity)}</span>
<span class="badge ${blocks ? 'blocks' : 'nonblocking'}">${blocks ? 'blocks merge' : 'does not block'}</span>`;
}

// One card. The prose fields are optional and omitted entirely when absent, so a
// short finding does not render a run of empty headings.
function renderFinding(finding, index) {
  const id = findingId(finding, index);
  const prose = [
    ['What breaks', finding.what_breaks],
    ['When', finding.when],
    ['Why', finding.why],
    ['Where in the product', finding.where],
  ]
    .filter(([, body]) => body)
    .map(
      ([heading, body]) =>
        `<div class="block"><h4>${escapeHtml(heading)}</h4><p>${escapeHtml(body)}</p></div>`,
    )
    .join('\n');

  const anchor = finding.anchor
    ? `<div class="anchor">would be posted on <code>${escapeHtml(finding.anchor)}</code></div>`
    : '<div class="anchor">summary-level — not anchored to a line</div>';

  const foundBy = finding.found_by
    ? `<p class="found-by">Found by: ${escapeHtml(finding.found_by)}</p>`
    : '';

  // The draft is a textarea, not a rendered div, and it is never inside a
  // collapsed container. Both are deliberate: this is the exact shape that
  // returned empty last time.
  return `<article class="finding" id="card-${escapeHtml(id)}">
  <header>
    <h3>${escapeHtml(finding.title ?? `Finding ${index + 1}`)}</h3>
    <div class="badges">${severityBadge(finding)}</div>
  </header>
  ${prose}
  ${foundBy}
  <div class="decision">
    <div class="decision-head">Decision</div>
    <div class="choices mode-comment">
${radioGroup(`${id}-decision`, DECISIONS, finding.default ?? 'inline')}
    </div>
    <div class="choices mode-change" hidden>
${radioGroup(`${id}-change`, CHANGE_DECISIONS, 'fix')}
    </div>
    <label class="draft-label" for="${escapeHtml(id)}-comment">The comment that goes out under your name — edit it</label>
    ${anchor}
    <textarea id="${escapeHtml(id)}-comment" name="${escapeHtml(id)}-comment" rows="5">${escapeHtml(finding.comment ?? '')}</textarea>
  </div>
</article>`;
}

function renderNits(nits) {
  if (!Array.isArray(nits) || nits.length === 0) return '';
  const items = nits.map((n) => `<li>${escapeHtml(n)}</li>`).join('\n');
  return `<section class="nits">
  <h2>${nits.length} nit${nits.length === 1 ? '' : 's'} — mention or skip?</h2>
  <ul>
${items}
  </ul>
  <div class="choices">
${radioGroup('nits-decision', NIT_CHOICES, 'batched')}
  </div>
</section>`;
}

function renderEvidence(spec) {
  const blocks = [];
  if (spec.tests) blocks.push(`<div class="block"><h4>Tests</h4><p>${escapeHtml(spec.tests)}</p></div>`);
  if (Array.isArray(spec.judges) && spec.judges.length) {
    const rows = spec.judges
      .map(
        (j) =>
          `<tr><td>${escapeHtml(j.name ?? '')}</td><td>${escapeHtml(j.verdict ?? '')}</td><td>${escapeHtml(j.note ?? '')}</td></tr>`,
      )
      .join('\n');
    blocks.push(`<div class="block"><h4>Reviewers</h4>
<table><thead><tr><th>Reviewer</th><th>Verdict</th><th>What it turned on</th></tr></thead>
<tbody>${rows}</tbody></table></div>`);
  }
  if (spec.scope) blocks.push(`<div class="block"><h4>Scope</h4><p>${escapeHtml(spec.scope)}</p></div>`);
  if (!blocks.length) return '';
  return `<section class="evidence"><h2>Evidence</h2>${blocks.join('\n')}</section>`;
}

export function renderPage(spec, { id, decided = null } = {}) {
  const findings = Array.isArray(spec.findings) ? spec.findings : [];
  const cards = findings.map((f, i) => renderFinding(f, i)).join('\n');
  const rec = spec.recommendation ?? {};

  const banner = decided
    ? `<div class="sent-banner">Sent ${escapeHtml(decided.submitted_at ?? '')}. The reviewer has your decisions; you can close this tab.</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title ?? 'Review')}</title>
<link rel="stylesheet" href="/static/surface.css">
</head>
<body>
<main>
  <header class="page-head">
    <h1>${escapeHtml(spec.title ?? 'Review')}</h1>
    ${spec.pr ? `<a class="pr-link" href="${escapeHtml(spec.pr)}">${escapeHtml(spec.pr)}</a>` : ''}
    ${spec.summary ? `<p class="summary">${escapeHtml(spec.summary)}</p>` : ''}
  </header>
  ${banner}
  <form id="decisions" data-review="${escapeHtml(id)}" novalidate>
    <section class="mode">
      <h2>What may this review do to the branch?</h2>
      <div class="choices">
${radioGroup('mode', MODES, DEFAULT_MODE)}
      </div>
      <p class="mode-note" id="modeNote">Nothing will be committed or pushed. Findings become comments you approve.</p>
    </section>

    <section class="verdict">
      <h2>Verdict</h2>
      ${rec.why ? `<p class="rec-why">${escapeHtml(rec.why)}</p>` : ''}
      <div class="choices">
${radioGroup('verdict', VERDICTS, rec.value ?? 'request-changes')}
      </div>
    </section>

    <section class="findings">
      <h2>${findings.length} finding${findings.length === 1 ? '' : 's'}</h2>
      ${cards}
    </section>

    ${renderNits(spec.nits)}
    ${renderEvidence(spec)}

    <section class="send">
      <label for="message">Anything else for the reviewer</label>
      <textarea id="message" name="message" rows="3" placeholder="Optional"></textarea>
      <div id="errors" class="errors" hidden></div>
      <button type="submit" id="send">Send to reviewer</button>
      <div id="sent" class="sent" hidden></div>
    </section>
  </form>
</main>
<script src="/static/surface.js"></script>
</body>
</html>`;
}

export const _internals = { findingId, DECISIONS, VERDICTS, NIT_CHOICES };
