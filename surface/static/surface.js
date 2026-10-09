// Collect Ribhav's decisions and send them once.
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

  const design = form.dataset.design === 'true';
  let mediaReady = !document.querySelector('.review-image');
  const reviewId = form.dataset.review;
  const round = form.dataset.round;
  const native = form.dataset.embedded === 'true';
  let connected = !native;
  let busy = false;
  let sent = form.dataset.sent === 'true';
  let submission = null;
  let submittedContent = null;
  const errorBox = document.getElementById('errors');
  const sentBox = document.getElementById('sent');
  const button = document.getElementById('send');

  function post(type, value) {
    if (native && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, id: reviewId, round, ...value }));
    }
  }

  function updateButton() {
    button.disabled = busy || !connected || sent || !mediaReady;
    button.textContent = !mediaReady ? 'Waiting for images…' : busy ? 'Sending…' : !connected ? 'Reconnect to send' : sent ? 'Decisions saved' :
      design ? 'Send design feedback' : currentMode() === 'change' ? 'Send to reviewer (will change the branch)' : 'Send to reviewer';
  }

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
    updateButton();
  }

  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.addEventListener('change', applyMode);
  }
  applyMode();

  function collect() {
    const data = new FormData(form);
    const mode = currentMode();
    const findings = Object.create(null);
    for (const id of findingIds()) {
      findings[id] = {
        decision: data.get(id + (mode === 'change' ? '-change' : '-decision')),
        // .value via FormData, never a DOM text read.
        comment: (data.get(id + '-comment') || '').trim(),
      };
    }
    if (design) {
      for (const q of document.querySelectorAll('.design-question')) {
        const id = q.dataset.question;
        findings[id] = { decision: 'summary', comment: JSON.stringify({
          choice: data.get(id + '-choice') || null,
          comment: (data.get(id + '-feedback') || '').trim(),
        }) };
      }
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
      if (design) {
        const feedback = JSON.parse(choice.comment);
        if (payload.verdict.startsWith('approve') && !feedback.choice)
          found.push({ text: 'Choose a design for ' + id + ' before approving.', anchor: 'question-' + id });
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
    busy = false;
    sent = true;
    sentBox.textContent = text;
    sentBox.hidden = false;
    errorBox.hidden = true;
    button.disabled = true;
    form.classList.add('sent-done');
    for (const control of form.querySelectorAll('input, textarea')) control.disabled = true;
    updateButton();
  }

  function receiptText(receipt) {
    return receipt && receipt.woke ? 'Sent. The reviewer has been woken and is acting on it.' :
      'Saved on the Mac. ' + ((receipt && receipt.reason) || 'Reviewer notification was not confirmed. Reopen the review from its worker.');
  }

  // The embedded page gets only a decision transport, never native credentials,
  // filesystem access, or arbitrary SSH operations.
  window.surfaceNativeReceive = function (message) {
    if (!native) return;
    if (message.type === 'connection') {
      connected = message.connected === true;
      updateButton();
    } else if (message.type === 'restore' && !sent && !busy) {
      const value = message.payload;
      if (!value || typeof value !== 'object') return;
      function choose(name, choice) {
        for (const input of form.querySelectorAll('input[type=radio]')) {
          if (input.name === name) input.checked = input.value === choice;
        }
      }
      choose('mode', value.mode);
      choose('verdict', value.verdict);
      choose('nits-decision', value.nits);
      for (const id of findingIds()) {
        const decision = value.findings && value.findings[id];
        if (!decision) continue;
        choose(id + (value.mode === 'change' ? '-change' : '-decision'), decision.decision);
        const textarea = form.elements.namedItem(id + '-comment');
        if (textarea && typeof decision.comment === 'string') textarea.value = decision.comment;
      }
      if (design) for (const q of document.querySelectorAll('.design-question')) {
        const id = q.dataset.question, record = value.findings && value.findings[id];
        try {
          const feedback = JSON.parse(record.comment);
          choose(id + '-choice', feedback.choice || '');
          if (typeof feedback.comment === 'string') form.elements.namedItem(id + '-feedback').value = feedback.comment;
        } catch { /* ignore an invalid draft, never infer approval */ }
      }
      if (typeof value.message === 'string') form.elements.namedItem('message').value = value.message;
      applyMode();
    } else if (message.type === 'result') {
      if (message.ok) {
        showSent(receiptText(message.receipt));
      } else {
        busy = false;
        showProblems([{ text: message.error || 'Could not send. Your draft is kept on this phone.', anchor: null }]);
        updateButton();
      }
    }
  };

  function draftChanged() { if (!sent) post('draft', { payload: collect() }); }
  form.addEventListener('input', draftChanged);
  form.addEventListener('change', draftChanged);

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy || sent || !connected || !mediaReady) return;
    const payload = collect();
    const found = problems(payload);
    if (found.length) {
      showProblems(found);
      return;
    }

    busy = true;
    updateButton();
    if (native) {
      post('submit', { payload });
      return;
    }
    // Retain the same identifier after an uncertain send. Editing the decision
    // content makes the next explicit submission a different action.
    const content = JSON.stringify(payload);
    if (content !== submittedContent) {
      submittedContent = content;
      submission = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() :
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    try {
      const response = await fetch('/api/' + encodeURIComponent(reviewId) + '/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, round, submission_id: submission }),
      });
      const body = await response.json().catch(function () {
        return null;
      });
      if (!response.ok) {
        // The server refusing is as loud as the client refusing. Nothing is
        // assumed delivered because a request was made.
        showProblems([{ text: (body && body.error) || 'The reviewer did not accept this (HTTP ' + response.status + ').', anchor: null }]);
        busy = false;
        updateButton();
        return;
      }
      showSent(receiptText(body));
    } catch (err) {
      showProblems([{ text: 'Could not reach the review server: ' + err.message, anchor: null }]);
      busy = false;
      updateButton();
    }
  });
  // A malformed raster is visible as an error and cannot be accidentally
  // approved. This also catches formats a particular WebView cannot decode.
  const images = Array.from(document.querySelectorAll('.review-image'));
  function checkImages() {
    mediaReady = images.every(img => img.complete && img.naturalWidth > 0);
    for (const img of images) {
      const failed = img.complete && !img.naturalWidth;
      img.closest('figure').querySelector('.image-error').hidden = !failed;
      img.closest('figure').querySelector('.enlarge').disabled = failed;
    }
    updateButton();
  }
  for (const img of images) {
    img.addEventListener('load', checkImages);
    img.addEventListener('error', checkImages);
  }
  checkImages();
  for (const reference of document.querySelectorAll('.media-reference')) reference.addEventListener('click', () => {
    document.getElementById('media-' + reference.dataset.ref)?.scrollIntoView({ block: 'start' });
  });
  const viewer = document.getElementById('image-viewer');
  if (viewer) {
    const full = document.getElementById('full-image');
    const scroll = viewer.querySelector('.image-scroll');
    let scale = 1;
    function sizeImage() {
      full.style.width = Math.round(scroll.clientWidth * scale) + 'px';
      document.getElementById('image-scale').textContent = scale + '× fit';
    }
    for (const control of document.querySelectorAll('.enlarge')) control.addEventListener('click', () => {
      const img = images.find(image => image.dataset.media === control.dataset.image);
      if (!img || !img.naturalWidth) return;
      full.src = img.src; full.alt = img.alt;
      document.getElementById('image-title').textContent = img.closest('figure').querySelector('h3').textContent;
      scale = 1;
      viewer.showModal(); sizeImage(); scroll.scrollTo(0, 0);
    });
    document.getElementById('image-close').addEventListener('click', () => viewer.close());
    document.getElementById('image-plus').addEventListener('click', () => { scale = Math.min(8, scale * 2); sizeImage(); });
    document.getElementById('image-minus').addEventListener('click', () => { scale = Math.max(1, scale / 2); sizeImage(); });
    window.addEventListener('resize', () => { if (viewer.open) sizeImage(); });
  }
  if (sent) showSent('Your decisions have already been saved on the Mac.');
  post('ready', {});
})();
