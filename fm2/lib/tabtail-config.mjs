// App-owned machine selection and per-fm-identity launch preferences. No run,
// PID, readiness, hook trust or callback bytes are persisted here.
import { accessSync, constants, lstatSync, statSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { home, dir } from './config.mjs';
import { writeJsonAtomic } from './json-file.mjs';

const defaultRelay = () => join(homedir(), '.local/share/relay');
const off = () => ({ version: 1, enabled: false, relay: defaultRelay() });
const choiceFile = id => typeof id === 'string' && /^(?:controller:)?[A-Za-z0-9_.-]+$/.test(id)
  && !['.', '..'].includes(id) ? join(home(), 'tabtail-launches', `${encodeURIComponent(id)}.json`) : null;

function read(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o022 || stat.size > 4096) return { invalid: true };
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || value.version !== 1 || typeof value.enabled !== 'boolean' ||
        (value.enabled && (typeof value.relay !== 'string' || !isAbsolute(value.relay) || /[\0\r\n]/.test(value.relay)))) return { invalid: true };
    return { version: 1, enabled: value.enabled, relay: value.enabled ? value.relay : defaultRelay() };
  } catch (error) { return error.code === 'ENOENT' ? null : { invalid: true }; }
}

export function tabtailSelection(id) {
  const machine = read(join(home(), 'tabtail.json'));
  // A disabled/invalid machine config is an explicit recovery switch, including
  // for preferences previously enabled by a pilot. Absence allows saved choice.
  if (machine && (machine.invalid || !machine.enabled)) return off();
  const ownInvocation = !process.env.FM2_TASK || process.env.FM2_TASK === id;
  if (ownInvocation && Object.hasOwn(process.env, 'FM2_TABTAIL')) {
    return process.env.FM2_TABTAIL === '1'
      ? { version: 1, enabled: true, relay: process.env.FM2_TABTAIL_RELAY || machine?.relay || defaultRelay() }
      : off();
  }
  const path = choiceFile(id), saved = path ? read(path) : null;
  if (saved) return saved.invalid ? off() : saved;
  return machine || off();
}

export function tabtailChoice(id = process.env.FM2_TASK) {
  const choice = tabtailSelection(id);
  if (!choice.enabled || !isAbsolute(choice.relay) || /[\0\r\n]/.test(choice.relay)) return off();
  try {
    const python = join(choice.relay, 'venv/bin/python');
    if (!statSync(python).isFile()) return off();
    accessSync(python, constants.X_OK);
    if (!lstatSync(join(choice.relay, 'adapter/relay_adapter')).isDirectory()) return off();
    return choice;
  } catch { return off(); } // Optional missing runtime must not prevent provider launch.
}

export function rememberTabtailChoice(id) {
  const choice = tabtailSelection(id), path = choiceFile(id);
  const machine = read(join(home(), 'tabtail.json'));
  const explicit = (!process.env.FM2_TASK || process.env.FM2_TASK === id) && Object.hasOwn(process.env, 'FM2_TABTAIL');
  // Default-off and the machine kill switch must not become a sticky opt-out.
  if (!explicit && (!machine || machine.invalid || !machine.enabled)) return tabtailChoice(id);
  if (machine && (machine.invalid || !machine.enabled)) return tabtailChoice(id);
  if (path) {
    try {
      dir('tabtail-launches');
      writeJsonAtomic(path, choice);
    } catch { /* optional persistence never prevents a normal provider launch */ }
  }
  return tabtailChoice(id);
}
