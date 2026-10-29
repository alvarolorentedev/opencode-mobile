import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const root = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    '../components/**/*.stories.@(ts|tsx)',
    './stories/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {};
    const existing = viteConfig.resolve.alias;
    const aliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
    viteConfig.resolve.alias = [
      { find: /^react-native$/, replacement: path.resolve(root, 'stubs/react-native.ts') },
      { find: /^@expo\/vector-icons\/MaterialCommunityIcons$/, replacement: path.resolve(root, 'stubs/vector-icons.tsx') },
      { find: /^@expo\/vector-icons$/, replacement: path.resolve(root, 'stubs/vector-icons.tsx') },
      { find: /^@\//, replacement: `${path.resolve(root, '..')}/` },
      ...aliases,
    ];
    viteConfig.resolve.dedupe = ['react', 'react-dom', 'react-native-web'];
    viteConfig.resolve.extensions = [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      ...(viteConfig.resolve.extensions ?? []),
    ];
    viteConfig.define = {
      ...viteConfig.define,
      __DEV__: JSON.stringify(true),
      global: 'globalThis',
    };
    return viteConfig;
  },
};

export default config;
