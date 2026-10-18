import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

// Standard TS test runner for modules that were previously loaded through the
// bespoke data-URL loader. Real `@/` imports resolve natively; platform and
// protocol modules are replaced with `vi.mock` per suite.
export default defineConfig({
  test: {
    include: ['tests/vitest/**/*.test.ts'],
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
