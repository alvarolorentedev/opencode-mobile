import { describe, expect, it } from 'vitest';
import { evaluatePluginBundle } from '@/features/extensions/ui/plugin-gui-loader';

const requireNothing = (name: string) => {
  throw new Error(`unknown module ${name}`);
};

describe('plugin GUI bundle loader', () => {
  it('reads a CommonJS default export and its declarations', () => {
    const plugin = evaluatePluginBundle(
      'module.exports.default = { api: 1, i18n: { en: { hello: "Hello" } }, setup() {} };',
      requireNothing,
    );
    expect(plugin.api).toBe(1);
    expect(plugin.i18n?.en.hello).toBe('Hello');
  });

  it('accepts a module.exports default and a main-only plugin', () => {
    const plugin = evaluatePluginBundle('module.exports = { main() {} };', requireNothing);
    expect(typeof plugin.main).toBe('function');
  });

  it('rejects a plugin with no setup', () => {
    expect(() => evaluatePluginBundle('module.exports = { i18n: {} };', requireNothing)).toThrow(/setup/);
  });

  it('rejects a plugin that targets a newer host API', () => {
    expect(() => evaluatePluginBundle('module.exports = { api: 99, setup() {} };', requireNothing)).toThrow(/GUI API/);
  });

  it('propagates an unknown module from the require map', () => {
    expect(() =>
      evaluatePluginBundle('require("unknown-module"); module.exports = { setup() {} };', requireNothing),
    ).toThrow(/unknown-module/);
  });
});
