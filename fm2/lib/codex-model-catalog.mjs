#!/usr/bin/env node
// A short-lived, inference-free app-server client. It uses Codex's own login
// and model catalog without reading or exposing credentials to the harness.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.argv[2], ['app-server', '--listen', 'stdio://'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let done = false;
let sequence = 1;
const models = [];
function finish(error = null) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  else process.stdout.write(JSON.stringify(models));
  child.stdin.end();
  child.kill();
}
const timer = setTimeout(() => finish(new Error('Codex model catalog timed out')), 15_000);
const send = (method, params) => child.stdin.write(JSON.stringify({ id: sequence, method, params }) + '\n');
child.on('error', finish);
child.on('exit', () => { if (!done) finish(new Error('Codex exited before returning its model catalog')); });
child.stdin.on('error', (error) => { if (!done) finish(error); });
child.stderr.resume();
createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id !== sequence) return;
  if (message.error) { finish(new Error(message.error.message)); return; }
  if (sequence === 1) {
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    sequence += 1;
    send('model/list', { limit: 100 });
    return;
  }
  models.push(...(message.result?.data ?? []));
  if (message.result?.nextCursor) {
    sequence += 1;
    send('model/list', { limit: 100, cursor: message.result.nextCursor });
  } else finish();
});
send('initialize', { clientInfo: { name: 'firstmate-model-catalog', version: '1' },
  capabilities: { experimentalApi: true } });
