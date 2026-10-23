// Build one URL-agnostic E2E export. The Playwright fixture selects the
// worker's fake-server URL at runtime, so the same dist works for any worker
// count or local isolated run.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'dist-e2e', '.e2e-build');
const builtForE2E = existsSync(marker) && readFileSync(marker, 'utf8').trim() === 'e2e';
const args = ['export', '--platform', 'web', '--output-dir', 'dist-e2e'];
if (process.env.E2E_CLEAR === '1' || !builtForE2E) args.push('--clear');

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'expo', 'bin', 'cli'), ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_PUBLIC_E2E_MODE: '1',
    EXPO_APP_VARIANT: 'development',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code === 0) writeFileSync(marker, 'e2e\n');
  process.exit(code ?? 1);
});
