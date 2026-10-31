import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { uniwind } from 'uniwind/vite';
import { transformWithOxc } from 'vite';
import pkg from '../package.json' with { type: 'json' };
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
    // RN Primitives publish JSX in .js/.mjs; Vite otherwise parses these as JS.
    viteConfig.plugins ??= [];
    viteConfig.plugins.push({
      name: 'rn-primitives-jsx', enforce: 'pre',
      transform(code, id) {
        if (/node_modules\/@rn-primitives\/.*\.[cm]?js$/.test(id)) return transformWithOxc(code, id, { lang: 'tsx', jsx: { runtime: 'automatic' } });
      },
    });
    viteConfig.optimizeDeps ??= {};
    viteConfig.optimizeDeps.exclude = [...(viteConfig.optimizeDeps.exclude ?? []), ...Object.keys(pkg.dependencies).filter((name) => name.startsWith('@rn-primitives/'))];
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss(), uniwind({ cssEntryFile: './global.css', dtsFile: './uniwind-types.d.ts' })];
    viteConfig.resolve ??= {};
    const existing = viteConfig.resolve.alias;
    const aliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
    viteConfig.resolve.alias = [
      { find: /^react-native$/, replacement: 'react-native-web' },
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
      '.web.mjs',
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
