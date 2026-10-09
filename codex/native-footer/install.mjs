#!/usr/bin/env node
// Install a verified native footer build without replacing its companion tools.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';

const [builtPath, installedPath] = process.argv.slice(2);
if (!builtPath || !installedPath) {
  throw new Error('usage: node codex/native-footer/install.mjs <built native codex> <installed native codex>');
}
const built = realpathSync(builtPath);
const installed = realpathSync(installedPath);
if (built === installed) throw new Error('Build and installation paths must differ');
// macOS may take longer to validate a newly copied native executable on first launch.
const version = (path) => execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 45_000 }).trim();
const builtVersion = version(built);
const stockVersion = version(installed);
if (builtVersion !== stockVersion) {
  throw new Error(`Refusing a version mismatch: built ${builtVersion}, installed ${stockVersion}`);
}
const digest = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const before = await digest(installed);
const after = await digest(built);
if (before === after) {
  console.log(`${builtVersion}: this build is already installed`);
  process.exit(0);
}
const backup = `${installed}.before-native-footer-${before.slice(0, 12)}`;
if (!existsSync(backup)) copyFileSync(installed, backup);
if (await digest(backup) !== before) throw new Error('Backup does not match the installed binary');
const pending = `${installed}.native-footer-${process.pid}`;
copyFileSync(built, pending);
chmodSync(pending, statSync(installed).mode);
if (await digest(pending) !== after || version(pending) !== stockVersion) {
  throw new Error('Copied native binary did not verify; the installation is unchanged');
}
// Atomic replacement keeps any running process on its original executable.
renameSync(pending, installed);
writeFileSync(`${installed}.native-footer.json`, JSON.stringify({
  version: stockVersion, installed, backup, originalSha256: before,
  installedSha256: after, installedAt: new Date().toISOString(),
}, null, 2) + '\n', { mode: 0o600 });
console.log(`${stockVersion}: native reset countdown installed; backup ${backup}`);
