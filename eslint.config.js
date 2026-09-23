// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-e2e/*'],
  },
  {
    rules: {
      // Added by eslint-config-expo 57 (react-hooks v6). The existing
      // provider/components predate these rules; keep them visible as
      // warnings until the hooks are refactored.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
