import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from './render.mjs';
import { PAGE_BYTES } from './media.mjs';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '../static');
export function embeddedHtml(spec, options) {
  return renderPage(spec, { ...options, embedded: {
    css: readFileSync(join(STATIC, 'surface.css'), 'utf8'),
    js: readFileSync(join(STATIC, 'surface.js'), 'utf8'),
  } });
}
export function assertPageSize(bundle, reserve = 0) {
  if (Buffer.byteLength(JSON.stringify(bundle)) + reserve > PAGE_BYTES)
    throw new Error('This review exceeds the existing phone’s 1 MiB page limit. Optimize attached PNG/JPEG exports, shorten the review or feedback, or split it into separate reviews. No images were omitted.');
}
