import { defineConfig, devices } from '@playwright/test';

import { getWorkerCount, workerBackend } from './tests/e2e/helpers/backend.mjs';

// One shared web export serves every worker; each worker gets its own fake
// V1/V2 pair. The Playwright fixture selects the worker's URL at runtime, so
// the export no longer bakes a server address.
const workerCount = getWorkerCount();
const webPort = Number(process.env.E2E_WEB_PORT || 19006);
const skipBuild = process.env.E2E_SKIP_BUILD === '1';
const serveCommand = `node ./node_modules/serve/build/main.js -s dist-e2e -l ${webPort}`;

const fakeServers = Array.from({ length: workerCount }, (_, index) => {
  const backend = workerBackend(index);
  return [
    {
      command: 'node ./tests/fake-opencode/server.mjs',
      url: `${backend.v2}/api/info`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
        FAKE_OPENCODE_PORT: String(backend.v2Port),
      },
    },
    {
      command: 'node ./tests/fake-opencode/server-v1.mjs',
      url: `${backend.v1}/path`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...process.env, FAKE_OPENCODE_PORT: String(backend.v1Port) },
    },
  ];
}).flat();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: workerCount,
  // A committed .only would silently shrink the gate. Retries stay at zero:
  // flaky tests must be fixed, not hidden.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: [
    ...fakeServers,
    {
      command: skipBuild ? serveCommand : `npm run build:web:ci && ${serveCommand}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_E2E_MODE: '1',
        EXPO_APP_VARIANT: 'development',
      },
    },
  ],
});
