import { withAlpha } from '@/lib/color';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';

import { useTerminal } from '@/providers/opencode-contexts';
import TerminalDOM, { type TerminalDOMRef } from './terminal-dom';
import { pasteNeedsConfirmation } from './terminal-keys';

export function TerminalView({ visible, slim, palette, onError }: {
  visible: boolean; slim: boolean;
  palette: { background: string; text: string; tint: string; surface: string };
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { terminalRuntime, activeTerminalId, sendTerminalInput } = useTerminal();
  const bridge = useRef<TerminalDOMRef>(null);
  const runtime = useRef(terminalRuntime);
  const registrations = useRef(new Map<string, () => void>());
  const sequence = useRef(0);
  const pending = useRef(new Map<number, { id: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => { runtime.current = terminalRuntime; }, [terminalRuntime]);

  const cancelWrites = useCallback((id?: string) => {
    for (const [key, write] of pending.current) if (!id || write.id === id) {
      clearTimeout(write.timer); write.reject(new Error('Terminal renderer was replaced.')); pending.current.delete(key);
    }
  }, []);
  const onReady = useCallback(async (id: string) => {
    registrations.current.get(id)?.(); cancelWrites(id);
    registrations.current.set(id, runtime.current.registerRenderer(id, {
      write: (text) => new Promise<void>((resolve, reject) => {
        const acknowledgement = ++sequence.current;
        const timer = setTimeout(() => { pending.current.delete(acknowledgement); reject(new Error('Terminal renderer did not acknowledge output. Reconnect to retry.')); }, 15000);
        pending.current.set(acknowledgement, { id, resolve, reject, timer });
        bridge.current?.write(id, text, acknowledgement);
      }),
    }));
  }, [cancelWrites]);
  const onWritten = useCallback(async (id: string, acknowledgement: number) => {
    const write = pending.current.get(acknowledgement);
    if (!write || write.id !== id) return;
    clearTimeout(write.timer); pending.current.delete(acknowledgement); write.resolve();
  }, []);
  const onResize = useCallback(async (id: string, cols: number, rows: number) => { runtime.current.resize(id, cols, rows); }, []);
  const onInput = useCallback(async (id: string, text: string, generation: number) => { sendTerminalInput(id, text, generation, terminalRuntime.scope); }, [sendTerminalInput, terminalRuntime.scope]);
  const onCopy = useCallback(async (text: string) => { try { await Clipboard.setStringAsync(text); } catch (error) { onError(String(error)); } }, [onError]);
  const reportError = useCallback(async (message: string) => { onError(message); }, [onError]);
  const onPaste = useCallback(async (id: string, supplied?: string) => {
    try {
      const text = supplied ?? await Clipboard.getStringAsync();
      if (!text) return;
      const paste = () => { if (runtime.current.instances.some((entry) => entry.id === id && entry.status === 'connected')) bridge.current?.paste(id, text); };
      if (!pasteNeedsConfirmation(text)) { paste(); return; }
      if (Platform.OS === 'web') { if (globalThis.confirm(t('terminal:console.pasteMessage'))) paste(); }
      else Alert.alert(t('terminal:console.pasteTitle'), t('terminal:console.pasteMessage'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('terminal:accessory.paste'), onPress: paste },
      ]);
    } catch (error) { onError(String(error)); }
  }, [onError, t]);

  useEffect(() => {
    const ids = new Set(terminalRuntime.instances.map((entry) => entry.id));
    for (const [id, cleanup] of registrations.current) if (!ids.has(id)) { cleanup(); registrations.current.delete(id); cancelWrites(id); }
  }, [terminalRuntime.instances, cancelWrites]);
  useEffect(() => {
    const owned = registrations.current;
    return () => { for (const cleanup of owned.values()) cleanup(); owned.clear(); cancelWrites(); };
  }, [cancelWrites]);
  const theme = useMemo(() => ({ background: palette.background, foreground: palette.text, cursor: palette.tint, selectionBackground: withAlpha(palette.tint, 0x55 / 255) }), [palette.background, palette.text, palette.tint]);
  const labels = useMemo(() => ({
    paste: t('terminal:accessory.paste'), copy: t('terminal:accessory.copy'), latest: t('terminal:accessory.latest'),
    input: t('terminal:accessory.input'), more: t('terminal:accessory.more'),
    armed: t('terminal:accessory.armed'), locked: t('terminal:accessory.locked'), off: t('terminal:accessory.off'),
  }), [t]);

  return <TerminalDOM ref={bridge} instances={terminalRuntime.instances} activeId={activeTerminalId} visible={visible} slim={slim} theme={theme} accent={palette.tint} onAccent={palette.background} labels={labels}
    dom={{ style: { flex: 1 }, scrollEnabled: false, keyboardDisplayRequiresUserAction: true, automaticallyAdjustContentInsets: false }}
    onReady={onReady} onWritten={onWritten} onInput={onInput} onResize={onResize} onPaste={onPaste} onCopy={onCopy} onError={reportError} />;
}
