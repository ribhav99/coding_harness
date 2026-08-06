// Collect the captain's decisions and send them once.
//
// Three rules, each of which is a bug that actually shipped:
//   1. Read through FormData over named controls. A control with an id but no
//      name is invisible to FormData, which is how a request-changes verdict
//      once went out as a plain comment.
//   2. Never read text out of the DOM. innerText returns "" for anything not
//      rendered - inside a collapsed <details>, hidden, off-screen - which is how
//      eight edited comment drafts once came back empty.
//   3. Refuse loudly. A partial payload is never sent; the page says what is
//      missing and points at it.

(function () {
  const form = document.getElementById('decisions');
  if (!form) return;

  const reviewId = form.dataset.review;
  const errorBox = document.getElementById('errors');
  const sentBox = document.getElementById('sent');
  const button = document.getElementById('send');

  function findingIds() {
    return Array.from(document.querySelectorAll('article.finding')).map((el) =>
      el.id.replace(/^card-/, ''),
    );
  }

  // Which set of per-finding options is live depends on the mode. Both sets are
  // in the form; only the active one is read, so a stale hidden choice can never
  // reach the reviewer.
  function currentMode() {
    return new FormData(form).get('mode') || 'comment';
  }

  function applyMode() {
    const change = currentMode() === 'change';
    for (const el of document.querySelectorAll('.mode-comment')) el.hidden = change;
    for (const el of document.querySelectorAll('.mode-change')) el.hidden = !change;
    const note = document.getElementById('modeNote');
    if (note) {
      note.textContent = change
        ? 'Approved fixes will be applied to the branch and committed. Nothing is pushed.'
        : 'Nothing will be committed or pushed. Findings become comments you approve.';
      note.classList.toggle('warn', change);
    }
    if (button) button.textContent = change ? 'Send to reviewer (will change the branch)' : 'Send to reviewer';
  }

  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.addEventListener('change', applyMode);
  }
  applyMode();

  function collect() {
    const data = new FormData(form);
    const mode = currentMode();
    const findings = {};
    for (const id of findingIds()) {
      findings[id] = {
        decision: data.get(id + (mode === 'change' ? '-change' : '-decision')),
        // .value via FormData, never a DOM text read.
        comment: (data.get(id + '-comment') || '').trim(),
      };
    }
    return {
      mode,
      verdict: data.get('verdict'),
      findings,
      nits: data.get('nits-decision'),
      message: (data.get('message') || '').trim(),
    };
  }

  // Every problem the payload could have, named concretely enough to act on.
  function problems(payload) {
    const found = [];
    if (!payload.verdict) found.push({ text: 'No verdict is selected.', anchor: null });
    for (const [id, choice] of Object.entries(payload.findings)) {
      if (!choice.decision) {
        found.push({ text: 'Finding ' + id + ' has no decision.', anchor: 'card-' + id });
        continue;
      }
      // A finding being raised has to carry words. Dropping one does not.
      if (choice.decision !== 'drop' && choice.decision !== 'fix' && !choice.comment) {
        found.push({
          text: 'Finding ' + id + ' is set to "' + choice.decision + '" but its comment is empty.',
          anchor: 'card-' + id,
        });
      }
    }
    return found;
  }

  function showProblems(found) {
    errorBox.innerHTML = '';
    const heading = document.createElement('p');
    heading.textContent = 'Not sent — ' + found.length + ' thing' + (found.length === 1 ? '' : 's') + ' to fix:';
    errorBox.appendChild(heading);
    const list = document.createElement('ul');
    for (const p of found) {
      const li = document.createElement('li');
      if (p.anchor) {
        const a = document.createElement('a');
        a.href = '#' + p.anchor;
        a.textContent = p.text;
        li.appendChild(a);
      } else {
        li.textContent = p.text;
      }
      list.appendChild(li);
    }
    errorBox.appendChild(list);
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showSent(text) {
    sentBox.textContent = text;
    sentBox.hidden = false;
    errorBox.hidden = true;
    button.disabled = true;
    form.classList.add('sent-done');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const payload = collect();
    const found = problems(payload);
    if (found.length) {
      showProblems(found);
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const response = await fetch('/api/' + encodeURIComponent(reviewId) + '/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(function () {
        return null;
      });
      if (!response.ok) {
        // The server refusing is as loud as the client refusing. Nothing is
        // assumed delivered because a request was made.
        showProblems([{ text: (body && body.error) || 'The reviewer did not accept this (HTTP ' + response.status + ').', anchor: null }]);
        button.disabled = false;
        button.textContent = 'Send to reviewer';
        return;
      }
      showSent(body && body.woke ? 'Sent. The reviewer has been woken and is acting on it.' : 'Sent. Saved for the reviewer.');
    } catch (err) {
      showProblems([{ text: 'Could not reach the review server: ' + err.message, anchor: null }]);
      button.disabled = false;
      button.textContent = 'Send to reviewer';
    }
  });
})();
