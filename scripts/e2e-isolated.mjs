// Run Playwright on a fresh port block so concurrent local runs (or a stale
// server from another checkout) cannot share the default fake backends.
//
// One shared web export is served on E2E_WEB_PORT; each worker gets a
// contiguous V2/V1 port pair starting at E2E_FAKE_PORT_BASE.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getWorkerCount } from '../tests/e2e/helpers/backend.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerCount = getWorkerCount();
const fakePortCount = workerCount * 2;

if (process.env.E2E_SKIP_BUILD === '1' && !existsSync(path.join(root, 'dist-e2e', 'index.html'))) {
  console.error('[e2e] E2E_SKIP_BUILD=1 but dist-e2e/index.html is missing. Run `npm run build:web:e2e` first.');
  process.exit(1);
}

async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function allocateFakeBlock(size) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const base = 40000 + Math.floor(Math.random() * 12000);
    const probes = [];
    try {
      for (let offset = 0; offset < size; offset += 1) {
        const probe = net.createServer();
        try {
          await new Promise((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(base + offset, '127.0.0.1', resolve);
          });
        } catch (error) {
          await new Promise((resolve) => probe.close(resolve));
          throw error;
        }
        probes.push(probe);
      }
      await Promise.all(probes.map((probe) => new Promise((resolve) => probe.close(resolve))));
      return base;
    } catch {
      await Promise.all(probes.map((probe) => new Promise((resolve) => probe.close(resolve))));
    }
  }
  throw new Error(`[e2e] could not allocate ${size} contiguous fake-server ports.`);
}

const fakePortBase = await allocateFakeBlock(fakePortCount);
let webPort = await allocatePort();
while (webPort >= fakePortBase && webPort < fakePortBase + fakePortCount) {
  webPort = await allocatePort();
}
console.log(`[e2e] web=${webPort} fake-base=${fakePortBase} workers=${workerCount}`);

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_WEB_PORT: String(webPort),
      E2E_FAKE_PORT_BASE: String(fakePortBase),
      E2E_WORKERS: String(workerCount),
    },
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
