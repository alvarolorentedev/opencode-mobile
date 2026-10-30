#!/usr/bin/env node
// Select the E2E slice for a change. The full suite remains the default for
// shared contracts, unknown paths, tags, and manual dispatches.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { classifyValidation } from './validation-map.mjs';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || '';
}

function changedFiles(base, head) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', `${base}...${head}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

const event = arg('event', 'pull_request');
const base = arg('base');
const head = arg('head', 'HEAD');
const explicitFiles = arg('files');
const files = explicitFiles
  ? explicitFiles.split(',').map((file) => file.trim()).filter(Boolean)
  : changedFiles(base, head);
const result = files
  ? classifyValidation(files, { event })
  : { mode: 'full', specs: [], storybook: true, reason: 'changed-file diff unavailable' };

const specList = result.specs.join(' ');
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result));
} else {
  console.log(`[select-validation] mode=${result.mode} storybook=${result.storybook} reason=${result.reason}`);
  if (specList) console.log(`[select-validation] specs=${specList}`);
}

if (process.argv.includes('--github-output')) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('--github-output requires GITHUB_OUTPUT');
  appendFileSync(output, [
    `e2e_mode=${result.mode}`,
    `e2e_specs=${specList}`,
    `storybook=${result.storybook}`,
    `reason=${result.reason.replace(/\n/g, ' ')}`,
    '',
  ].join('\n'));
}

if (process.argv.includes('--print-command')) {
  if (result.mode === 'none') console.log('E2E: no Playwright run');
  else if (result.mode === 'smoke') console.log('npx playwright test --grep @smoke');
  else if (result.mode === 'full') console.log('npx playwright test');
  else console.log(`npx playwright test ${specList}`);
}
