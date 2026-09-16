import { request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 16 * 1024 * 1024;

function frame(payload, opcode = 1) {
  const data = Buffer.from(payload), mask = randomBytes(4);
  const length = data.length < 126 ? 2 : data.length <= 65535 ? 4 : 10;
  const header = Buffer.alloc(length + 4); header[0] = 0x80 | opcode;
  header[1] = 0x80 | (length === 2 ? data.length : length === 4 ? 126 : 127);
  if (length === 4) header.writeUInt16BE(data.length, 2);
  if (length === 10) header.writeBigUInt64BE(BigInt(data.length), 2);
  mask.copy(header, length);
  const body = Buffer.from(data);
  for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
  return Buffer.concat([header, body]);
}

export async function connectControl({ socketPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'),
  'app-server-control', 'app-server-control.sock'), timeoutMs = 5000 } = {}) {
  const key = randomBytes(16).toString('base64');
  const pending = new Map(); let sequence = 0, buffer = Buffer.alloc(0), fragments = [], fragmented = false;
  const socket = await new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/', headers: { Host: 'localhost', Upgrade: 'websocket',
      Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Codex control socket timed out')));
    req.on('error', reject);
    req.on('response', (res) => { res.resume(); reject(new Error(`Codex control socket rejected upgrade: ${res.statusCode}`)); });
    req.on('upgrade', (res, stream, head) => {
      req.setTimeout(0);
      const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (res.headers['sec-websocket-accept'] !== expected) { stream.destroy(); reject(new Error('Invalid Codex control handshake')); return; }
      buffer = head; resolve(stream);
    });
    req.end();
  });
  const fail = (error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  const consume = () => {
    try {
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15, final = Boolean(buffer[0] & 128), masked = Boolean(buffer[1] & 128);
        let size = buffer[1] & 127, offset = 2;
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (buffer.length < 10) return; const large = buffer.readBigUInt64BE(2); if (large > BigInt(LIMIT)) throw new Error('Codex frame too large'); size = Number(large); offset = 10; }
        if (size > LIMIT) throw new Error('Codex frame too large');
        if (buffer.length < offset + (masked ? 4 : 0) + size) return;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null; if (masked) offset += 4;
        const body = Buffer.from(buffer.subarray(offset, offset + size)); buffer = buffer.subarray(offset + size);
        if (mask) for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
        if (opcode === 8) { socket.end(); fail(new Error('Codex control connection closed')); return; }
        if (opcode === 9) { socket.write(frame(body, 10)); continue; }
        if (opcode === 10) continue;
        if (opcode === 1) { if (fragmented) throw new Error('Overlapping Codex frames'); fragments = [body]; fragmented = !final; }
        else if (opcode === 0 && fragmented) { fragments.push(body); fragmented = !final; }
        else throw new Error('Unsupported Codex control frame');
        if (fragments.reduce((sum, part) => sum + part.length, 0) > LIMIT) throw new Error('Codex message too large');
        if (!final) continue;
        const message = JSON.parse(Buffer.concat(fragments).toString('utf8')); fragments = [];
        if (message.method || (!Object.hasOwn(message, 'result') && !message.error)) continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id); clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`Codex ${waiter.method}: ${message.error.message}`)); else waiter.resolve(message.result);
      }
    } catch (error) { fail(error); socket.destroy(); }
  };
  socket.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); consume(); });
  socket.on('error', fail); socket.on('close', () => fail(new Error('Codex control connection closed')));
  consume();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs);
    pending.set(id, { method, resolve, reject, timer });
    socket.write(frame(JSON.stringify({ id, method, params })));
  });
  try {
    await call('initialize', { clientInfo: { name: 'coding-harness', version: '1' }, capabilities: { experimentalApi: true } });
    socket.write(frame(JSON.stringify({ method: 'initialized', params: {} })));
  } catch (error) { socket.destroy(); throw error; }
  return { call, close: () => socket.destroy() };
}

export async function interruptSession(id, { control, expectedCwd, descendants: includeDescendants = true, ...options } = {}) {
  if (!id) throw new Error('exact Codex session ID is required to stop daemon work');
  const canonicalCwd = expectedCwd === undefined ? null : realpathSync(expectedCwd);
  const verifyIdentity = (thread, targetId) => {
    if (thread?.id !== targetId) throw new Error('Codex returned a different thread');
    if (targetId === id && canonicalCwd !== null && realpathSync(thread.cwd) !== canonicalCwd) {
      throw new Error(`Codex session ${id} has a different worktree; refusing another writer`);
    }
  };
  const client = control ?? await connectControl(options);
  const result = { id, goal: null, queue: [], children: [] };
  const belongs = async (candidate) => {
    const seen = new Set(); let next = candidate;
    while (next && seen.size < 100) {
      if (next === id) return true;
      if (seen.has(next)) return false;
      seen.add(next);
      const thread = (await client.call('thread/read', { threadId: next })).thread;
      if (thread?.id !== next) throw new Error('Codex returned a different descendant thread');
      next = thread.parentThreadId;
    }
    return false;
  };
  const inventory = async () => {
    const children = []; let cursor = null;
    do {
      const page = await client.call('thread/list', { ancestorThreadId: id, cursor, limit: 100,
        sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'] });
      for (const child of page.data ?? []) if (child.id !== id && await belongs(child.id)) children.push(child.id);
      cursor = page.nextCursor;
    } while (cursor);
    return [...new Set(children)];
  };
  try {
    const initial = (await client.call('thread/read', { threadId: id })).thread;
    verifyIdentity(initial, id);
    result.path = initial.path;
    const { goal } = await client.call('thread/goal/get', { threadId: id });
    result.goal = goal;
    if (goal?.status === 'active') await client.call('thread/goal/set', { threadId: id, status: 'paused' });
    const page = await client.call('thread/turns/list', { threadId: id, limit: 10, sortDirection: 'desc' });
    for (const turn of page.data ?? []) if (turn.status === 'inProgress') await client.call('turn/interrupt', { threadId: id, turnId: turn.id });
    let idle = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const thread = (await client.call('thread/read', { threadId: id })).thread;
      verifyIdentity(thread, id);
      if (['idle', 'notLoaded'].includes(thread.status?.type)) { idle = true; break; }
      if (thread.status?.type !== 'active') throw new Error(`Cannot verify stopped Codex status: ${thread.status?.type}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!idle) throw new Error('Codex daemon turn did not stop');
    let queueCursor = null;
    do {
      const queue = await client.call('thread/queue/list', { threadId: id, cursor: queueCursor, limit: 100 });
      result.queue.push(...queue.data); queueCursor = queue.nextCursor;
    } while (queueCursor);
    const beforeCleanup = (await client.call('thread/read', { threadId: id })).thread;
    verifyIdentity(beforeCleanup, id);
    if (!['idle', 'notLoaded'].includes(beforeCleanup.status?.type)) {
      throw new Error(`Codex session ${id} resumed during handoff; refusing another writer`);
    }
    if (beforeCleanup.status.type !== 'notLoaded') {
      await client.call('thread/backgroundTerminals/clean', { threadId: id });
      const terminals = await client.call('thread/backgroundTerminals/list', { threadId: id, limit: 1 });
      if (terminals.data?.length) throw new Error('Codex background tools are still running');
    }
    if (includeDescendants) {
      for (const child of await inventory()) result.children.push(await interruptSession(child, { control: client, descendants: false }));
      const known = new Set(result.children.map((child) => child.id));
      if ((await inventory()).some((child) => !known.has(child))) throw new Error('Codex spawned another descendant during handoff; refusing another writer');
    }
    for (const stoppedId of [id, ...result.children.map((child) => child.id)]) {
      const thread = (await client.call('thread/read', { threadId: stoppedId })).thread;
      verifyIdentity(thread, stoppedId);
      if (!['idle', 'notLoaded'].includes(thread.status?.type)) {
        throw new Error(`Codex session ${stoppedId} resumed during handoff; refusing another writer`);
      }
      if (thread.status.type !== 'notLoaded') {
        const terminals = await client.call('thread/backgroundTerminals/list', { threadId: stoppedId, limit: 1 });
        if (terminals.data?.length) throw new Error('Codex background tools are still running');
      }
    }
    return result;
  } finally { if (!control) client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await interruptSession(process.argv[2], { expectedCwd: process.argv[3] }))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
