#!/usr/bin/env node
// Keep E2E growth deliberate. Extending an existing spec is preferred; adding
// a test or spec requires updating tests/e2e/budget.json in the same review.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const budget = JSON.parse(readFileSync(path.join(root, 'tests/e2e/budget.json'), 'utf8'));
const specs = readdirSync(path.join(root, 'tests/e2e')).filter((file) => file.endsWith('.spec.mjs')).length;

let listed;
try {
  listed = execFileSync(process.execPath, [
    path.join(root, 'node_modules/@playwright/test/cli.js'),
    'test',
    '--list',
    '--reporter=json',
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  console.error(error.stdout || error.message);
  process.exit(1);
}

const json = listed.slice(listed.indexOf('{'));
const report = JSON.parse(json);
function countSpecs(suites) {
  return (suites || []).reduce((total, suite) => (
    total + (suite.specs?.length || 0) + countSpecs(suite.suites)
  ), 0);
}
const tests = countSpecs(report.suites);

console.log(`[e2e-budget] tests=${tests} (budget ${budget.tests}); specs=${specs} (budget ${budget.specs})`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `E2E budget: ${tests}/${budget.tests} tests, ${specs}/${budget.specs} specs\n`);
}
if (tests > budget.tests) {
  console.error(`E2E test count grew from ${budget.tests} to ${tests}. Extend an existing scenario or raise tests/e2e/budget.json with a justification.`);
  process.exit(1);
}
if (specs > budget.specs) {
  console.error(`E2E spec files grew from ${budget.specs} to ${specs}. Extend an existing spec instead of adding a file.`);
  process.exit(1);
}
