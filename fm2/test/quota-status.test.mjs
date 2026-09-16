import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codexStatusRight,
  configurePanelQuotaStatus,
  formatQuotaStatus,
  latestRateLimits,
  quotaStatusForPanel,
} from '../lib/quota-status.mjs';

const NOW = 1_700_000_000;

function rateLimits() {
  return {
    primary: { used_percent: 20, window_minutes: 300, resets_at: NOW + 3660 },
    secondary: { used_percent: 75.2, window_minutes: 10080, resets_at: NOW + 183600 },
    individual_limit: null,
  };
}

test('quota status includes used percentage and full reset time for every available window', () => {
  assert.equal(
    formatQuotaStatus(rateLimits(), { now: NOW }),
    '5h 20% used · resets in 1h 1m | weekly 75% used · resets in 2d 3h 0m',
  );
  assert.equal(
    formatQuotaStatus({ primary: rateLimits().secondary, secondary: null }, { now: NOW }),
    'weekly 75% used · resets in 2d 3h 0m',
    'an unavailable five-hour window should be omitted',
  );
  assert.equal(
    formatQuotaStatus({ primary: { ...rateLimits().primary, resets_at: NOW - 1 } }, { now: NOW }),
    '',
    'an expired snapshot should not claim indefinitely that its reset is now',
  );
});

test('latest rate limits are read from the transcript tail without trusting unrelated JSON', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm2-quota-tail-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transcript = join(root, 'session.jsonl');
  const earlier = { type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: null } } };
  const latest = { type: 'event_msg', payload: { type: 'token_count', rate_limits: rateLimits() } };
  writeFileSync(transcript, [
    JSON.stringify(earlier),
    JSON.stringify({ type: 'response_item', payload: { output: 'rate_limits is only text here' } }),
    JSON.stringify(latest),
    'x'.repeat(80 * 1024),
    '{concurrently-written',
  ].join('\n'));
  assert.deepEqual(latestRateLimits(transcript), latest.payload.rate_limits);
});

test('a panel uses its controller transcript and renders nothing without quota data', (t) => {
  const fm2Home = mkdtempSync(join(tmpdir(), 'fm2-quota-panel-'));
  t.after(() => rmSync(fm2Home, { recursive: true, force: true }));
  const sessions = join(fm2Home, 'sessions', 'controller:fm-fixture');
  mkdirSync(sessions, { recursive: true });
  const transcript = join(fm2Home, 'controller.jsonl');
  writeFileSync(transcript, JSON.stringify({
    timestamp: '2023-11-14T22:13:20Z',
    type: 'event_msg', payload: { type: 'token_count', rate_limits: rateLimits() },
  }) + '\n');
  writeFileSync(join(sessions, 'codex.json'), JSON.stringify({
    task: 'controller:fm-fixture', panel: 'fm-fixture', transcript, recorded_at: '2026-09-16T00:00:00Z',
  }));
  assert.equal(
    quotaStatusForPanel('fm-fixture', { fm2Home, codexHome: join(fm2Home, 'codex'), now: NOW }),
    '5h 20% used · resets in 1h 1m | weekly 75% used · resets in 2d 3h 0m',
  );
  assert.equal(quotaStatusForPanel('unknown', {
    fm2Home, codexHome: join(fm2Home, 'codex'), now: NOW,
  }), '');
});

test('a panel keeps the newest live snapshot for each distinct model limit', (t) => {
  const fm2Home = mkdtempSync(join(tmpdir(), 'fm2-quota-models-'));
  t.after(() => rmSync(fm2Home, { recursive: true, force: true }));
  const add = (task, event, { live = true } = {}) => {
    const session = join(fm2Home, 'sessions', task);
    mkdirSync(session, { recursive: true });
    const transcript = join(fm2Home, `${task.replace(':', '-')}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify(event)}\n`);
    writeFileSync(join(session, 'codex.json'), JSON.stringify({
      id: `${task}-session`, task, panel: 'fm-fixture', transcript,
    }));
    if (live && !task.startsWith('controller:')) {
      const tasks = join(fm2Home, 'tasks');
      mkdirSync(tasks, { recursive: true });
      writeFileSync(join(tasks, `${task}.json`), JSON.stringify({
        id: task, agent: 'codex', panel: 'fm-fixture', sessions: { codex: { id: `${task}-session` } },
      }));
    }
  };
  add('controller:fm-fixture', {
    timestamp: '2023-11-14T22:13:20Z', type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(), limit_id: 'codex', primary: rateLimits().secondary, secondary: null,
    } },
  });
  add('new-general', {
    timestamp: '2023-11-14T22:14:20Z', type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(), limit_id: 'codex', primary: { ...rateLimits().secondary, used_percent: 70 }, secondary: null,
    } },
  });
  add('spark', {
    timestamp: '2023-11-14T22:15:20Z', type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(), limit_id: 'codex_spark', limit_name: 'GPT-5.3-Codex-Spark',
    } },
  });
  add('closed-stale', {
    timestamp: '2023-11-14T22:16:20Z', type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(), limit_id: 'codex', primary: { ...rateLimits().secondary, used_percent: 99 }, secondary: null,
    } },
  }, { live: false });
  assert.equal(
    quotaStatusForPanel('fm-fixture', { fm2Home, codexHome: join(fm2Home, 'codex'), now: NOW }),
    'Codex weekly 70% used · resets in 2d 3h 0m || GPT 5.3 Spark 5h 20% used · resets in 1h 1m | weekly 75% used · resets in 2d 3h 0m',
  );
});

test('recent Codex sessions outside the panel keep account-wide usage fresh', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm2-quota-global-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fm2Home = join(root, 'fm2');
  const codexHome = join(root, 'codex');
  const controller = join(fm2Home, 'sessions', 'controller:fm-fixture');
  mkdirSync(controller, { recursive: true });
  const panelTranscript = join(root, 'panel.jsonl');
  writeFileSync(panelTranscript, `${JSON.stringify({
    timestamp: new Date(NOW * 1000).toISOString(),
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: rateLimits() },
  })}\n`);
  writeFileSync(join(controller, 'codex.json'), JSON.stringify({
    task: 'controller:fm-fixture', panel: 'fm-fixture', transcript: panelTranscript,
  }));

  const at = new Date(NOW * 1000);
  const day = join(
    codexHome,
    'sessions',
    String(at.getFullYear()),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
  );
  mkdirSync(day, { recursive: true });
  const external = join(day, 'rollout-external.jsonl');
  writeFileSync(external, `${JSON.stringify({
    timestamp: new Date((NOW + 60) * 1000).toISOString(),
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(),
      primary: { ...rateLimits().primary, used_percent: 27 },
    } },
  })}\n`);
  utimesSync(external, NOW, NOW);

  const archived = join(codexHome, 'archived_sessions', 'rollout-archived.jsonl');
  mkdirSync(join(codexHome, 'archived_sessions'), { recursive: true });
  writeFileSync(archived, `${JSON.stringify({
    timestamp: new Date((NOW + 120) * 1000).toISOString(),
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: {
      ...rateLimits(),
      primary: { ...rateLimits().primary, used_percent: 28 },
    } },
  })}\n`);
  utimesSync(archived, NOW, NOW);

  assert.equal(
    quotaStatusForPanel('fm-fixture', { fm2Home, codexHome, now: NOW }),
    '5h 28% used · resets in 1h 1m | weekly 75% used · resets in 2d 3h 0m',
  );
});

test('Codex panels install the quota command and Claude panels restore inherited tmux status', () => {
  const calls = [];
  const local = new Map();
  const global = new Map([
    ['status-right', '#[fg=colour42]CUSTOM %H:%M '],
    ['status-right-length', '52'],
  ]);
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'show-option') {
      const option = args.at(-1);
      return args.includes('-gv') ? global.get(option) || '' : local.get(option) || '';
    }
    if (args[0] === 'set-option') {
      if (args.includes('-u')) local.delete(args.at(-1));
      else local.set(args.at(-2), args.at(-1));
    }
    return '';
  };
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'codex', {
    fm2Home: '/tmp/fm home', codexHome: '/tmp/codex home', run,
  }), true);
  assert.match(local.get('status-right'), /quota-status\.mjs/);
  assert.match(local.get('status-right'), /'fm-fixture'/);
  assert.match(local.get('status-right'), /'\/tmp\/codex home'/);
  assert.match(local.get('status-right'), /CUSTOM %H:%M/);
  assert.equal(local.get('status-right-length'), '160');
  assert.equal(local.get('@fm-quota-status-base'), '#[fg=colour42]CUSTOM %H:%M ');
  assert.match(local.get('status-right'), /#\[default\]#\[fg=colour42\]/);
  const first = local.get('status-right');
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'codex', {
    fm2Home: '/tmp/fm home', codexHome: '/tmp/codex home', run,
  }), true);
  assert.equal(local.get('status-right'), first, 'a repeated SessionStart duplicated the quota command');
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'claude', { fm2Home: '/tmp/fm home', run }), true);
  assert.equal(local.has('status-right'), false, 'an inherited custom status was restored as a frozen local copy');
  assert.equal(local.has('status-right-length'), false);
  assert.equal(local.has('@fm-quota-status-active'), false);
  assert.match(codexStatusRight('fm-fixture', {
    fm2Home: '/tmp/fm home', codexHome: '/tmp/codex home',
  }), /fm-fixture/);
});

test('a panel-local tmux status is restored byte-for-byte', () => {
  const local = new Map([
    ['status-right', '#[fg=colour33]LOCAL %a %H:%M  '],
    ['status-right-length', '73'],
  ]);
  const global = new Map([
    ['status-right', 'GLOBAL '],
    ['status-right-length', '40'],
  ]);
  const run = (command, args) => {
    if (args[0] === 'show-option') {
      const values = args.includes('-gv') ? global : local;
      return values.get(args.at(-1)) || '';
    }
    if (args[0] === 'set-option') {
      if (args.includes('-u')) local.delete(args.at(-1));
      else local.set(args.at(-2), args.at(-1));
    }
    return '';
  };

  assert.equal(configurePanelQuotaStatus('fm-fixture', 'codex', { fm2Home: '/missing', run }), true);
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'claude', { fm2Home: '/missing', run }), true);
  assert.equal(local.get('status-right'), '#[fg=colour33]LOCAL %a %H:%M  ');
  assert.equal(local.get('status-right-length'), '73');
  assert.equal(local.has('@fm-quota-status-active'), false);
});

test('an intentionally empty panel-local status does not become the global status on restore', () => {
  const local = new Map([
    ['status-right', ''],
    ['status-right-length', '0'],
  ]);
  const global = new Map([
    ['status-right', 'GLOBAL '],
    ['status-right-length', '40'],
  ]);
  const run = (command, args) => {
    if (args[0] === 'show-option') {
      const option = args.at(-1);
      const values = args.includes('-gv') ? global : local;
      if (args.includes('-q') && !args.includes('-qv')) {
        return values.has(option) ? `${option} "${values.get(option)}"\n` : '';
      }
      return values.get(option) ?? '';
    }
    if (args[0] === 'set-option') {
      if (args.includes('-u')) local.delete(args.at(-1));
      else local.set(args.at(-2), args.at(-1));
    }
    return '';
  };

  assert.equal(configurePanelQuotaStatus('fm-fixture', 'codex', { fm2Home: '/missing', run }), true);
  assert.equal(local.get('@fm-quota-status-base-local'), '1');
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'claude', { fm2Home: '/missing', run }), true);
  assert.equal(local.has('status-right'), true);
  assert.equal(local.get('status-right'), '');
  assert.equal(local.get('status-right-length'), '0');
});

test('Claude keeps the shared quota bar while a Codex worker remains in the panel', (t) => {
  const fm2Home = mkdtempSync(join(tmpdir(), 'fm2-quota-mixed-'));
  t.after(() => rmSync(fm2Home, { recursive: true, force: true }));
  const tasks = join(fm2Home, 'tasks');
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(tasks, 'worker.json'), JSON.stringify({
    id: 'worker', panel: 'fm-fixture', agent: 'codex',
  }));

  const local = new Map([
    ['status-right', 'fm quota command'],
    ['status-right-length', '160'],
    ['@fm-quota-status-base', 'ORIGINAL '],
    ['@fm-quota-status-base-length', '40'],
    ['@fm-quota-status-base-local', '1'],
    ['@fm-quota-status-length-local', '1'],
    ['@fm-quota-status-active', '1'],
  ]);
  const run = (command, args) => {
    if (args[0] === 'show-option') return local.get(args.at(-1)) || '';
    if (args[0] === 'set-option') throw new Error('Claude unexpectedly changed the status bar');
    return '';
  };
  assert.equal(configurePanelQuotaStatus('fm-fixture', 'claude', { fm2Home, run }), true);
  assert.equal(local.get('@fm-quota-status-active'), '1');
});

test('a marked legacy quota base is repaired instead of nested again', () => {
  const local = new Map([
    ['status-right', "#[fg=colour216]#('node' 'quota-status.mjs') CLOCK "],
    ['status-right-length', '96'],
    ['@fm-quota-status-base', "#[fg=colour216]#('node' 'quota-status.mjs') CLOCK "],
    ['@fm-quota-status-base-length', '96'],
    ['@fm-quota-status-base-local', '1'],
    ['@fm-quota-status-length-local', '1'],
    ['@fm-quota-status-active', '1'],
  ]);
  const global = new Map([
    ['status-right', 'CLOCK '],
    ['status-right-length', '40'],
  ]);
  const run = (command, args) => {
    if (args[0] === 'show-option') {
      const values = args.includes('-gv') ? global : local;
      return values.get(args.at(-1)) || '';
    }
    if (args[0] === 'set-option') {
      if (args.includes('-u')) local.delete(args.at(-1));
      else local.set(args.at(-2), args.at(-1));
    }
    return '';
  };

  assert.equal(configurePanelQuotaStatus('fm-fixture', 'codex', { run }), true);
  assert.equal((local.get('status-right').match(/quota-status\.mjs/g) || []).length, 1);
  assert.equal(local.get('@fm-quota-status-base'), 'CLOCK ');
  assert.equal(local.get('@fm-quota-status-base-local'), '0');
  assert.equal(local.get('@fm-quota-status-base-length'), '40');
});
