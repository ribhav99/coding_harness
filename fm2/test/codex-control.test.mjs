import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { connectControl, interruptSession } from '../lib/codex-control.mjs';

function session(id, overrides = {}) {
  return { id, cwd: '/fixture/project', path: `/fixture/${id}.jsonl`, parentThreadId: null,
    status: { type: 'active', activeFlags: [] }, goal: { status: 'active', objective: `Finish ${id}`, tokenBudget: 3000 },
    turns: [{ id: `${id}-turn`, status: 'inProgress' }], queue: [], terminals: [{ id: `${id}-terminal` }], ...overrides };
}

function daemon(records, { afterCall, retainTerminals = false } = {}) {
  const sessions = new Map(records.map(record => [record.id, structuredClone(record)]));
  const calls = [];
  const isDescendant = (record, ancestor) => {
    for (let parent = record.parentThreadId; parent; parent = sessions.get(parent)?.parentThreadId) {
      if (parent === ancestor) return true;
    }
    return false;
  };
  const page = (data, cursor) => {
    const index = Number(cursor ?? 0);
    return { data: data.slice(index, index + 1), nextCursor: index + 1 < data.length ? String(index + 1) : null };
  };
  const control = {
    async call(method, params) {
      calls.push({ method, params: structuredClone(params) });
      const record = sessions.get(params.threadId);
      let result;
      switch (method) {
        case 'thread/read':
          assert.ok(record, `Unexpected thread ${params.threadId}`);
          result = { thread: record }; break;
        case 'thread/goal/get': result = { goal: record.goal }; break;
        case 'thread/goal/set':
          assert.deepEqual(params, { threadId: record.id, status: 'paused' });
          record.goal.status = params.status;
          result = { goal: record.goal }; break;
        case 'thread/turns/list': result = { data: record.turns, nextCursor: null }; break;
        case 'turn/interrupt': {
          const turn = record.turns.find(turn => turn.id === params.turnId);
          assert.ok(turn, 'Interrupt must name an observed turn');
          turn.status = 'interrupted'; record.status = { type: 'idle' };
          result = {}; break;
        }
        case 'thread/queue/list': result = page(record.queue, params.cursor); break;
        case 'thread/backgroundTerminals/clean':
          if (!retainTerminals) record.terminals = [];
          result = {}; break;
        case 'thread/backgroundTerminals/list': result = page(record.terminals, params.cursor); break;
        case 'thread/list':
          assert.ok(params.ancestorThreadId, 'Listing all threads would broaden shutdown scope');
          assert.deepEqual(new Set(params.sourceKinds), new Set(['cli', 'vscode', 'exec', 'appServer',
            'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']));
          result = page([...sessions.values()].filter(child => isDescendant(child, params.ancestorThreadId)), params.cursor);
          break;
        default: throw new Error(`Unexpected RPC ${method}`);
      }
      const snapshot = structuredClone(result);
      await afterCall?.({ method, params, sessions, result: snapshot, calls });
      return snapshot;
    },
    close() { assert.fail('An injected shared client must remain open'); },
  };
  return { control, calls, sessions };
}

test('shutdown pauses goals, interrupts exact turns, cleans writers, and preserves queued input across descendant pages', async () => {
  const queue = [1, 2].map(number => ({ id: `queued-${number}`, clientUserMessageId: `user-${number}`,
    input: [{ type: 'text', text: `Unfinished instruction ${number}` }] }));
  const unrelated = session('unrelated');
  const f = daemon([session('source', { queue }), session('child', { parentThreadId: 'source' }),
    session('grandchild', { parentThreadId: 'child' }), unrelated]);
  const result = await interruptSession('source', { control: f.control });
  assert.deepEqual(result.queue, queue);
  assert.equal(result.goal.status, 'active', 'Handoff retains the original goal state');
  assert.equal(result.goal.objective, 'Finish source');
  assert.equal(result.path, '/fixture/source.jsonl');
  assert.deepEqual(new Set(result.children.map(child => child.id)), new Set(['child', 'grandchild']));
  for (const id of ['source', 'child', 'grandchild']) {
    const record = f.sessions.get(id);
    assert.equal(record.status.type, 'idle');
    assert.equal(record.goal.status, 'paused');
    assert.deepEqual(record.terminals, []);
    const paused = f.calls.findIndex(call => call.method === 'thread/goal/set' && call.params.threadId === id);
    const stopped = f.calls.findIndex(call => call.method === 'turn/interrupt' && call.params.threadId === id);
    assert.ok(paused < stopped, 'Pause automatic goal continuation before interrupting the active turn');
  }
  assert.deepEqual(f.sessions.get('unrelated'), unrelated);
  assert.ok(f.calls.every(call => call.params.threadId !== 'unrelated'));
  assert.ok(f.calls.every(call => !['thread/queue/delete', 'thread/queue/start', 'turn/start'].includes(call.method)));
  assert.deepEqual(f.sessions.get('source').queue, queue);
});

test('empty and mismatched session identities fail before any mutating RPC', async () => {
  const calls = [];
  const control = { async call(method, params) { calls.push({ method, params }); return { thread: session('different') }; } };
  await assert.rejects(interruptSession('', { control }), /exact Codex session ID/u);
  assert.deepEqual(calls, []);
  await assert.rejects(interruptSession('source', { control }), /different thread/u);
  assert.deepEqual(calls, [{ method: 'thread/read', params: { threadId: 'source' } }]);
});

test('an identity mismatch while verifying the interrupt prevents further cleanup', async () => {
  let reads = 0;
  const f = daemon([session('source')], {
    afterCall({ method, result }) {
      if (method === 'thread/read' && ++reads === 2) result.thread.id = 'different';
    },
  });
  await assert.rejects(interruptSession('source', { control: f.control }), /different thread/u);
  assert.ok(f.calls.every(call => !call.method.startsWith('thread/backgroundTerminals/')));
});

function worktrees(t) {
  const directory = mkdtempSync('/tmp/fm-control-cwd-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const other = join(directory, 'other');
  const alias = join(directory, 'source-link');
  mkdirSync(source); mkdirSync(other);
  symlinkSync(source, alias, 'dir');
  return { source, other, alias };
}

test('expected worktree mismatches refuse shutdown before any mutation', async t => {
  const paths = worktrees(t);
  const record = session('source', { cwd: paths.other });
  const f = daemon([record]);
  await assert.rejects(interruptSession('source', { control: f.control, expectedCwd: paths.source }), /different worktree/u);
  assert.deepEqual(f.calls, [{ method: 'thread/read', params: { threadId: 'source' } }]);
  assert.deepEqual(f.sessions.get('source'), record);
});

test('equivalent worktree symlinks are accepted on either side of the identity check', async t => {
  const paths = worktrees(t);
  for (const [cwd, expectedCwd] of [[paths.source, paths.alias], [paths.alias, paths.source]]) {
    const f = daemon([session('source', { cwd })]);
    await interruptSession('source', { control: f.control, expectedCwd });
    assert.equal(f.sessions.get('source').status.type, 'idle');
    assert.deepEqual(f.sessions.get('source').terminals, []);
  }
});

test('final verification refuses a worktree change even when the same thread remains idle', async t => {
  const paths = worktrees(t);
  const f = daemon([session('source', { cwd: paths.source })], {
    afterCall({ method, sessions }) {
      if (method === 'thread/list') sessions.get('source').cwd = paths.other;
    },
  });
  await assert.rejects(interruptSession('source', { control: f.control, expectedCwd: paths.source }), /different worktree/u);
  assert.equal(f.sessions.get('source').status.type, 'idle');
});

test('unknown goal protocol fails closed instead of assuming autonomous work is stopped', async () => {
  const f = daemon([session('source')]);
  const original = f.control.call;
  f.control.call = async (method, params) => {
    if (method === 'thread/goal/get') throw new Error('Method not found');
    return original(method, params);
  };
  await assert.rejects(interruptSession('source', { control: f.control }), /Method not found/u);
  assert.deepEqual(f.calls.map(call => call.method), ['thread/read']);
  assert.equal(f.sessions.get('source').status.type, 'active');
});

test('stopped, unloaded sessions preserve nonactive goals without loading or starting work', async () => {
  for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) {
    const record = session('source', { status: { type: 'notLoaded' }, turns: [], terminals: [], goal: { status } });
    const f = daemon([record]);
    const result = await interruptSession('source', { control: f.control });
    assert.equal(result.goal.status, status);
    assert.deepEqual(f.sessions.get('source'), record);
    assert.ok(f.calls.every(call => !['thread/goal/set', 'turn/interrupt',
      'thread/backgroundTerminals/clean', 'thread/resume'].includes(call.method)));
  }
});

test('remaining background writers and unverifiable status both refuse a successful handoff', async () => {
  const writers = daemon([session('source')], { retainTerminals: true });
  await assert.rejects(interruptSession('source', { control: writers.control }), /background tools are still running/u);
  const invalid = daemon([session('source', { turns: [], status: { type: 'systemError' } })]);
  await assert.rejects(interruptSession('source', { control: invalid.control }), /Cannot verify stopped Codex status/u);
});

test('a turn restarted while a descendant stops cannot be reported as quiescent', async () => {
  const f = daemon([session('source'), session('child', { parentThreadId: 'source' })], {
    afterCall({ method, params, sessions }) {
      if (method === 'turn/interrupt' && params.threadId === 'child') {
        const source = sessions.get('source');
        source.status = { type: 'active', activeFlags: [] };
        source.turns.unshift({ id: 'queued-follow-up', status: 'inProgress' });
      }
    },
  });
  let error;
  try { await interruptSession('source', { control: f.control }); } catch (caught) { error = caught; }
  if (error) assert.match(error.message, /resumed|writer|descendant|spawned|changed/u);
  assert.ok(error instanceof Error || f.sessions.get('source').status.type === 'idle',
    'Either stop the follow-up or refuse the handoff; an active old provider can still write');
});

test('a descendant spawned during shutdown cannot escape the stopped thread inventory', async () => {
  let spawned = false;
  const f = daemon([session('source'), session('child', { parentThreadId: 'source' })], {
    afterCall({ method, params, sessions }) {
      if (!spawned && method === 'thread/read' && params.threadId === 'child') {
        spawned = true;
        sessions.set('late-grandchild', session('late-grandchild', { parentThreadId: 'child' }));
      }
    },
  });
  let error;
  try { await interruptSession('source', { control: f.control }); } catch (caught) { error = caught; }
  assert.ok(spawned);
  if (error) assert.match(error.message, /resumed|writer|descendant|spawned|changed/u);
  assert.ok(error instanceof Error || f.sessions.get('late-grandchild').status.type === 'idle',
    'A fresh descendant inventory must stop or detect agents spawned after the initial listing');
});

test('a session loaded during shutdown cannot retain background writers based on its initial unloaded status', async () => {
  let loaded = false;
  const f = daemon([session('source', { status: { type: 'notLoaded' }, turns: [], terminals: [] })], {
    afterCall({ method, sessions }) {
      if (!loaded && method === 'thread/read') {
        loaded = true;
        const source = sessions.get('source');
        source.status = { type: 'active', activeFlags: [] };
        source.turns = [{ id: 'newly-loaded-turn', status: 'inProgress' }];
        source.terminals = [{ id: 'new-writer' }];
      }
    },
  });
  let error;
  try { await interruptSession('source', { control: f.control }); } catch (caught) { error = caught; }
  if (error) assert.match(error.message, /resumed|writer|background|loaded|changed/u);
  assert.ok(error instanceof Error || f.sessions.get('source').terminals.length === 0,
    'A loaded source needs writer cleanup even when the first read saw an unloaded session');
});

test('final verification catches a background writer appearing after cleanup without an active turn', async () => {
  const f = daemon([session('source'), session('child', { parentThreadId: 'source' })], {
    afterCall({ method, params, sessions }) {
      if (method === 'turn/interrupt' && params.threadId === 'child') {
        sessions.get('source').terminals.push({ id: 'late-writer' });
      }
    },
  });
  await assert.rejects(interruptSession('source', { control: f.control }), /background tools are still running/u);
  assert.equal(f.sessions.get('source').status.type, 'idle');
});

function serverFrame(payload, { opcode = 1, final = true } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const extended = body.length < 126 ? 0 : body.length <= 65535 ? 2 : 8;
  const header = Buffer.alloc(2 + extended);
  header[0] = (final ? 0x80 : 0) | opcode;
  header[1] = extended === 0 ? body.length : extended === 2 ? 126 : 127;
  if (extended === 2) header.writeUInt16BE(body.length, 2);
  if (extended === 8) header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

async function socketServer(t, { onMessage, onFrame, onUpgrade } = {}) {
  const directory = mkdtempSync('/tmp/fm-control-');
  const socketPath = join(directory, 'socket');
  const connections = new Set();
  const errors = [];
  const messages = [];
  const server = createServer();
  server.on('connection', socket => {
    connections.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => connections.delete(socket));
  });
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(errors, [], 'The mock server must receive valid masked WebSocket frames');
  });
  server.on('upgrade', (request, socket, head) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] +
      '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    if (onUpgrade) { onUpgrade(socket, accept); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer = head;
    const consume = () => {
      try {
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 15;
          assert.ok(buffer[0] & 0x80, 'Client sends complete messages');
          assert.ok(buffer[1] & 0x80, 'Client frames must be masked');
          let length = buffer[1] & 127;
          let offset = 2;
          if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
          if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          if (buffer.length < offset + 4 + length) return;
          const mask = buffer.subarray(offset, offset + 4);
          const body = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
          buffer = buffer.subarray(offset + 4 + length);
          for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
          onFrame?.({ opcode, body, socket });
          if (opcode !== 1) continue;
          const message = JSON.parse(body.toString('utf8'));
          messages.push(message);
          const reply = result => socket.write(serverFrame(JSON.stringify({ id: message.id, result })));
          if (message.method === 'initialize') reply({ userAgent: 'fixture' });
          else if (message.id) onMessage?.({ message, socket, reply });
        }
      } catch (error) { errors.push(error.message); socket.destroy(); }
    };
    socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); consume(); });
    consume();
  });
  server.listen(socketPath);
  await once(server, 'listening');
  return { socketPath, messages };
}

test('control transport handles fragmented JSON, split bytes, ping/pong, and unsolicited notifications', { timeout: 2000 }, async t => {
  const pongs = [];
  let receivedPong;
  const pong = new Promise(resolve => { receivedPong = resolve; });
  const value = { text: 'é'.repeat(100) };
  const f = await socketServer(t, {
    onFrame({ opcode, body }) {
      if (opcode === 10) { pongs.push(body.toString()); receivedPong(); }
    },
    onMessage({ message, socket }) {
      const response = Buffer.from(JSON.stringify({ id: message.id, result: value }));
      const split = response.indexOf(Buffer.from('é')) + 1;
      const frames = Buffer.concat([
        serverFrame(JSON.stringify({ method: 'thread/status/changed', params: {} })),
        serverFrame(response.subarray(0, split), { final: false }),
        serverFrame('keepalive', { opcode: 9 }),
        serverFrame(response.subarray(split), { opcode: 0 }),
      ]);
      socket.write(frames.subarray(0, 3));
      setImmediate(() => socket.write(frames.subarray(3)));
    },
  });
  const control = await connectControl({ socketPath: f.socketPath, timeoutMs: 1000 });
  t.after(() => control.close());
  assert.deepEqual(await control.call('fixture/read'), value);
  await pong;
  assert.deepEqual(pongs, ['keepalive']);
  assert.equal(f.messages[0].method, 'initialize');
  assert.equal(f.messages[0].params.capabilities.experimentalApi, true);
  assert.equal(f.messages[1].method, 'initialized');
});

test('control transport correlates out-of-order responses and supports 64-bit frame lengths', async t => {
  const requests = [];
  const f = await socketServer(t, {
    onMessage(request) {
      requests.push(request);
      if (requests.length === 2) {
        requests[1].reply(requests[1].message.params);
        requests[0].reply(requests[0].message.params);
      }
    },
  });
  const control = await connectControl({ socketPath: f.socketPath, timeoutMs: 1000 });
  t.after(() => control.close());
  const large = { text: 'x'.repeat(70_000) };
  assert.deepEqual(await Promise.all([control.call('fixture/first', large), control.call('fixture/second', { count: 2 })]),
    [large, { count: 2 }]);
});

test('an RPC error rejects only its request and a timeout cannot consume a later response', async t => {
  let late;
  const f = await socketServer(t, {
    onMessage({ message, socket, reply }) {
      if (message.method === 'fixture/error') {
        socket.write(serverFrame(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Method not found' } })));
      } else if (message.method === 'fixture/slow') late = reply;
      else { late?.({ wrong: true }); reply({ correct: true }); }
    },
  });
  const control = await connectControl({ socketPath: f.socketPath, timeoutMs: 100 });
  t.after(() => control.close());
  await assert.rejects(control.call('fixture/error'), /fixture\/error: Method not found/u);
  await assert.rejects(control.call('fixture/slow'), /fixture\/slow timed out/u);
  assert.deepEqual(await control.call('fixture/next'), { correct: true });
});

test('closing the socket rejects every in-flight request', async t => {
  let count = 0;
  const f = await socketServer(t, { onMessage({ socket }) { if (++count === 2) socket.destroy(); } });
  const control = await connectControl({ socketPath: f.socketPath, timeoutMs: 1000 });
  t.after(() => control.close());
  const results = await Promise.allSettled([control.call('fixture/one'), control.call('fixture/two')]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /connection closed/u);
  }
});

test('invalid JSON, overlapping fragments, and oversized frames fail closed', async t => {
  const oversized = Buffer.alloc(10);
  oversized[0] = 0x81; oversized[1] = 127;
  oversized.writeBigUInt64BE(16n * 1024n * 1024n + 1n, 2);
  for (const [name, payload, error] of [
    ['invalid JSON', serverFrame('{invalid'), /JSON|property name/u],
    ['overlap', Buffer.concat([serverFrame('{', { final: false }), serverFrame('{}')]), /Overlapping/u],
    ['oversize', oversized, /frame too large/u],
  ]) {
    await t.test(name, async child => {
      const f = await socketServer(child, { onMessage({ socket }) { socket.write(payload); } });
      const control = await connectControl({ socketPath: f.socketPath, timeoutMs: 1000 });
      child.after(() => control.close());
      await assert.rejects(control.call('fixture/read'), error);
    });
  }
});

test('bad handshake, refused HTTP upgrade, and stalled upgrade cannot initialize control', async t => {
  await t.test('invalid accept', async child => {
    const f = await socketServer(child, { onUpgrade(socket) {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n\r\n');
    } });
    await assert.rejects(connectControl({ socketPath: f.socketPath, timeoutMs: 100 }), /Invalid Codex control handshake/u);
  });
  await t.test('HTTP refusal', async child => {
    const f = await socketServer(child, { onUpgrade(socket) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    } });
    await assert.rejects(connectControl({ socketPath: f.socketPath, timeoutMs: 100 }), /rejected upgrade: 403/u);
  });
  await t.test('upgrade timeout', async child => {
    const f = await socketServer(child, { onUpgrade() {} });
    await assert.rejects(connectControl({ socketPath: f.socketPath, timeoutMs: 40 }), /socket timed out/u);
  });
  await t.test('initialization timeout', async child => {
    const f = await socketServer(child, { onUpgrade(socket, accept) {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    } });
    await assert.rejects(connectControl({ socketPath: f.socketPath, timeoutMs: 40 }), /initialize timed out/u);
  });
});
