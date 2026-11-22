import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

// Real application imports share one resolver across unit and integration tests.
export default defineConfig({
  test: {
    include: ['tests/vitest/**/*.test.{ts,tsx}', 'features/**/__tests__/**/*.test.{ts,tsx}', 'shared/**/__tests__/**/*.test.{ts,tsx}', 'runtime/**/__tests__/**/*.test.{ts,tsx}',
      'tests/integration/core-harness.test.tsx',
      ...(process.env.OPENCODE_REAL_SERVER_TEST === '1' ? ['tests/integration/server-plugin-commands.test.ts'] : [])],
    exclude: [...configDefaults.exclude, '**/._*'],
    environment: 'node',
    globals: false,
    // Suites ported from the standalone Node scripts drive whole provider
    // orchestration flows (connect recovery, prompt lifecycle). They run in
    // milliseconds alone but can exceed the 5s default under parallel load.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': root,
    },
  },
});
