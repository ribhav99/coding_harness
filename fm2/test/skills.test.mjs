import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { install } from '../../codex/install.mjs';
import { syncSkills } from '../lib/skills.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fm-skill-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const root = join(dir, 'user-skills');
  mkdirSync(join(repo, 'skills', 'coding'), { recursive: true });
  mkdirSync(root);
  for (const name of ['full-review', 'tests-runner']) {
    const native = join(repo, 'codex', 'skills', name);
    mkdirSync(native, { recursive: true });
    writeFileSync(join(native, 'SKILL.md'), `---\nname: ${name}\ndescription: Native Codex ${name}.\n---\nNative app and CLI routing.\n`);
    writeFileSync(join(repo, 'skills', 'coding', `${name}.md`), `Shared ${name} procedure.\n`);
  }
  return { dir, repo, root };
}

test('Codex launch leaves installed native wrapper files intact through whole-folder links', t => {
  const f = fixture(t);
  install(f);
  const wrapper = join(f.repo, 'codex', 'skills', 'full-review', 'SKILL.md');
  const before = readFileSync(wrapper, 'utf8');
  const repaired = syncSkills({ ...f, agent: 'codex' });
  assert.equal(readFileSync(wrapper, 'utf8'), before);
  assert.equal(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), before);
  assert.equal(readlinkSync(join(f.root, 'full-review')), join(f.repo, 'codex', 'skills', 'full-review'));
  assert.deepEqual(repaired, []);
});

test('Codex launch installs native entrypoints and retains unrelated skills', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'personal'));
  writeFileSync(join(f.root, 'personal', 'SKILL.md'), 'My skill.');
  assert.deepEqual(syncSkills({ ...f, agent: 'codex' }), ['full-review', 'tests-runner']);
  assert.match(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), /Native app and CLI routing/u);
  assert.equal(readFileSync(join(f.root, 'personal', 'SKILL.md'), 'utf8'), 'My skill.');
});

test('Codex launch refuses custom content before installing any other skill', t => {
  const f = fixture(t);
  const external = join(f.dir, 'custom-review');
  mkdirSync(external);
  writeFileSync(join(external, 'SKILL.md'), 'Custom review.');
  symlinkSync(external, join(f.root, 'full-review'), 'dir');
  assert.throws(() => syncSkills({ ...f, agent: 'codex' }), /Custom skill content preserved/u);
  assert.equal(readFileSync(join(external, 'SKILL.md'), 'utf8'), 'Custom review.');
  assert.deepEqual(readdirSync(f.root), ['full-review']);
});

test('default Claude launch still links the shared source procedures', t => {
  const f = fixture(t);
  assert.deepEqual(syncSkills(f), ['full-review', 'tests-runner']);
  assert.equal(readlinkSync(join(f.root, 'full-review', 'SKILL.md')), join(f.repo, 'skills', 'coding', 'full-review.md'));
  assert.equal(readFileSync(join(f.root, 'full-review', 'SKILL.md'), 'utf8'), 'Shared full-review procedure.\n');
});
