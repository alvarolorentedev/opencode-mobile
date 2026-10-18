import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalDecoder, createTerminalOutputQueue, MAX_TERMINAL_PENDING_BYTES } from '@/lib/opencode/terminal-stream';
import { encodeTerminalKey, NO_MODIFIERS, pasteNeedsConfirmation } from '@/components/terminal/terminal-keys';
import { createTerminalConnection, type TerminalConnectionContext } from '@/providers/terminal-connection';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import type { Terminal } from '@xterm/xterm';
import { installTerminalInput } from '@/components/terminal/terminal-input';

const services = vi.hoisted(() => ({ token: vi.fn(), socket: vi.fn(), resize: vi.fn(), url: vi.fn() }));
vi.mock('@/providers/services/terminal-service', () => ({
  createTerminalConnectToken: services.token, openTerminalWebSocket: services.socket,
  resizeTerminal: services.resize, getTerminalWebSocketUrl: services.url,
}));
class Socket {
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void; onmessage?: (event: { data: unknown }) => void;
  onclose?: (event: { code: number; reason: string }) => void; onerror?: () => void;
  close() { this.readyState = 3; }
  send(text: string) { this.sent.push(text); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data }); }
  end(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}
const metadata = (cursor: number) => new TextEncoder().encode(`\0${JSON.stringify({ cursor })}`).buffer;
async function settle() { await vi.advanceTimersByTimeAsync(0); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  services.token.mockResolvedValue({ ticket: 'fresh-ticket' }); services.resize.mockResolvedValue({});
  services.socket.mockImplementation(() => new Socket()); services.url.mockImplementation((_settings, id, options) => `${id}:${options.cursor ?? 'replay'}`);
});
afterEach(() => { vi.useRealTimers(); });

describe('terminal input encoding', () => {
  it('forwards system insertText without duplicating keyboard or composition input', async () => {
    const textarea = new EventTarget();
    const input = vi.fn(); let onKey!: (event: { key: string }) => void;
    const dispose = installTerminalInput({ textarea, input, onKey: (listener) => { onKey = listener; return { dispose: vi.fn() }; } } as unknown as Terminal);
    const insert = (data: string) => textarea.dispatchEvent(Object.assign(new Event('input'), { inputType: 'insertText', data, isComposing: false }));
    insert('😀'); insert('a');
    expect(input.mock.calls).toEqual([['😀', true], ['a', true]]);
    onKey({ key: 'b' }); insert('b'); expect(input).toHaveBeenCalledTimes(2);
    textarea.dispatchEvent(new Event('compositionstart')); insert('中文');
    textarea.dispatchEvent(new Event('compositionend')); insert('中文');
    expect(input).toHaveBeenCalledTimes(2); await settle(); insert('é');
    expect(input).toHaveBeenLastCalledWith('é', true);
    textarea.dispatchEvent(Object.assign(new Event('keydown'), { keyCode: 229 })); insert('1');
    expect(input).toHaveBeenCalledTimes(3);
    dispose(); insert('ignored'); expect(input).toHaveBeenCalledTimes(3);
  });
  it('encodes control letters, Alt text, Shift+Tab and mode-dependent arrows', () => {
    expect(encodeTerminalKey('c', { ...NO_MODIFIERS, ctrl: true })).toBe('\x03');
    expect(encodeTerminalKey(' ', { ...NO_MODIFIERS, ctrl: true })).toBe('\0');
    expect(encodeTerminalKey('b', { ...NO_MODIFIERS, alt: true })).toBe('\x1bb');
    expect(encodeTerminalKey('b', { ...NO_MODIFIERS, shift: true })).toBe('B');
    expect(encodeTerminalKey('Tab', { ...NO_MODIFIERS, shift: true })).toBe('\x1b[Z');
    expect(encodeTerminalKey('ArrowUp', NO_MODIFIERS, true)).toBe('\x1bOA');
    expect(encodeTerminalKey('ArrowUp', { ctrl: true, alt: true, shift: true }, true)).toBe('\x1b[1;8A');
    expect(encodeTerminalKey('F1', NO_MODIFIERS)).toBe('\x1bOP');
    expect(encodeTerminalKey('F12', { ...NO_MODIFIERS, ctrl: true })).toBe('\x1b[24;5~');
    expect(encodeTerminalKey('é', { ...NO_MODIFIERS, ctrl: true })).toBeUndefined();
  });
  it('requires confirmation for multiline or control-character paste', () => {
    expect(pasteNeedsConfirmation('echo 中文')).toBe(false);
    expect(pasteNeedsConfirmation('echo first\necho second')).toBe(true);
    expect(pasteNeedsConfirmation('\x1b[2J')).toBe(true);
  });
});

describe('terminal output', () => {
  it('preserves fragmented UTF-8, ANSI and validated cursor metadata', async () => {
    const decode = createTerminalDecoder(), bytes = new TextEncoder().encode('😀');
    expect(await decode(bytes.slice(0, 2).buffer)).toEqual({ text: '' });
    expect(await decode(bytes.slice(2).buffer)).toEqual({ text: '😀' });
    expect(await decode('\x1b[31mred\x1b[0m')).toEqual({ text: '\x1b[31mred\x1b[0m' });
    expect(await decode(metadata(14))).toEqual({ cursor: 14 });
    expect(await decode(new TextEncoder().encode('\0{"cursor":-1}').buffer)).toBeUndefined();
    expect(await decode(new TextEncoder().encode('\0invalid').buffer)).toBeUndefined();
  });
  it('cannot reorder a delayed Blob, following text, or cursor acknowledgements', async () => {
    let release!: (value: ArrayBuffer) => void;
    const blob = new Blob(['first']);
    vi.spyOn(blob, 'arrayBuffer').mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const events: string[] = [];
    const queue = createTerminalOutputQueue({ write: async (text) => { events.push(text); }, onText: (length) => events.push(`length:${length}`), onCursor: (cursor) => events.push(`cursor:${cursor}`), onError: vi.fn() });
    queue.push(blob); queue.push('😀'); queue.push(metadata(20)); queue.push('last');
    const drained = queue.drain(); await settle(); expect(events).toEqual([]);
    release(new TextEncoder().encode('first').buffer); await drained;
    expect(events).toEqual(['first😀', 'length:7', 'cursor:20', 'last', 'length:4']);
  });
  it('stops on pending-buffer overflow instead of silently dropping output', () => {
    const error = vi.fn(), write = vi.fn();
    const queue = createTerminalOutputQueue({ write, onText: vi.fn(), onCursor: vi.fn(), onError: error });
    queue.push(new ArrayBuffer(MAX_TERMINAL_PENDING_BYTES + 1));
    expect(error).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
  });
  it('bounds a single large frame and acknowledges chunks without splitting surrogate pairs', async () => {
    const writes: string[] = [], lengths: number[] = [];
    const queue = createTerminalOutputQueue({ write: async (text) => { writes.push(text); }, onText: (length) => lengths.push(length), onCursor: vi.fn(), onError: vi.fn() });
    const text = 'x'.repeat(65535) + '😀tail'; queue.push(text); await queue.drain();
    expect(writes).toEqual(['x'.repeat(65535), '😀tail']); expect(lengths).toEqual([65535, 6]);
  });
});

describe('PTY connection lifecycle', () => {
  function connection(context?: () => TerminalConnectionContext) {
    return createTerminalConnection({
      id: 'pty-1',
      context: context ?? (() => ({ client: {} as ScopedOpencodeClient, current: true, serverUrl: 'https://example.test/prefix', directory: '/workspace', serverContract: 'v1' })),
      publish: vi.fn(),
    });
  }
  it('sends raw input and resumes at the acknowledged UTF-16 cursor with a fresh ticket', async () => {
    const pty = connection(), written: string[] = [];
    pty.register({ write: async (text) => { written.push(text); } }); await settle();
    const first = services.socket.mock.results[0].value as Socket;
    first.open(); first.message('$ '); first.message(metadata(2)); first.message('😀');
    await vi.advanceTimersByTimeAsync(16);
    pty.send('x'); pty.send('\x03'); expect(first.sent).toEqual(['x', '\x03']);
    first.end(); expect(() => pty.send('unsafe')).toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.url.mock.calls[1][2]).toEqual({ ticket: 'fresh-ticket', cursor: '4' });
    expect(services.token).toHaveBeenCalledTimes(2); expect(written).toEqual(['$ ', '😀']);
    pty.dispose();
  });
  it('reconnects with rotated credentials while keeping the renderer cursor', async () => {
    const initial = {} as ScopedOpencodeClient, rotated = {} as ScopedOpencodeClient;
    const live: TerminalConnectionContext = { client: initial, current: true, serverUrl: 'https://example.test/prefix', directory: '/workspace', serverContract: 'v1', authorization: 'Basic old' };
    const pty = connection(() => live);
    pty.register({ write: async () => {} }); await settle();
    const socket = services.socket.mock.results[0].value as Socket;
    socket.open(); socket.message('$ '); socket.message(metadata(2));
    await vi.advanceTimersByTimeAsync(16);
    live.client = rotated; live.authorization = 'Basic new';
    pty.reconnect(); await settle();
    expect(services.token.mock.calls[1][0]).toBe(rotated);
    expect(services.socket.mock.calls[1][1]).toBe('Basic new');
    expect(services.url.mock.calls[1][2]).toEqual({ ticket: 'fresh-ticket', cursor: '2' });
    pty.dispose();
  });
  it('jitters reconnect delays while keeping them bounded', async () => {    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const pty = connection(); pty.register({ write: async () => {} }); await settle();
    const socket = services.socket.mock.results[0].value as Socket;
    socket.open(); socket.end();
    await vi.advanceTimersByTimeAsync(499);
    expect(services.token).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(services.token).toHaveBeenCalledTimes(2);
    random.mockRestore();
    pty.dispose();
  });
  it('waits for in-flight renderer writes before reconnect and resets the cursor after renderer loss', async () => {
    const pty = connection(); let acknowledge!: () => void;
    pty.register({ write: () => new Promise((resolve) => { acknowledge = resolve; }) }); await settle();
    const first = services.socket.mock.results[0].value as Socket;
    first.open(); first.message(metadata(10)); first.message('hello');
    await vi.advanceTimersByTimeAsync(16); first.end(); await vi.advanceTimersByTimeAsync(1000);
    expect(services.token).toHaveBeenCalledTimes(1);
    acknowledge(); await settle(); expect(services.url.mock.calls[1][2].cursor).toBe('15');
    pty.register({ write: async () => {} }); await settle(); expect(services.url.mock.calls[2][2].cursor).toBeUndefined();
    pty.dispose();
  });
  it('suspends background retries, deduplicates/debounces size, and stops on exit', async () => {
    const pty = connection(); pty.register({ write: async () => {} }); await settle();
    const socket = services.socket.mock.results[0].value as Socket; socket.open();
    pty.resize(80, 24); await settle(); expect(services.resize).toHaveBeenCalledTimes(1);
    pty.resize(80, 24); await vi.advanceTimersByTimeAsync(100); expect(services.resize).toHaveBeenCalledTimes(1);
    pty.resize(90, 30); pty.resize(100, 35); await vi.advanceTimersByTimeAsync(100);
    expect(services.resize.mock.calls.at(-1)?.[2]).toEqual({ cols: 100, rows: 35 });
    pty.foreground(false); expect(() => pty.send('x')).toThrow();
    await vi.advanceTimersByTimeAsync(15000); expect(services.token).toHaveBeenCalledTimes(1);
    pty.foreground(true); await settle(); const resumed = services.socket.mock.results[1].value as Socket;
    resumed.open(); resumed.end(1000); await vi.advanceTimersByTimeAsync(15000);
    expect(pty.state.status).toBe('exited'); expect(services.token).toHaveBeenCalledTimes(2); pty.dispose();
  });
  it('stops on rejected authentication and ignores late ticket completion after disposal', async () => {
    services.token.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const pty = connection(); pty.register({ write: async () => {} }); await settle();
    expect(pty.state.status).toBe('error'); await vi.advanceTimersByTimeAsync(15000); expect(services.token).toHaveBeenCalledTimes(1);
    let release!: (value: { ticket: string }) => void;
    services.token.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    pty.reconnect(); await settle(); pty.dispose(); release({ ticket: 'stale' }); await settle(); expect(services.socket).not.toHaveBeenCalled();
  });
});
