import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = '.coding-harness.json';

function stat(file) {
  try { return lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function targetOf(file) {
  return stat(file)?.isSymbolicLink() ? resolve(dirname(file), readlinkSync(file)) : null;
}

export function skillEntries(repo = REPO) {
  const root = join(repo, 'codex', 'skills');
  const entries = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => [entry.name, join(root, entry.name)])
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) throw new Error('No Codex skills found.');
  for (const [name, dir] of entries) {
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
      || !frontmatter.split('\n').includes(`name: ${name}`)
      || !/^description: .+/mu.test(frontmatter)) {
      throw new Error(`Invalid skill metadata: ${dir}`);
    }
    for (const file of readdirSync(dir)) {
      if (stat(join(dir, file))?.isSymbolicLink()) realpathSync(join(dir, file));
    }
    for (const [, dependency] of text.matchAll(/\]\((source\.md|runtime\.md)\)/gu)) {
      readFileSync(join(dir, dependency), 'utf8');
    }
  }
  const names = new Set(entries.map(([name]) => name));
  for (const category of readdirSync(join(repo, 'skills'), { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const file of readdirSync(join(repo, 'skills', category.name))) {
      if (file.endsWith('.md') && !file.startsWith('_') && !names.has(basename(file, '.md'))) {
        throw new Error(`Shared skill has no Codex entrypoint: ${category.name}/${file}`);
      }
    }
  }
  return entries;
}

export function install({ repo = REPO, root = join(homedir(), '.agents', 'skills'), check = false } = {}) {
  repo = resolve(repo);
  root = resolve(root);
  const entries = skillEntries(repo);
  const manifestPath = join(root, MANIFEST);
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, links: {} };
  if (previous.version !== 1 || !previous.links || typeof previous.links !== 'object' || Array.isArray(previous.links)) {
    throw new Error(`Unrecognized installer manifest: ${manifestPath}`);
  }
  for (const [name, target] of Object.entries(previous.links)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || typeof target !== 'string') {
      throw new Error(`Invalid installer manifest entry: ${name}`);
    }
  }
  const links = Object.fromEntries(entries);
  const changes = [];
  const conflicts = [];
  for (const [name, target] of entries) {
    const dest = join(root, name);
    const current = stat(dest);
    if (targetOf(dest) === target) continue;
    if (!current) changes.push({ name, target, action: 'link' });
    else if (current.isDirectory() && readdirSync(dest).length === 0) changes.push({ name, target, action: 'empty' });
    else if (current.isSymbolicLink() && targetOf(dest) === previous.links[name]) changes.push({ name, target, action: 'relink' });
    else conflicts.push(dest);
  }
  for (const [name, target] of Object.entries(previous.links)) {
    if (Object.hasOwn(links, name)) continue;
    const dest = join(root, name);
    if (!stat(dest)) continue;
    if (targetOf(dest) === target) changes.push({ name, action: 'remove' });
    else conflicts.push(dest);
  }
  if (conflicts.length) throw new Error(`Custom skill content preserved; resolve conflicts before installing:\n${conflicts.join('\n')}`);
  const manifest = `${JSON.stringify({ version: 1, links }, null, 2)}\n`;
  const manifestChanged = !existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifest;
  if (!check) {
    mkdirSync(root, { recursive: true });
    for (const { name, target, action } of changes) {
      const dest = join(root, name);
      if (action === 'empty') rmdirSync(dest);
      if (action === 'relink' || action === 'remove') unlinkSync(dest);
      if (action !== 'remove') symlinkSync(target, dest, 'dir');
    }
    if (manifestChanged) writeFileSync(manifestPath, manifest);
  }
  return { count: entries.length, changes, current: changes.length === 0 && !manifestChanged };
}

function main(args) {
  let check = false;
  let root;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--skills-dir' && args[i + 1] && !args[i + 1].startsWith('--')) root = resolve(args[++i]);
    else throw new Error('Usage: node codex/install.mjs [--check] [--skills-dir PATH]');
  }
  const result = install({ root, check });
  if (check && !result.current) {
    for (const change of result.changes) console.log(`${change.action}: ${change.name}`);
    console.log('Codex skill installation needs refresh; run node codex/install.mjs.');
    process.exitCode = 1;
  } else {
    console.log(`${result.count} Codex skills ${check ? 'verified' : 'installed'}; ${result.changes.length} links changed.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
