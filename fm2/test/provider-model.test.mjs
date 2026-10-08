import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { latestCodexModel, newestSol } from '../lib/provider-model.mjs';
import { launchCommand } from '../lib/launch.mjs';
import { supervisorCommand } from '../supervisor.mjs';
import { seedModelCatalog } from './model-fixture.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fm-model-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('latest Sol compares numeric versions and excludes other families, previews and hidden models', () => {
  const catalog = ['gpt-5.6-sol', 'gpt-6.1-sol', 'gpt-6.9-sol', 'gpt-6.10-sol',
    'gpt-7-astra', 'gpt-7-luna', 'gpt-8-sol-preview', 'gpt-9-sol-2026-10-02'].map(model => ({ model }));
  catalog.push({ model: 'gpt-10-sol', hidden: true });
  assert.equal(newestSol(catalog), 'gpt-6.10-sol');
  assert.throws(() => newestSol([{ slug: 'gpt-6-astra' }]), /no visible stable Sol/u);
});

test('catalog refresh changes the selected release and cached fallback is explicit', t => {
  const root = fixture(t);
  const cachePath = join(root, 'models.json');
  const now = Date.now();
  writeFileSync(cachePath, JSON.stringify({ fetched_at: new Date(now).toISOString(), models: [{ slug: 'gpt-6.1-sol' }] }));
  assert.equal(latestCodexModel({ cachePath, now, query: () => { throw new Error('fresh cache should be used'); } }), 'gpt-6.1-sol');
  assert.equal(latestCodexModel({ cachePath, now: now + 61_000, query: () => [{ model: 'gpt-6.2-sol' }] }), 'gpt-6.2-sol');
  const warning = t.mock.method(process.stderr, 'write', () => true);
  assert.equal(latestCodexModel({ cachePath, now: now + 61_000, query: () => { throw new Error('offline'); } }), 'gpt-6.1-sol');
  assert.match(warning.mock.calls[0].arguments[0], /cached latest Sol/u);
  assert.throws(() => latestCodexModel({ cachePath: join(root, 'missing'), query: () => [] }), /cannot resolve latest Sol/u);
});

test('worker and controller resumes follow a new Sol catalog without changing effort', t => {
  const root = fixture(t);
  seedModelCatalog(root, t);
  const settingsFile = join(root, 'hooks.json');
  writeFileSync(settingsFile, '{"hooks":{}}');
  const worker = () => launchCommand({ agent: 'codex', id: 'model-policy', settingsFile, resume: 'exact-session', effort: 'ultra' });
  const controller = () => supervisorCommand({ agent: 'codex', id: 'controller:model-policy', panel: 'panel', resume: 'exact-controller', effort: 'low' });
  assert.match(worker(), /model="gpt-6\.1-sol"/u);
  writeFileSync(join(process.env.CODEX_HOME, 'models_cache.json'), JSON.stringify({
    fetched_at: new Date().toISOString(), models: [{ slug: 'gpt-6.1-sol' }, { slug: 'gpt-6.2-sol' }],
  }));
  assert.match(worker(), /model="gpt-6\.2-sol"/u);
  assert.match(worker(), /model_reasoning_effort="ultra"/u);
  assert.match(controller(), /model="gpt-6\.2-sol"/u);
  assert.match(controller(), /model_reasoning_effort="low"/u);
});

test('model catalog client initializes and paginates without starting any thread or turn', t => {
  const root = fixture(t);
  const fakeCodex = join(root, 'codex');
  writeFileSync(fakeCodex, `#!${process.execPath}
const readline = require('node:readline');
readline.createInterface({input: process.stdin}).on('line', line => {
  const r = JSON.parse(line);
  if (r.method === 'initialized') return;
  if (!['initialize','model/list'].includes(r.method)) process.exit(9);
  const result = r.method === 'initialize' ? {} : r.params.cursor
    ? {data:[{model:'gpt-6.2-sol'}],nextCursor:null}
    : {data:[{model:'gpt-6.1-sol'}],nextCursor:'page2'};
  process.stdout.write(JSON.stringify({id:r.id,result})+'\\n');
});
`, { mode: 0o700 });
  const models = JSON.parse(execFileSync(process.execPath,
    [new URL('../lib/codex-model-catalog.mjs', import.meta.url).pathname, fakeCodex],
    { encoding: 'utf8', timeout: 5000 }));
  assert.equal(newestSol(models), 'gpt-6.2-sol');
});
