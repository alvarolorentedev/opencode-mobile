#!/usr/bin/env node
// Local convenience: run the same E2E slice the PR gate would select.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const base = process.env.E2E_BASE || 'origin/main';
const raw = execFileSync(process.execPath, [
  path.join(root, 'scripts/ci/select-validation.mjs'),
  '--event', 'pull_request',
  '--base', base,
  '--head', 'HEAD',
  '--json',
], { cwd: root, encoding: 'utf8' });
const result = JSON.parse(raw);
console.log(`[e2e-changed] mode=${result.mode} reason=${result.reason}`);

if (result.mode === 'none') {
  console.log('[e2e-changed] no Playwright run selected');
  process.exit(0);
}

const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
function run(args, env = process.env) {
  const child = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env });
  if ((child.status ?? 1) !== 0) process.exit(child.status ?? 1);
}

if (result.mode === 'full') {
  run(['test']);
} else {
  run(['test', '--grep', '@smoke']);
  if (result.mode === 'affected') {
    // The smoke run above produced or reused dist-e2e; serve it directly for
    // the affected slice instead of exporting a second time.
    run(['test', ...result.specs], { ...process.env, E2E_SKIP_BUILD: '1' });
  }
}
