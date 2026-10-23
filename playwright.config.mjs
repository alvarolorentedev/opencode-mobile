import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Defaults match the documented fake-server ports. Local concurrent runs can
// override them through `npm run test:e2e:web:isolated`, which allocates a
// fresh set; CI keeps the defaults because each shard has its own runner.
const fakeV2Port = Number(process.env.E2E_FAKE_V2_PORT || 44096);
const fakeV1Port = Number(process.env.E2E_FAKE_V1_PORT || 44097);
const webPort = Number(process.env.E2E_WEB_PORT || 19006);
const fakeV2Url = `http://127.0.0.1:${fakeV2Port}`;
const fakeV1Url = `http://127.0.0.1:${fakeV1Port}`;
const skipBuild = process.env.E2E_SKIP_BUILD === '1';
const serveCommand = `node ./node_modules/serve/build/main.js -s dist-e2e -l ${webPort}`;
const buildMarker = './dist-e2e/.e2e-server-url';

if (skipBuild && existsSync(buildMarker) && readFileSync(buildMarker, 'utf8').trim() !== fakeV2Url) {
  throw new Error(`E2E_SKIP_BUILD=1 but dist-e2e was built for ${readFileSync(buildMarker, 'utf8').trim()}, not ${fakeV2Url}. Rebuild with npm run build:web:e2e.`);
}

// Test files read these instead of hard-coding ports, so an isolated run uses
// the same backend that the web export was built against.
process.env.E2E_FAKE_V2_URL = fakeV2Url;
process.env.E2E_FAKE_V1_URL = fakeV1Url;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // CI splits the suite with `--shard`. Parallel scheduling lets Playwright
  // divide individual tests evenly; with `workers: 1` a shard still runs one
  // test at a time, so the fake server's global scenario is never shared.
  fullyParallel: true,
  // The fake server keeps one global scenario; multiple workers would reset it
  // out from under other spec files (see /__control/reset in server.mjs).
  // CI shards provide parallelism with one worker per isolated runner.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
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
    {
      command: 'node ./tests/fake-opencode/server.mjs',
      url: `${fakeV2Url}/api/info`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
        FAKE_OPENCODE_PORT: String(fakeV2Port),
      },
    },
    {
      command: 'node ./tests/fake-opencode/server-v1.mjs',
      url: `${fakeV1Url}/path`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...process.env, FAKE_OPENCODE_PORT: String(fakeV1Port) },
    },
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
        EXPO_PUBLIC_E2E_SERVER_URL: fakeV2Url,
      },
    },
  ],
});
