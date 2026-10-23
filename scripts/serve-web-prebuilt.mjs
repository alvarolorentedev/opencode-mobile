// Serve an existing `dist-e2e` export on the web E2E port without rebuilding.
//
// Start this in one terminal, then run a targeted Playwright command in
// another. Playwright's `reuseExistingServer` (enabled outside CI) detects the
// running server and skips the export.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.E2E_WEB_PORT || '19006';
const serve = path.join(root, 'node_modules', 'serve', 'build', 'main.js');
const marker = path.join(root, 'dist-e2e', '.e2e-build');

if (!existsSync(path.join(root, 'dist-e2e', 'index.html'))) {
  console.error('[e2e] dist-e2e/index.html is missing. Run `npm run build:web:e2e` first.');
  process.exit(1);
}

if (!existsSync(marker)) {
  console.warn('[e2e] dist-e2e was not produced by build:web:e2e; rebuild it if tests connect to 127.0.0.1:4096.');
}

const child = spawn(process.execPath, [serve, '-s', 'dist-e2e', '-l', port], {
  cwd: root,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
