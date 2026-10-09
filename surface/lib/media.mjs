// Private, immutable raster snapshots. No media path is ever accepted from HTTP.
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, lstatSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

export const MEDIA_BYTES = 640 * 1024;
export const PAGE_BYTES = 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Review media: ${message}`); };

function privatePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..') || relative.startsWith('/'))
    fail('use a relative path inside the review artifact directory, without traversal');
  let path = realpathSync(root);
  for (const part of relative.split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) fail(`symlinks are not supported: ${relative}`);
  }
  return path;
}

function readRaster(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MEDIA_BYTES || stat.size < 24) fail('expected a PNG or JPEG regular file, at most 640 KiB');
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size || bytes.length > MEDIA_BYTES) fail('image changed while being read');
    let width, height, mime;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
      mime = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
      if (!bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) fail('truncated PNG');
      // Animated PNG is deliberately outside the static review contract.
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        if (type === 'acTL') fail('animated PNG is not supported');
        if (offset + length + 12 > bytes.length) fail('corrupt PNG chunk');
        offset += length + 12;
      }
      if (offset !== bytes.length) fail('corrupt PNG');
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
      mime = 'image/jpeg';
      let offset = 2;
      while (offset + 4 < bytes.length) {
        if (bytes[offset++] !== 255) fail('corrupt JPEG marker');
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) fail('corrupt JPEG segment');
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          if (length < 8) fail('corrupt JPEG frame');
          height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
        }
        if (marker === 0xda || marker === 0xd9) break;
        offset += length;
      }
    } else fail('only static PNG and JPEG are supported (no SVG, HTML, GIF, WebP or URLs)');
    if (!width || !height || width > 8192 || height > 8192 || width * height > 8_000_000) fail('image dimensions must be at most 8192 per side and 8 megapixels');
    return { bytes, width, height, mime, digest: hash(bytes) };
  } finally { closeSync(fd); }
}

export function validateMedia(spec) {
  if (spec.media == null) return [];
  if (!Array.isArray(spec.media) || spec.media.length > 8) fail('media must be an array of at most 8 images');
  const ids = new Set();
  for (const item of spec.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('each image must be an object');
    if (Object.keys(item).some(k => !['id', 'path', 'title', 'alt', 'caption'].includes(k))) fail('unknown image field');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)) fail('image ids must be unique stable references');
    ids.add(item.id);
    for (const key of ['path', 'title', 'alt']) if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 2000) fail(`image ${item.id} needs ${key} (at most 2000 characters)`);
    if (item.caption != null && (typeof item.caption !== 'string' || item.caption.length > 4000)) fail('invalid image caption');
    if (!['.png', '.jpg', '.jpeg'].includes(extname(item.path).toLowerCase())) fail('use a .png, .jpg or .jpeg file');
  }
  return spec.media;
}

export function snapshotMedia(specPath, spec) {
  const items = validateMedia(spec);
  if (!items.length) return null;
  const root = dirname(specPath);
  const rasters = items.map(item => readRaster(privatePath(root, item.path)));
  if (rasters.reduce((sum, r) => sum + r.bytes.length, 0) > MEDIA_BYTES) fail('combined images exceed 640 KiB; export optimized full-resolution JPEGs or split the review');
  if (rasters.reduce((sum, r) => sum + r.width * r.height, 0) > 24_000_000) fail('combined images exceed 24 megapixels; split the review');
  const dir = join(root, '.surface-media');
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) fail('snapshot directory must be a real directory');
  const assets = rasters.map(r => {
    const file = `${r.digest}.${r.mime === 'image/png' ? 'png' : 'jpg'}`;
    const dest = join(dir, file);
    try { writeFileSync(dest, r.bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const saved = readRaster(privatePath(root, `.surface-media/${file}`));
    if (saved.digest !== r.digest) fail('snapshot was altered; restore it before reopening');
    return { file, digest: r.digest };
  });
  return { descriptors: JSON.stringify(items), assets };
}

export function bundledMedia(entry, spec) {
  const items = validateMedia(spec);
  if (!items.length) return { images: [], identity: '' };
  if (!entry.media || entry.media.descriptors !== JSON.stringify(items)) fail('attachments changed; run surface open from the owning worker');
  const images = items.map((item, i) => {
    const asset = entry.media.assets[i];
    if (!asset || !/^[a-f0-9]{64}\.(png|jpg)$/.test(asset.file)) fail('invalid snapshot reference; reopen the review');
    const raster = readRaster(privatePath(dirname(entry.spec), `.surface-media/${asset.file}`));
    if (raster.digest !== asset.digest) fail(`snapshot ${item.id} was altered; restore it before deciding`);
    return { ...item, width: raster.width, height: raster.height, src: `data:${raster.mime};base64,${raster.bytes.toString('base64')}` };
  });
  return { images, identity: hash(JSON.stringify(entry.media)) };
}
