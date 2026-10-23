// Single static-test entrypoint for the `validate` CI gate.
//
// Historically `test:ci:static` was a long `&&` chain in package.json that ran
// lint, type-checking, the Vitest suites and one Node script per legacy suite.
// The legacy suites now live in `tests/vitest/`, so this runner replaces the
// chain with an ordered list and reports which step failed.
//
// The steps are independent, so they run concurrently. Output is buffered per
// step to keep the four logs readable. ESLint and TypeScript keep on-disk
// caches: a warm static run is a few seconds instead of a minute.
//
// It resolves tool entrypoints directly instead of `node_modules/.bin/*` so it
// works regardless of how the package manager linked binaries on the host.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ name: string, entry: string, args: string[] }[]} */
const steps = [
  {
    name: 'lint',
    entry: 'node_modules/eslint/bin/eslint.js',
    args: ['.', '--cache', '--cache-strategy', 'content'],
  },
  {
    name: 'typecheck',
    entry: 'node_modules/typescript/bin/tsc',
    args: ['--noEmit', '--incremental', '--tsBuildInfoFile', 'tsconfig.app.tsbuildinfo'],
  },
  {
    name: 'typecheck:tests',
    entry: 'node_modules/typescript/bin/tsc',
    args: ['-p', 'tsconfig.tests.json', '--incremental', '--tsBuildInfoFile', 'tsconfig.tests.tsbuildinfo'],
  },
  { name: 'vitest', entry: 'node_modules/vitest/vitest.mjs', args: ['run'] },
];

function run({ name, entry, args }) {
  const absolute = path.join(root, entry);
  if (!existsSync(absolute)) {
    throw new Error(`[static] ${name}: missing entrypoint ${entry}. Run \`npm install\`.`);
  }

  console.log(`\n[static] ${name}: node ${entry} ${args.join(' ')}`);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [absolute, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      console.log(`[static] ${name}: ${code === 0 ? 'ok' : 'failed'} (${seconds}s)`);
      resolve({ name, code });
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      stderr += `${error.message}\n`;
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

const results = await Promise.all(steps.map(run));
const failed = results.find((result) => result.code !== 0);
if (failed) {
  console.error(`\n[static] FAILED at "${failed.name}" (exit ${failed.code}).`);
  process.exit(failed.code);
}

console.log('\n[static] all static checks passed.');
