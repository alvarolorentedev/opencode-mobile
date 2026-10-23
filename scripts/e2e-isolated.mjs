// Run Playwright on a fresh set of ports so concurrent local runs (or a stale
// server from another checkout) cannot share the default fake backend.
//
// The Playwright config reads E2E_WEB_PORT / E2E_FAKE_V2_PORT /
// E2E_FAKE_V1_PORT. Ports are allocated while the probe servers are still
// listening, so the three values are guaranteed to be distinct.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.E2E_SKIP_BUILD === '1') {
  console.error('[e2e] E2E_SKIP_BUILD cannot be combined with isolated ports: the export bakes E2E_FAKE_V2_PORT. Use serve:web:prebuilt with the default ports.');
  process.exit(1);
}

async function allocatePorts(count) {
  const probes = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const probe = net.createServer();
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
      });
      probes.push(probe);
    }
    return probes.map((probe) => probe.address().port);
  } finally {
    await Promise.all(probes.map((probe) => new Promise((resolve) => probe.close(resolve))));
  }
}

const [webPort, fakeV2Port, fakeV1Port] = await allocatePorts(3);
console.log(`[e2e] web=${webPort} fake-v2=${fakeV2Port} fake-v1=${fakeV1Port}`);

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_WEB_PORT: String(webPort),
      E2E_FAKE_V2_PORT: String(fakeV2Port),
      E2E_FAKE_V1_PORT: String(fakeV1Port),
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
