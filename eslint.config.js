// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['**/._*', 'android/**', 'ios/**', 'modules/*/android/build/**', 'dist/*', 'dist-e2e/*', 'output/**', '.expo/*', 'test-results/**', 'playwright-report/**', 'storybook-static/**', '.eslintcache'],
  },
  {
    // These provider-owned state machines reconcile external events into state.
    files: ['features/voice/state/use-conversation-state.ts', 'runtime/realtime/use-opencode-realtime.ts'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]);
