import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { install } from './install.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-harness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const root = join(dir, 'user-skills');
  mkdirSync(join(repo, 'skills', 'coding'), { recursive: true });
  mkdirSync(root);
  for (const name of ['firstmate', 'full-review']) {
    mkdirSync(join(repo, 'codex', 'skills', name), { recursive: true });
    writeFileSync(join(repo, 'codex', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Review a change.\n---\n`);
    writeFileSync(join(repo, 'skills', 'coding', `${name}.md`), 'Shared procedure.');
  }
  return { dir, repo, root };
}

test('repairs empty imports and discovers a real skill through a whole-folder link', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'full-review'));
  const result = install(f);
  assert.equal(result.changes.length, 2);
  assert.match(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), /name: full-review/u);
  assert.equal(readlinkSync(join(f.root, 'full-review')), join(f.repo, 'codex', 'skills', 'full-review'));
  const manifest = readFileSync(join(f.root, '.coding-harness.json'), 'utf8');
  assert.deepEqual(install(f).changes, []);
  assert.equal(readFileSync(join(f.root, '.coding-harness.json'), 'utf8'), manifest);
  assert.equal(install({ ...f, check: true }).current, true);
});

test('check reports missing installs without writing', t => {
  const f = fixture(t);
  assert.equal(install({ ...f, check: true }).current, false);
  assert.deepEqual(readdirSync(f.root), []);
});

test('custom skill content aborts before any other entry is installed', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'full-review'));
  writeFileSync(join(f.root, 'full-review', 'SKILL.md'), 'My custom review');
  assert.throws(() => install(f), /Custom skill content preserved/u);
  assert.deepEqual(readdirSync(f.root), ['full-review']);
  assert.equal(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), 'My custom review');
});

test('repairs owned links after the source checkout moves', t => {
  const f = fixture(t);
  install(f);
  const moved = join(f.dir, 'moved-repo');
  renameSync(f.repo, moved);
  assert.equal(install({ ...f, repo: moved }).changes.length, 2);
  assert.match(readFileSync(join(f.root, 'firstmate', 'SKILL.md'), 'utf8'), /name: firstmate/u);
});

test('removes retired owned links and leaves unrelated skills intact', t => {
  const f = fixture(t);
  install(f);
  mkdirSync(join(f.root, 'personal'));
  writeFileSync(join(f.root, 'personal', 'SKILL.md'), 'Personal content');
  rmSync(join(f.repo, 'codex', 'skills', 'full-review'), { recursive: true });
  rmSync(join(f.repo, 'skills', 'coding', 'full-review.md'));
  assert.deepEqual(install(f).changes, [{ name: 'full-review', action: 'remove' }]);
  assert.equal(readFileSync(join(f.root, 'personal', 'SKILL.md'), 'utf8'), 'Personal content');
});

test('missing Codex entrypoints and broken source links abort installation', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'skills', 'coding', 'new-judge.md'), 'New rubric');
  assert.throws(() => install(f), /Shared skill has no Codex entrypoint/u);
  assert.deepEqual(readdirSync(f.root), []);
  rmSync(join(f.repo, 'skills', 'coding', 'new-judge.md'));
  symlinkSync('/missing/rubric.md', join(f.repo, 'codex', 'skills', 'firstmate', 'source.md'));
  assert.throws(() => install(f), /ENOENT/u);
  assert.deepEqual(readdirSync(f.root), []);
});

test('a replaced owned link is treated as custom content', t => {
  const f = fixture(t);
  install(f);
  unlinkSync(join(f.root, 'full-review'));
  mkdirSync(join(f.root, 'full-review'));
  writeFileSync(join(f.root, 'full-review', 'SKILL.md'), 'Replacement');
  assert.throws(() => install(f), /Custom skill content preserved/u);
  assert.equal(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), 'Replacement');
});

test('a wrapper cannot verify when its referenced rubric or runtime file is absent', t => {
  const f = fixture(t);
  const skill = join(f.repo, 'codex', 'skills', 'full-review', 'SKILL.md');
  for (const dependency of ['source.md', 'runtime.md']) {
    writeFileSync(skill, `---\nname: full-review\ndescription: Review a change.\n---\nRead [the procedure](${dependency}).\n`);
    assert.throws(() => install({ ...f, check: true }), /ENOENT/u);
    assert.deepEqual(readdirSync(f.root), []);
  }
});
