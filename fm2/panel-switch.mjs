#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { executePanelSwitch } from './lib/panel-switch.mjs';

try {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const result = executePanelSwitch(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  process.stdout.write(`Switched ${result.from} to ${result.to}. Full handoff: ${result.path}\n`);
} catch (error) {
  process.stderr.write(`fm: ${error.message}\n`);
  process.exitCode = 1;
}
