// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-e2e/*', '.expo/*'],
  },
  {
    // The provider deliberately mirrors frequently-changing state into refs
    // (latest-ref pattern) so realtime callbacks never capture stale closures.
    // React Compiler cannot verify that pattern; migrate it in a dedicated,
    // well-tested change rather than under a dependency bump.
    files: ['providers/opencode-provider.tsx'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
