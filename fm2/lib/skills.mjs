// Keeping this repo's skills reachable by the sessions that need them.
//
// The skills live here, in git, which is the whole point of the repo. But a
// worker does not run here — it runs in a worktree of some other project — so
// project-local discovery never sees them. They have to be in the provider's
// global skills directory,
// which means a symlink per skill, which means a manual step, which means they
// go stale the moment the checkout moves or a second machine appears. That is
// exactly what happened: a review told to "run the full-review skill" resolved
// it to a copy in an abandoned checkout and improvised instead.
//
// So nothing manual. Every launch relinks them from wherever this file actually
// is. It is idempotent and costs a readlink per skill, which is nothing next to
// starting a session, and it means a `git pull` is genuinely all it takes.

import { readdirSync, existsSync, mkdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(dirname(HERE));

export function skillsRoot(agent = 'claude') {
  if (agent === 'codex') {
    return process.env.CODEX_SKILLS_DIR || join(homedir(), '.agents', 'skills');
  }
  return process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills');
}

// Every <repo>/skills/<category>/<name>.md, as [name, path].
export function repoSkills(repo = REPO) {
  const base = join(repo, 'skills');
  if (!existsSync(base)) return [];
  const out = [];
  for (const category of readdirSync(base, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const file of readdirSync(join(base, category.name))) {
      if (!file.endsWith('.md') || file.startsWith('_')) continue;
      out.push([basename(file, '.md'), join(base, category.name, file)]);
    }
  }
  return out;
}

function currentTarget(link) {
  try {
    if (!lstatSync(link).isSymbolicLink()) return null;
    return realpathSync(link);
  } catch {
    return null;
  }
}

// Returns the names it had to repair, so a caller can say so. An empty array is
// the normal case and worth staying quiet about.
export function syncSkills({ repo = REPO, agent = 'claude', root = skillsRoot(agent) } = {}) {
  const repaired = [];
  for (const [name, target] of repoSkills(repo)) {
    const link = join(root, name, 'SKILL.md');
    let want;
    try { want = realpathSync(target); } catch { continue; }
    if (currentTarget(link) === want) continue;
    try {
      mkdirSync(dirname(link), { recursive: true });
      // A stale link, or a real file someone dropped there, both have to go
      // before symlink() will take. Only ever inside the chosen skills root.
      if (existsSync(link) || currentTarget(link) !== null) rmSync(link, { force: true });
      symlinkSync(target, link);
      repaired.push(name);
    } catch {
      // A skill that cannot be linked is not worth failing a launch over: the
      // session still runs, and the one skill it wanted will say it is missing.
    }
  }
  return repaired;
}

export { REPO };
