import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, utimesSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worktreeState } from '../lib/tasks.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fm2-worktree-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project);
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(project, 'tracked.txt'), 'committed\n');
  writeFileSync(join(project, '.gitignore'), 'ignored.txt\n');
  git('add', 'tracked.txt', '.gitignore');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'initial');
  return { root, project, git };
}

function assertOnlyContentChanged(before, after) {
  const { content_sha256: beforeHash, ...beforeGit } = before;
  const { content_sha256: afterHash, ...afterGit } = after;
  assert.deepEqual(afterGit, beforeGit, 'the existing Git state fields should be identical');
  assert.match(afterHash, /^[a-f0-9]{64}$/);
  assert.notEqual(afterHash, beforeHash, 'content changed inside an already-dirty path');
}

test('worktree snapshots detect dirty tracked and untracked byte edits despite unchanged status, size and mtime', (t) => {
  const { project } = fixture(t);
  const tracked = join(project, 'tracked.txt');
  const untracked = join(project, ' untracked\nfile.bin ');
  writeFileSync(tracked, 'sensitive-fixture-payload-A\n');
  const bytes = Buffer.alloc(600_000, 1);
  writeFileSync(untracked, bytes);
  const first = worktreeState(project);
  assert.deepEqual(worktreeState(project), first);
  assert.ok(!JSON.stringify(first).includes('sensitive-fixture-payload'));

  const trackedStat = statSync(tracked);
  writeFileSync(tracked, 'sensitive-fixture-payload-B\n');
  utimesSync(tracked, trackedStat.atime, trackedStat.mtime);
  const second = worktreeState(project);
  assertOnlyContentChanged(first, second);

  const untrackedStat = statSync(untracked);
  bytes[550_000] = 2;
  writeFileSync(untracked, bytes);
  utimesSync(untracked, untrackedStat.atime, untrackedStat.mtime);
  const third = worktreeState(project);
  assertOnlyContentChanged(second, third);
  writeFileSync(join(project, 'ignored.txt'), 'ignored build output');
  assert.deepEqual(worktreeState(project), third, 'ignored output should not enter the Git worktree fingerprint');
});

test('worktree snapshots distinguish staged edits with identical worktree bytes and porcelain status', (t) => {
  const { project, git } = fixture(t);
  const tracked = join(project, 'tracked.txt');
  writeFileSync(tracked, 'staged version A\n');
  git('add', 'tracked.txt');
  writeFileSync(tracked, 'same working bytes\n');
  const before = worktreeState(project);
  writeFileSync(tracked, 'staged version B\n');
  git('add', 'tracked.txt');
  writeFileSync(tracked, 'same working bytes\n');
  assertOnlyContentChanged(before, worktreeState(project));
});

test('worktree snapshots hash symlink identity without reading its target', (t) => {
  const { root, project } = fixture(t);
  const target = join(root, 'outside.txt');
  const link = join(project, 'link');
  writeFileSync(target, 'outside version A');
  symlinkSync(target, link);
  const before = worktreeState(project);
  writeFileSync(target, 'outside version B');
  assert.deepEqual(worktreeState(project), before);
  unlinkSync(link);
  symlinkSync(join(root, 'missing-target.txt'), link);
  assertOnlyContentChanged(before, worktreeState(project));
});
