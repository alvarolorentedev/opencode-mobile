import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decode } from 'base-64';

import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { attachmentKind, dataUrlBytes, pickedAttachment, prepareAttachmentFile, openAttachmentExternally, readAttachmentText } from '@/lib/attachment-preview';
import { defaultChatPreferences } from '@/providers/opencode-preferences';
import { parseChatPreferences } from '@/providers/persisted-preferences';
import { toFileDetail, toMessageRecord } from '@/lib/opencode/v2/mappers';
import { handleProviderEvent } from '@/providers/opencode-provider-events';
import { toTranscriptEntry } from '@/lib/opencode/format';
import { isTranscriptDisplayMessage } from '@/lib/opencode/transcript';

const native = vi.hoisted(() => ({ OS: 'ios', files: new Map<string, Uint8Array>(), shared: vi.fn(), released: vi.fn() }));
vi.mock('base-64', async (importOriginal) => {
  const actual = await importOriginal<typeof import('base-64')>();
  return { ...actual, decode: vi.fn(actual.decode) };
});
vi.mock('expo/fetch', () => ({ fetch: (...args: any[]) => (globalThis.fetch as any)(...args) }));
vi.mock('@/lib/opencode/client/types', () => ({ defaultConnectionSettings: { serverUrl: 'http://localhost' } }));
vi.mock('react-native', () => ({ Platform: native }));
vi.mock('@/lib/i18n', () => ({ getFormatLocale: () => 'en' }));
vi.mock('@/lib/connect', () => ({ parseConnectMetadata: () => undefined }));
vi.mock('@/lib/opencode/client', () => ({ getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }) }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: native.shared }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    create() { native.files.set(this.uri, new Uint8Array()); }
    write(bytes: Uint8Array) { native.files.set(this.uri, bytes); }
    get exists() { return native.files.has(this.uri); }
    get size() { return native.files.get(this.uri)?.length ?? 0; }
    async text() { return new TextDecoder().decode(native.files.get(this.uri)); }
    delete() { native.files.delete(this.uri); native.released(this.uri); }
  },
}));

const textAttachment = { uri: 'data:text/plain;base64,aGVsbG8=', mime: 'text/plain', filename: 'notes.txt' };
const pending = (id = 'm1') => ({ id, sessionId: 's', text: 'change this', createdAt: 1, attachments: [textAttachment], delivery: 'steer', state: 'waiting' });
const records = (id = 'm1') => [{ info: { id, role: 'user', time: { created: 1 } }, parts: [] }];

describe('feed attachments', () => {
  beforeEach(() => { native.OS = 'ios'; native.files.clear(); vi.clearAllMocks(); });

  it('preserves picker data URLs and releases unused web blob URLs', () => {
    native.OS = 'web';
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(pickedAttachment({ uri: 'blob:unused', base64: textAttachment.uri, name: 'notes.txt', mimeType: 'text/plain' })).toEqual(textAttachment);
    expect(revoke).toHaveBeenCalledWith('blob:unused');
    expect(pickedAttachment({ uri: 'file:///notes', base64: 'aGVsbG8=', name: 'notes.txt', mimeType: 'text/plain' }).uri).toBe(textAttachment.uri);
    revoke.mockRestore();
  });

  it('reads UTF-8 text and rejects malformed or oversized content', async () => {
    expect(await readAttachmentText(textAttachment)).toBe('hello');
    expect(new TextDecoder().decode(dataUrlBytes('data:text/plain;base64,aGVs\nbG8=\n'))).toBe('hello');
    expect(await readAttachmentText({ uri: `data:text/plain;base64,${Buffer.from('こんにちは').toString('base64')}` })).toBe('こんにちは');
    expect(new TextDecoder().decode(dataUrlBytes('data:text/plain,hello%20world'))).toBe('hello world');
    await expect(readAttachmentText({ uri: 'javascript:alert(1)' })).rejects.toThrow('unavailable');
    expect(() => dataUrlBytes('data:text/plain;base64,%%%')).toThrow();
    expect(() => dataUrlBytes(`data:text/plain,${'a'.repeat(10 * 1024 * 1024 + 1)}`)).toThrow('10 MB');
  });

  it('materializes native data files and cleans up even when external opening fails', async () => {
    const file = await prepareAttachmentFile(textAttachment);
    expect(native.files.get(file.uri)).toEqual(new TextEncoder().encode('hello'));
    file.release();
    expect(native.files.size).toBe(0);
    native.shared.mockRejectedValueOnce(new Error('viewer failed'));
    await expect(openAttachmentExternally(textAttachment)).rejects.toThrow('viewer failed');
    expect(native.files.size).toBe(0);
    const local = await prepareAttachmentFile({ uri: 'file:///original.txt' });
    local.release();
    expect(native.released).not.toHaveBeenCalledWith('file:///original.txt');
  });

  it('rejects declared oversize before reading and caps unknown streams without writing a temporary file', async () => {
    const remote = { uri: 'https://server/large.txt', mime: 'text/plain', filename: 'large.txt' };
    const read = vi.fn(), cancel = vi.fn();
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': String(10 * 1024 * 1024 + 1) }),
      body: { getReader: () => ({ read, cancel: async () => cancel(), releaseLock() {} }) } } as any);
    try {
      await expect(readAttachmentText(remote)).rejects.toThrow('10 MB'); expect(read).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
      transport.mockResolvedValue({ ok: true, headers: new Headers(), body: { getReader: () => ({ read,
        cancel: async () => cancel(), releaseLock() {} }) } } as any);
      read.mockResolvedValueOnce({ value: new Uint8Array(10 * 1024 * 1024), done: false })
        .mockResolvedValueOnce({ value: new Uint8Array(1), done: false });
      await expect(prepareAttachmentFile(remote)).rejects.toThrow('10 MB'); expect(read).toHaveBeenCalledTimes(2);
      expect(native.files.size).toBe(0);
    } finally { transport.mockRestore(); }
  });

  it('rejects oversized encoded data before base64 decoding and stops a canceled preview read', async () => {
    expect(() => dataUrlBytes(`data:text/plain;base64,${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4)}`)).toThrow('10 MB');
    expect(() => dataUrlBytes(`data:text/plain;base64,${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4 - 1)}`)).toThrow('10 MB');
    expect(decode).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    const transport = vi.spyOn(globalThis, 'fetch');
    try { await expect(readAttachmentText({ uri: 'https://server/file' }, controller.signal)).rejects.toThrow('canceled'); expect(transport).not.toHaveBeenCalled(); }
    finally { transport.mockRestore(); }
    native.files.set('file:///too-big', new Uint8Array(10 * 1024 * 1024 + 1));
    await expect(prepareAttachmentFile({ uri: 'file:///too-big' })).rejects.toThrow('10 MB');
    expect(native.files.has('file:///too-big')).toBe(true);
  });

  it('normalizes both user and tool attachments without dropping media-only messages', () => {
    const file = { name: 'result.png', mime: 'image/png', data: 'aGVsbG8=', source: { type: 'file', uri: 'file:///server/path' } };
    expect(toFileDetail(file).url).toBe('data:image/png;base64,aGVsbG8=');
    expect(attachmentKind({ uri: '', mime: 'audio/wav' })).toBe('audio');
    expect(attachmentKind({ uri: '', mime: 'video/mp4', filename: 'clip.mp4' })).toBe('video');
    expect(attachmentKind({ uri: '', filename: 'clip.mp4' })).toBe('video');
    expect(attachmentKind({ uri: '', filename: 'notes.md' })).toBe('text');
    expect(attachmentKind({ uri: '', mime: 'application/pdf' })).toBe('document');
    const mapped = toMessageRecord({ id: 'm', type: 'user', time: { created: 1 }, text: '', files: [file] } as never, 's');
    const entry = toTranscriptEntry(mapped as never);
    expect(entry.details[0]).toMatchObject({ kind: 'file', uri: 'data:image/png;base64,aGVsbG8=', mime: 'image/png', filename: 'result.png' });
    const assistant = toTranscriptEntry({ info: { id: 'a', role: 'assistant', time: { created: 1 } }, parts: [{ type: 'tool', tool: 'capture', state: { status: 'completed', output: '', attachments: [{ type: 'file', url: 'data:image/png;base64,aGVsbG8=', mime: 'image/png', filename: 'result.png' }] } }] } as never);
    expect(isTranscriptDisplayMessage(assistant)).toBe(true);
    expect(assistant.details[1]).toMatchObject({ uri: 'data:image/png;base64,aGVsbG8=' });
  });

  it('validates the delivery setting and refreshes for every inbox event', () => {
    expect(defaultChatPreferences.promptDelivery).toBe('steer');
    expect(parseChatPreferences('{"promptDelivery":"queue"}').promptDelivery).toBe('queue');
    expect(parseChatPreferences('{"promptDelivery":"invalid"}').promptDelivery).toBeUndefined();
    for (const type of ['enqueued', 'delivered', 'cancelled', 'delivery.changed']) {
      const scheduleSessionRefresh = vi.fn();
      handleProviderEvent({ id: 'event', type: `session.inbox.${type}`, data: { sessionID: 's' } } as never, { scheduleSessionRefresh } as never);
      expect(scheduleSessionRefresh).toHaveBeenCalledWith('s', { messages: true });
    }
  });
});

describe('provider-owned prompt inbox', () => {
  async function mount(client: any, readMessages = vi.fn(async () => [] as any[]), options: { online?: boolean; connected?: boolean } = {}) {
    const runtime = hookRuntime();
    const { usePromptInbox } = await loadTs('providers/use-prompt-inbox.ts', {
      react: runtime.react,
      '@/providers/services/session-service': { getSessionInbox: (candidate: any, id: string) => candidate.promptInbox.list(id) },
      '@/lib/opencode/client/errors': { classifyConnectionFailure: () => 'unknown' },
    });
    runtime.mount(usePromptInbox, {
      client,
      isCurrentClient: (candidate: any) => candidate === client,
      refreshMessages: readMessages,
      connected: options.connected ?? true,
      online: options.online ?? true,
    });
    return runtime;
  }

  it('pins submissions, keeps confirmed inbox state on failure, and removes delivered duplicates', async () => {
    const admission = deferred();
    const client = { promptInbox: { submit: vi.fn(() => admission.promise), list: vi.fn(async () => [pending()]) } };
    const read = vi.fn(async () => [] as any[]);
    const runtime = await mount(client, read);
    const sending = runtime.value.submitPrompt({ sessionID: 's', parts: [{ type: 'text', text: 'change this' }] }, 'queue');
    runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s[0]).toMatchObject({ state: 'sending', delivery: 'queue' });
    admission.resolve(pending()); await sending; runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s[0].id).toBe('m1');
    client.promptInbox.list.mockRejectedValueOnce(new Error('offline'));
    await runtime.value.refreshMessages('s'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(1);
    read.mockResolvedValue(records());
    await runtime.value.refreshMessages('s'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(0);
  });

  it('prevents a stale refresh from dropping a newly admitted prompt', async () => {
    const gate = deferred();
    const client = { promptInbox: { submit: async () => pending(), list: () => gate.promise } };
    const runtime = await mount(client);
    const refresh = runtime.value.refreshMessages('s');
    await runtime.value.submitPrompt({ sessionID: 's', parts: [] }, 'steer'); runtime.flush();
    gate.resolve([]); await refresh; runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s[0].id).toBe('m1');
  });

  it('recovers server-side pending prompts, respects cancellation, and isolates clients', async () => {
    const client = { promptInbox: { list: vi.fn(async () => [pending('m2'), pending('m1')]) } };
    const runtime = await mount(client);
    await runtime.value.refreshMessages('s'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(2);
    client.promptInbox.list.mockResolvedValueOnce([]);
    await runtime.value.refreshMessages('s'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(0);
    const other = { promptInbox: { list: async () => [pending()] } };
    runtime.update({ client: other, isCurrentClient: (candidate: any) => candidate === other });
    expect(runtime.value.pendingPromptsBySession).toEqual({});
  });

  it('cancels a waiting prompt and removes it from the local stack', async () => {
    const client = { promptInbox: { list: vi.fn(async () => [pending('m1')]), cancel: vi.fn(async () => undefined) } };
    const runtime = await mount(client);
    await runtime.value.refreshMessages('s'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(1);
    await runtime.value.cancelPrompt('s', 'm1'); runtime.flush();
    expect(client.promptInbox.cancel).toHaveBeenCalledWith('s', 'm1');
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(0);
  });

  it('removes failed submissions and preserves V1 sending behavior', async () => {
    const runtime = await mount({ promptInbox: { submit: async () => { throw new Error('rejected'); } } });
    await expect(runtime.value.submitPrompt({ sessionID: 's', parts: [] }, 'steer')).rejects.toThrow('rejected'); runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(0);
    const promptAsync = vi.fn();
    const v1 = await mount({ compatibility: { session: { promptAsync } } });
    await v1.value.submitPrompt({ sessionID: 's', parts: [] }, 'queue'); v1.flush();
    expect(promptAsync).toHaveBeenCalledWith({ sessionID: 's', parts: [] });
    expect(v1.value.pendingPromptsBySession).toEqual({});
  });

  it('queues an offline submission and admits it once after connectivity returns', async () => {
    const client = {
      promptInbox: {
        submit: vi.fn()
          .mockRejectedValueOnce(new Error('Failed to fetch'))
          .mockResolvedValueOnce(pending('m-offline')),
        list: vi.fn(async () => []),
      },
    };
    const runtime = await mount(client, vi.fn(async () => [] as any[]), { online: false });
    await runtime.value.submitPrompt({ sessionID: 's', parts: [{ type: 'text', text: 'queued text' }] }, 'steer');
    runtime.flush();
    expect(runtime.value.pendingPromptsBySession.s[0]).toMatchObject({ state: 'queued', text: 'queued text' });

    runtime.update({ online: true }); runtime.flush();
    await runtime.settle();
    runtime.flush();
    expect(client.promptInbox.submit).toHaveBeenCalledTimes(2);
    expect(runtime.value.pendingPromptsBySession.s).toHaveLength(1);
    expect(runtime.value.pendingPromptsBySession.s[0]).toMatchObject({ id: 'm-offline', state: 'waiting' });
  });
});
