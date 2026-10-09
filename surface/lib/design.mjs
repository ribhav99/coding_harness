// Design decisions reuse the released phone's finding transport, but are never
// code findings. Each summary comment is a typed choice + feedback JSON record.
export const isDesign = spec => spec.review_type === 'design';
export function designQuestions(spec) { return isDesign(spec) ? spec.design_questions || [] : []; }
export function validateDesign(spec) {
  if (spec.review_type != null && !['code', 'design'].includes(spec.review_type)) throw new Error('unknown review_type');
  if (!isDesign(spec)) {
    if (spec.design_questions != null && (!Array.isArray(spec.design_questions) || spec.design_questions.length)) throw new Error('design_questions require review_type: design');
    return;
  }
  if (spec.pr || spec.own_pr || spec.findings?.length || spec.nits?.length) throw new Error('standalone design reviews cannot carry a PR, code findings, own_pr or nits');
  const questions = spec.design_questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 12) throw new Error('design review needs 1–12 design_questions');
  const ids = new Set(), media = new Set((spec.media || []).map(m => m.id));
  for (const q of questions) {
    if (!q || typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(q.id) || ids.has(q.id)) throw new Error('design question ids must be unique stable references');
    ids.add(q.id);
    if (Object.keys(q).some(k => !['id', 'title', 'options'].includes(k))) throw new Error('unknown design question field');
    if (typeof q.title !== 'string' || !q.title.trim() || q.title.length > 2000) throw new Error('design question needs a title');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 12) throw new Error('design question needs 2–12 options');
    const choices = new Set();
    for (const o of q.options) {
      if (!o || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id) || choices.has(o.id)) throw new Error('design option ids must be unique stable references');
      choices.add(o.id);
      if (Object.keys(o).some(k => !['id', 'label', 'media'].includes(k))) throw new Error('unknown design option field');
      if (typeof o.label !== 'string' || !o.label.trim() || o.label.length > 2000) throw new Error('design option needs a label');
      if (!Array.isArray(o.media) || !o.media.length || o.media.some(id => !media.has(id))) throw new Error('design option must reference attached media ids');
    }
  }
}
export function parseDesignFeedback(text) {
  try {
    const value = JSON.parse(text);
    if (value && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'choice,comment' &&
      (value.choice === null || typeof value.choice === 'string') && typeof value.comment === 'string') return value;
  } catch { /* malformed feedback is refused by validation */ }
  return null;
}
