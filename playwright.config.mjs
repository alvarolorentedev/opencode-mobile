import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  // The fake server keeps one global scenario; multiple workers would reset it
  // out from under other spec files (see /__control/reset in server.mjs).
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:19006',
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
      url: 'http://127.0.0.1:44096/api/info',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
        FAKE_OPENCODE_PORT: '44096',
      },
    },
    {
      command: 'node ./tests/fake-opencode/server-v1.mjs',
      url: 'http://127.0.0.1:44097/path',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...process.env, FAKE_OPENCODE_PORT: '44097' },
    },
    {
      command: 'npm run serve:web:ci',
      url: 'http://127.0.0.1:19006',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_E2E_MODE: '1',
        EXPO_APP_VARIANT: 'development',
        EXPO_PUBLIC_E2E_SERVER_URL: 'http://127.0.0.1:44096',
      },
    },
  ],
});
