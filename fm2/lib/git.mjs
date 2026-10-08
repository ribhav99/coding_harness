// git, asked from Node. Quiet by default: a failed question is the caller's
// to interpret, not something to print over the pane.

import { execFileSync } from 'node:child_process';

export function git(cwd, args, { quiet = true } = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  }).trim();
}
