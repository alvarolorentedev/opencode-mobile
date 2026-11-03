import { createComponent, createRoot, ErrorBoundary, getOwner, runWithOwner } from 'solid-js';
import { render } from 'solid-js/web';
import type { PluginGuiHostProps, PluginGuiTheme } from '@/features/extensions/model/plugin-gui';
import { createPluginContext, type PanelContribution } from '@/features/extensions/ui/plugin-gui-context';
import { createPluginRequire } from '@/features/extensions/ui/plugin-gui-modules';
import { evaluatePluginBundle } from '@/features/extensions/ui/plugin-gui-loader';
import { PanelContext, PluginContext } from '@/features/extensions/ui/plugin-gui-sdk';

const hostCss = (theme: PluginGuiTheme) => `
:host {
  --background: ${theme.background};
  --foreground: ${theme.foreground};
  --border: ${theme.border};
  --primary: ${theme.tint};
  --surface: ${theme.surface};
  color: ${theme.foreground};
  background: ${theme.background};
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.45;
}
* { box-sizing: border-box; }
button, input { font: inherit; }
.plugin-root { height: 100%; width: 100%; overflow: auto; }
`;

export type PluginHost = {
  title: string;
  panels: { id: string; title: string }[];
  rpcIds: string[];
  dispose(): void;
};

const guarded = Symbol.for('opencode.plugin.network-guard');

// shortcut: best-effort network blocking inside the plugin WebView. A full
// sandbox needs a nested iframe with CSP; upgrade when the bridge moves there.
function guardNetwork() {
  const target = window as typeof window & { [guarded]?: boolean; ReactNativeWebView?: unknown };
  if (target[guarded] || !target.ReactNativeWebView) return;
  target[guarded] = true;
  const blocked = () => Promise.reject(new Error('Plugin network access is disabled; use the host bridge.'));
  window.fetch = blocked as typeof fetch;
  navigator.sendBeacon = (() => false) as typeof navigator.sendBeacon;
  window.open = (() => null) as typeof window.open;
  window.WebSocket = class extends EventTarget {
    constructor() {
      super();
      throw new Error('Plugin network access is disabled; use the host bridge.');
    }
  } as unknown as typeof WebSocket;
  window.EventSource = class extends EventTarget {
    constructor() {
      super();
      throw new Error('Plugin network access is disabled; use the host bridge.');
    }
  } as unknown as typeof EventSource;
  XMLHttpRequest.prototype.open = function blockedRequest() {
    throw new Error('Plugin network access is disabled; use the host bridge.');
  } as typeof XMLHttpRequest.prototype.open;
}

/**
 * Loads one plugin bundle into a shadow root and mounts its first panel. The
 * bundle runs in the WebView realm; no native module or credential is exposed.
 */
export function createPluginHost(input: PluginGuiHostProps & { container: HTMLElement }): PluginHost {
  guardNetwork();
  const shadow = input.container.shadowRoot ?? input.container.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style');
  style.textContent = hostCss(input.theme);
  shadow.appendChild(style);
  const mount = document.createElement('div');
  mount.className = 'plugin-root';
  shadow.appendChild(mount);

  const abort = new AbortController();
  let definition;
  try {
    definition = evaluatePluginBundle(input.code, createPluginRequire());
  } catch (cause) {
    shadow.replaceChildren();
    throw cause;
  }

  const context = createPluginContext({
    definition,
    pluginId: input.pluginId,
    options: input.options,
    session: input.session,
    server: input.server,
    bridge: {
      openSession: (sessionID) => void input.onOpenSession(sessionID),
      openExternal: (url) => void input.onOpenExternal(url),
      rpc: input.onRpc,
      sessionGet: input.onSessionGet,
      closePanel: () => void input.onClose(),
    },
    theme: input.theme,
    locale: input.locale,
    appVersion: input.appVersion,
    signal: abort.signal,
    root: shadow,
  });

  const session = context.ctx.sessions.current();

  let setupCleanup: (() => void) | undefined;
  let setupError: unknown;
  const rootDispose = createRoot((dispose) => {
    const owner = getOwner();
    if (owner) owner.context = { ...owner.context, [PluginContext.id]: context.ctx };
    try {
      runWithOwner(owner, () => {
        const cleanup = definition.setup?.(context.ctx as never);
        if (typeof cleanup === 'function') setupCleanup = cleanup;
      });
    } catch (cause) {
      setupError = cause;
    }
    return dispose;
  });

  const fail = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    void input.onError(message);
  };

  if (setupError) fail(setupError);

  style.textContent = `${hostCss(input.theme)}\n${context.styles.join('\n')}`;

  const panels = context.panels
    .filter((candidate) => typeof candidate.render === 'function')
    .map((candidate) => ({ id: candidate.id, title: candidate.mobile?.title ?? candidate.id }));
  void input.onPanels(panels);
  const panel = context.panels.find((candidate) => candidate.id === input.panelId) ?? context.panels.find((candidate) => typeof candidate.render === 'function');
  if (!panel) {
    void input.onEmpty();
    return { title: input.label, panels, rpcIds: [...context.rpcIds], dispose: () => {
      abort.abort();
      setupCleanup?.();
      rootDispose();
      context.dispose();
      shadow.replaceChildren();
    } };
  }

  const open = [panel.id];
  const screen = {};
  const tabs = readTabs(panel, session, screen, open) as { id: string; title?: unknown }[];
  const tab = tabs[0] ?? { id: panel.id, title: panel.id };
  const title = panel.mobile?.title ?? (typeof tab.title === 'string' ? tab.title : input.label);

  const panelFrame = {
    visible: () => true,
    present: () => true,
    placement: () => 'mobile' as const,
    reserve: () => false,
    animate: () => true,
    open: () => open,
    sidebar: {
      opened: () => true,
      width: () => 320,
      transition: () => false,
      resize: () => {},
      toggle: () => {},
    },
  };

  const tree = () =>
    createComponent(PluginContext.Provider, {
      value: context.ctx,
      get children() {
        return createComponent(PanelContext.Provider, {
          value: panelFrame,
          get children() {
            return panel.render({ tab, session, screen }) as never;
          },
        });
      },
    });

  const disposeRender = render(
    () =>
      createComponent(ErrorBoundary, {
        fallback: (error: unknown) => {
          fail(error);
          const element = document.createElement('div');
          element.textContent = error instanceof Error ? error.message : String(error);
          Object.assign(element.style, { padding: '16px', color: input.theme.foreground, opacity: '0.8' });
          return element;
        },
        get children() {
          return tree();
        },
      }),
    mount,
  );

  void input.onReady(title);

  return {
    title,
    panels,
    rpcIds: [...context.rpcIds],
    dispose() {
      abort.abort();
      setupCleanup?.();
      disposeRender();
      rootDispose();
      context.dispose();
      shadow.replaceChildren();
    },
  };
}

function readTabs(panel: PanelContribution, session: unknown, screen: unknown, open: string[]) {
  try {
    return panel.list?.({ session, screen, open }) ?? [{ id: panel.id, title: panel.id }];
  } catch {
    return [{ id: panel.id, title: panel.id }];
  }
}
