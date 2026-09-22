#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- coding-harness:dynamic-effort:start -->';
const END = '<!-- coding-harness:dynamic-effort:end -->';

function block(provider) {
  const levels = provider === 'codex'
    ? '`low`, `medium`, `high`, `xhigh`, `max`, and `ultra`'
    : '`low`, `medium`, `high`, `xhigh`, and `max`';
  const ultra = provider === 'codex'
    ? ' `ultra` is the maximum reasoning setting and includes automatic task delegation.'
    : '';
  return `${START}\n## Dynamic reasoning effort (Firstmate)\n\n` +
    `When \`FM2_TASK\` is set, this session can change its own reasoning effort. The default is ` +
    `\`high\`; \`FM2_EFFORT\` contains the active level. Autonomously choose the lowest level that is ` +
    `sufficient for the work. If the task becomes materially harder or easier than expected, run exactly ` +
    `\`fm effort <level>\`, then end the current turn immediately. The Stop hook will preserve this exact ` +
    `conversation, restart it at that level, and continue automatically. Do not describe the lifecycle stop ` +
    `as task completion. Do not change the model. Valid ${provider} levels are ${levels}.${ultra} Outside an ` +
    `fm-managed session, do not use this command.\n${END}`;
}

function updated(text, provider) {
  const managed = block(provider);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error('dynamic-effort instruction markers are incomplete');
  }
  if (start !== -1) return `${text.slice(0, start)}${managed}${text.slice(end + END.length)}`;
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${managed}\n`;
}

export function installInstructions({
  claudeFile = join(homedir(), '.claude', 'CLAUDE.md'),
  codexFile = join(homedir(), '.codex', 'AGENTS.md'),
  check = false,
} = {}) {
  const changes = [];
  for (const [provider, file] of [['claude', claudeFile], ['codex', codexFile]]) {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const after = updated(before, provider);
    if (before === after) continue;
    changes.push({ provider, file });
    if (!check) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, after);
    }
  }
  return changes;
}

function main(argv) {
  let check = false;
  let claudeFile;
  let codexFile;
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--check') check = true;
    else if (argv[at] === '--claude-file' && argv[at + 1]) claudeFile = resolve(argv[++at]);
    else if (argv[at] === '--codex-file' && argv[at + 1]) codexFile = resolve(argv[++at]);
    else throw new Error('usage: install-instructions.mjs [--check] [--claude-file PATH] [--codex-file PATH]');
  }
  const changes = installInstructions({ claudeFile, codexFile, check });
  if (changes.length) {
    for (const change of changes) process.stdout.write(`  ${check ? 'TODO' : 'ok  '}  ${change.file}\n`);
    if (check) process.exitCode = 1;
  } else process.stdout.write('  ok    global dynamic-effort instructions\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`firstmate: ${error.message}\n`);
    process.exitCode = 1;
  }
}
