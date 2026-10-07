// Project-scoped review delivery. Never source a project's shell/.env file.
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export function projectForSurface(env = process.env, cwd = process.cwd()) {
  if (env.FM_PROJECT) return resolve(env.FM_PROJECT);
  if (env.FM2_TASK) {
    try {
      const task = JSON.parse(readFileSync(join(env.FM2_HOME || join(homedir(), '.fm2'), 'tasks', `${env.FM2_TASK}.json`), 'utf8'));
      if (task.project) return resolve(task.project);
    } catch { /* ordinary terminals have no task record */ }
  }
  try {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(common);
  } catch { return resolve(cwd); }
}

export function remoteReviews(project, env = process.env) {
  // A saved project choice is authoritative, including in already-live workers.
  // Otherwise an explicit launch environment works without a config file.
  let value = env.FM_REMOTE;
  const config = join(project, '.fm2.json');
  if (existsSync(config)) {
    const settings = JSON.parse(readFileSync(config, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('.fm2.json must contain a settings object');
    if (Object.hasOwn(settings, 'remote')) value = settings.remote;
  }
  return parseRemote(value);
}

export function parseRemote(value) {
  if (value == null || value === '') return false;
  if (value === true || /^(yes|true|on|1)$/i.test(String(value))) return true;
  if (value === false || /^(no|false|off|0)$/i.test(String(value))) return false;
  throw new Error('FM_REMOTE / .fm2.json remote must be yes/no, true/false, on/off, or 1/0');
}

export function setRemoteReviews(project, value) {
  const remote = parseRemote(value);
  const path = join(resolve(project), '.fm2.json');
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('.fm2.json must contain a settings object');
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...settings, remote }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
  return remote;
}
