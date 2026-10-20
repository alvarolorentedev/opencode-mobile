// Single static-test entrypoint for the `validate` CI gate.
//
// Historically `test:ci:static` was a long `&&` chain in package.json that ran
// lint, type-checking, the Vitest suites and one Node script per legacy suite.
// The legacy suites now live in `tests/vitest/`, so this runner replaces the
// chain with an ordered list and reports which step failed.
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
  { name: 'lint', entry: 'node_modules/eslint/bin/eslint.js', args: ['.'] },
  { name: 'typecheck', entry: 'node_modules/typescript/bin/tsc', args: ['--noEmit'] },
  { name: 'typecheck:tests', entry: 'node_modules/typescript/bin/tsc', args: ['-p', 'tsconfig.tests.json'] },
  { name: 'vitest', entry: 'node_modules/vitest/vitest.mjs', args: ['run'] },
];

function run({ name, entry, args }) {
  const absolute = path.join(root, entry);
  if (!existsSync(absolute)) {
    throw new Error(`[static] ${name}: missing entrypoint ${entry}. Run \`npm install\`.`);
  }

  console.log(`\n[static] ${name}: node ${entry} ${args.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [absolute, ...args], { cwd: root, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

for (const step of steps) {
  const code = await run(step);
  if (code !== 0) {
    console.error(`\n[static] FAILED at "${step.name}" (exit ${code}).`);
    process.exit(code);
  }
}

console.log('\n[static] all static checks passed.');
