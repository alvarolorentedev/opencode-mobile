import { MOBILE_GUI_API } from '@/features/extensions/model/plugin-gui';

export type PluginBundle = {
  setup?: (ctx: never) => void | (() => void);
  main?: unknown;
  os?: string[];
  stores?: Record<string, unknown>;
  i18n?: Record<string, Record<string, string>>;
  api?: number;
};

/**
 * Evaluates one prebuilt CommonJS GUI bundle. This is a small, deliberate
 * reimplementation of the upstream loader: the published SDK does not export
 * its host entrypoint yet.
 */
export function evaluatePluginBundle(code: string, requireModule: (name: string) => unknown): PluginBundle {
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(requireModule, module, module.exports);

  const value = (module.exports as { default?: unknown }).default ?? module.exports;
  if (!value || typeof value !== 'object') {
    throw new Error('A plugin GUI bundle must export a Plugin.define object.');
  }

  const plugin = value as PluginBundle;
  if (typeof plugin.setup !== 'function' && !plugin.main) {
    throw new Error('A plugin GUI must have a window setup, a main setup, or both.');
  }
  if (plugin.api !== undefined) {
    if (!Number.isInteger(plugin.api) || plugin.api < 1) {
      throw new Error('A plugin GUI declared an invalid API version.');
    }
    if (plugin.api > MOBILE_GUI_API) {
      throw new Error(`This plugin requires GUI API ${plugin.api}; this app supports ${MOBILE_GUI_API}.`);
    }
  }

  return plugin;
}
