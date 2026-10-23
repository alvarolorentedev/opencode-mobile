import type { ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import { createTerminalOutputQueue } from '@/lib/opencode/terminal-stream';
import { createTerminalConnectToken, getTerminalWebSocketUrl, openTerminalWebSocket, resizeTerminal } from '@/providers/services/terminal-service';
import type { TerminalInstance, TerminalRenderer } from './terminal-types';

// The context accessor reads the current provider client/credentials on every
// use, so a retained PTY reconnects with rotated Cloud Link credentials instead
// of disposing its renderer and cursor.
export type TerminalConnectionContext = {
  client: ScopedOpencodeClient;
  current: boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  headers?: Record<string, string>;
};

export function createTerminalConnection({ id, context, publish }: {
  id: string;
  context: () => TerminalConnectionContext;
  publish: () => void;
}) {
  let state: TerminalInstance = { id, generation: 0, status: 'connecting' };
  let renderer: TerminalRenderer | undefined;
  let socket: WebSocket | undefined;
  let output: ReturnType<typeof createTerminalOutputQueue> | undefined;
  let cursor: number | undefined, generation = 0, attempt = 0;
  let stopped = false, foreground = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let size: { cols: number; rows: number } | undefined;
  let sentSize: string | undefined;
  let resizeRunning = false;

  function update(status: TerminalInstance['status'], error?: string) {
    state = { id, generation, status, ...(error ? { error } : {}) };
    publish();
  }
  function cancelRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  function disconnect() {
    generation++;
    const previous = socket;
    socket = undefined;
    previous?.close();
    cancelRetry();
  }
  function fail(error: unknown, retry: boolean) {
    if (stopped || !context().current) return;
    const message = error instanceof Error ? error.message : String(error);
    update(retry ? 'reconnecting' : 'error', message);
    if (retry && foreground && renderer && !retryTimer) {
      const base = [1000, 2000, 4000, 8000, 15000][Math.min(attempt++, 4)];
      // Full jitter keeps parallel PTYs from reconnecting in lockstep.
      const delay = Math.round(base / 2 + Math.random() * base / 2);
      retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, delay);
    }
  }
  async function sendSize() {
    if (!size || resizeRunning || stopped || !context().current || state.status !== 'connected') return;
    const requested = size, key = `${requested.cols}:${requested.rows}`;
    if (key === sentSize) return;
    resizeRunning = true;
    try {
      await resizeTerminal(context().client, id, requested);
      if (!stopped && context().current) sentSize = key;
    } catch (error) {
      if (!stopped && context().current) update(state.status, error instanceof Error ? error.message : 'Terminal resize failed.');
    } finally {
      resizeRunning = false;
      if (size !== requested) void sendSize();
    }
  }
  async function connect() {
    if (stopped || !foreground || !renderer || !context().current) return;
    disconnect();
    const turn = generation;
    const valid = () => !stopped && context().current && turn === generation;
    update(attempt ? 'reconnecting' : 'connecting');
    try {
      // A reconnect cannot overtake the last acknowledged renderer write.
      await output?.drain();
      if (!valid()) return;
      const token = await createTerminalConnectToken(context().client, id);
      if (!valid()) return;
      const current = context();
      const next = openTerminalWebSocket(getTerminalWebSocketUrl({ serverUrl: current.serverUrl, directory: current.directory }, id, {
        ticket: token.ticket, cursor: cursor === undefined ? undefined : String(cursor),
      }, current.serverContract), current.headers);
      socket = next;
      const sink = renderer;
      output = createTerminalOutputQueue({
        write: (text) => sink.write(text),
        onText: (length) => { if (cursor !== undefined) cursor += length; },
        onCursor: (value) => { cursor = value; },
        onError: (error) => {
          if (!valid()) return;
          disconnect();
          fail(error, false);
        },
      });
      next.onmessage = ({ data }) => { if (valid()) output?.push(data); };
      next.onopen = () => {
        if (!valid()) { next.close(); return; }
        attempt = 0;
        sentSize = undefined;
        update('connected');
        void sendSize();
      };
      next.onerror = () => {
        if (!valid()) return;
        disconnect();
        fail(new Error('Terminal connection failed.'), true);
      };
      next.onclose = (event) => {
        if (!valid()) return;
        socket = undefined;
        const permanent = [1000, 1008, 4001, 4003, 4401, 4403, 4404].includes(event.code);
        if (event.code === 1000) { stopped = true; update('exited'); }
        else fail(new Error(event.reason || 'Terminal connection closed.'), !permanent);
      };
    } catch (error) {
      if (!valid()) return;
      const status = (error as { status?: number })?.status;
      fail(error, ![401, 403, 404].includes(status || 0) && !/401|403|404|unauthorized|forbidden|not found/i.test(String(error)));
    }
  }
  return {
    get state() { return state; },
    register(next: TerminalRenderer) {
      disconnect();
      output?.stop();
      renderer = next;
      cursor = undefined;
      if (!stopped) { attempt = 0; void connect(); }
      return () => {
        if (renderer !== next) return;
        disconnect(); output?.stop(); renderer = undefined; cursor = undefined;
      };
    },
    reconnect() { if (!stopped) { attempt = 0; void connect(); } },
    send(input: string, expectedGeneration = generation) {
      if (expectedGeneration !== generation || stopped || !context().current || !foreground || !renderer || state.status !== 'connected' || socket?.readyState !== 1) throw new Error('Terminal is not connected.');
      socket.send(input);
    },
    resize(cols: number, rows: number) {
      if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols <= 0 || rows <= 0) return;
      size = { cols, rows };
      if (resizeTimer) clearTimeout(resizeTimer);
      if (!sentSize) void sendSize();
      else resizeTimer = setTimeout(() => { resizeTimer = undefined; void sendSize(); }, 100);
    },
    foreground(active: boolean) {
      if (foreground === active) return;
      foreground = active;
      if (active) { if (!stopped) { attempt = 0; void connect(); } }
      else { disconnect(); if (!stopped) update('idle'); }
    },
    exit() { stopped = true; disconnect(); void output?.drain(); update('exited'); },
    dispose() {
      stopped = true; disconnect(); output?.stop(); renderer = undefined;
      if (resizeTimer) clearTimeout(resizeTimer);
    },
  };
}
