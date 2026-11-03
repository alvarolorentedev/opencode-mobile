'use dom';

import { useEffect, useRef, useState } from 'react';
import type { DOMProps } from 'expo/dom';
import type { PluginGuiHostProps } from '@/features/extensions/model/plugin-gui';
import { createPluginHost } from '@/features/extensions/ui/plugin-gui-runtime';

type Props = PluginGuiHostProps & { dom?: DOMProps };

export default function PluginGuiDom(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const [error, setError] = useState<string>();

  useEffect(() => {
    callbacks.current = props;
  }, [props]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let live = true;
    let created: ReturnType<typeof createPluginHost> | undefined;

    try {
      created = createPluginHost({
        ...callbacks.current,
        container,
        onReady: async (title) => {
          if (live) await callbacks.current.onReady(title);
        },
        onError: async (message) => {
          if (!live) return;
          setError(message);
          await callbacks.current.onError(message);
        },
        onEmpty: async () => {
          if (live) await callbacks.current.onEmpty();
        },
        onPanels: async (panels) => {
          if (live) await callbacks.current.onPanels(panels);
        },
        onClose: async () => {
          if (live) await callbacks.current.onClose();
        },
        onOpenSession: async (sessionID) => {
          if (live) await callbacks.current.onOpenSession(sessionID);
        },
        onOpenExternal: async (url) => {
          if (live) await callbacks.current.onOpenExternal(url);
        },
        onRpc: (request) => callbacks.current.onRpc(request),
        onSessionGet: (request) => callbacks.current.onSessionGet(request),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      queueMicrotask(() => setError(message));
      void callbacks.current.onError(message);
    }

    return () => {
      live = false;
      created?.dispose();
    };
  }, [props.code, props.pluginId, props.panelId, props.session.id, props.session.directory, props.theme.mode, props.theme.background, props.theme.tint, props.locale]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: props.theme.background,
        color: props.theme.foreground,
      }}
    >
      <div ref={host} style={{ width: '100%', height: '100%' }} />
      {error ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px 12px',
            background: props.theme.surface,
            borderTop: `1px solid ${props.theme.border}`,
            color: props.theme.foreground,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
