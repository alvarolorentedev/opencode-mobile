// Build the web export that the local prebuilt-server flow serves.
//
// Playwright normally builds with the fake-server URL in its webServer env.
// This script makes the same build reproducible when the export is built ahead
// of time, so `serve:web:prebuilt` and the default ports point at the same V2
// server the tests reset.
//
// The public E2E server URL is inlined by Metro, and Metro's cache does not
// always invalidate when EXPO_PUBLIC_* changes. A marker in dist-e2e forces a
// clean rebuild when the port changes; ordinary source edits stay incremental.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeV2Port = process.env.E2E_FAKE_V2_PORT || '44096';
const serverUrl = `http://127.0.0.1:${fakeV2Port}`;
const marker = path.join(root, 'dist-e2e', '.e2e-server-url');
const previousUrl = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
const args = ['export', '--platform', 'web', '--output-dir', 'dist-e2e'];
if (process.env.E2E_CLEAR === '1' || previousUrl !== serverUrl) args.push('--clear');

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'expo', 'bin', 'cli'), ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_PUBLIC_E2E_MODE: '1',
    EXPO_APP_VARIANT: 'development',
    EXPO_PUBLIC_E2E_SERVER_URL: serverUrl,
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
  if (code === 0) writeFileSync(marker, `${serverUrl}\n`);
  process.exit(code ?? 1);
});
