// Read-only identity of the ownership captured by register(). Never probe the
// current pane: tmux may already have reused its id for a different worker.
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export function sourceSession(entry) {
  const { pane, pane_identity: identity, pane_socket: socket, registered_at: registered } = entry;
  const match = typeof identity === 'string' && identity.match(
    /^([1-9][0-9]*):(Mon|Tue|Wed|Thu|Fri|Sat|Sun) +(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([0-9]{1,2}) +([0-9]{2}):([0-9]{2}):([0-9]{2}) +([0-9]{4})$/,
  );
  if (typeof pane !== 'string' || !/^%[0-9]+$/.test(pane) || pane.trim() !== pane ||
      typeof socket !== 'string' || !isAbsolute(socket) || socket.includes('\0') ||
      !match || match[0] !== identity || !Number.isSafeInteger(Number(match[1]))) return undefined;
  const born = Date.parse(identity.slice(identity.indexOf(':') + 1));
  const at = typeof registered === 'string' ? Date.parse(registered) : NaN;
  if (!Number.isFinite(born) || !Number.isFinite(at) || born > at) return undefined;
  const date = new Date(born);
  // Date.parse normalizes impossible calendar dates; those are not ownership.
  if (date.toString().slice(0, 3) !== match[2] ||
      date.toString().slice(4, 7) !== match[3] || date.getDate() !== Number(match[4]) ||
      date.getHours() !== Number(match[5]) || date.getMinutes() !== Number(match[6]) ||
      date.getSeconds() !== Number(match[7]) || date.getFullYear() !== Number(match[8])) return undefined;
  return 'surface-pane-v1:' + createHash('sha256')
    .update(JSON.stringify([socket, pane, identity])).digest('hex');
}
