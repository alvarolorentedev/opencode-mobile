import { describe, expect, it, vi } from 'vitest';

import type { ToolPart } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import { createAppStore, type AppState } from '@/runtime/core/store';
import { useLiveTranscript } from '@/features/chat/state/use-live-transcript';
import { hookRuntime } from '../../../tests/helpers/runtime.mjs';
import {
  liveTranscriptRecord,
  overlayLiveRecords,
  reduceLiveEvent,
  seedLiveMessage,
  userMessageRecord,
  type LiveTranscriptMessage,
} from '@/features/chat/model/live-transcript';

const driver = hookRuntime();
const store = createAppStore({ settings: { serverUrl: '', username: '', password: '', directory: '' }, chatPreferences: {} as never, controlPlaneUrl: '' });
vi.mock('react', () => ({
  useCallback: (...args: unknown[]) => Reflect.apply(driver.react.useCallback, undefined, args),
  useEffect: (...args: unknown[]) => Reflect.apply(driver.react.useEffect, undefined, args),
  useMemo: (...args: unknown[]) => Reflect.apply(driver.react.useMemo, undefined, args),
  useRef: (...args: unknown[]) => Reflect.apply(driver.react.useRef, undefined, args),
}));
vi.mock('@/runtime/core', () => ({
  useAppCore: () => ({ store }),
  useAppStore: (select: (state: AppState) => unknown) => select(store.getState()),
}));

const DATA_URL = 'data:video/mp4;base64,AAAA';

function apply(previous: LiveTranscriptMessage | undefined, event: Record<string, unknown>) {
  return reduceLiveEvent(previous, event as never);
}

function message(previous: LiveTranscriptMessage | undefined, event: Record<string, unknown>) {
  const result = apply(previous, event);
  if (result.kind !== 'update') throw new Error(`expected update, got ${result.kind}`);
  return result.message;
}

it('paints a batch at 50 ms without writing the live reply or local media to the canonical window', () => {
  vi.useFakeTimers();
  const scopeKey = 'stream-workspace';
  const canonical: Record<string, SessionMessageRecord[]> = {};
  try {
    const { actions } = driver.mount(useLiveTranscript, {
      scopeKey, client: {}, isCurrentClient: () => true, messagesBySession: canonical,
      readCanonicalSession: (id: string) => canonical[id] ?? [], recordUsageAndTodos: vi.fn(),
    });
    const url = `data:video/mp4;base64,${'A'.repeat(1024 * 1024)}`;
    actions.appendUserMessage('s', { id: 'u', createdAt: 10, text: 'look', attachments: [{ url }] });
    driver.flush();
    const before = driver.value.displayedMessages;
    for (const delta of ['one', ' two', ' three']) {
      expect(actions.applyEvent({ type: 'session.text.delta', created: 11, data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta } })).toBe(true);
    }
    vi.advanceTimersByTime(49);
    driver.flush();
    expect(driver.value.displayedMessages).toBe(before);
    vi.advanceTimersByTime(1);
    driver.flush();
    expect(driver.value.displayedMessages.s[0]).toBe(before.s[0]);
    expect(driver.value.displayedMessages.s[1].parts[0]).toMatchObject({ type: 'text', text: 'one two three' });
    expect(canonical).toEqual({});
  } finally {
    driver.unmount();
    vi.useRealTimers();
  }
});

describe('live V2 transcript reducer', () => {
  it('accumulates text deltas and replaces them with the ended text', () => {
    let state = message(undefined, { type: 'session.step.started', created: 10, data: { sessionID: 's', assistantMessageID: 'a', started: 10, model: { providerID: 'p', id: 'm' } } });
    state = message(state, { type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta: 'Hel' } });
    state = message(state, { type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta: 'lo' } });
    state = message(state, { type: 'session.text.ended', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, text: 'Hello' } });
    const record = liveTranscriptRecord(state);
    expect(record.info).toMatchObject({ id: 'a', role: 'assistant', providerID: 'p', modelID: 'm' });
    expect(record.parts[0]).toMatchObject({ type: 'text', text: 'Hello' });
  });

  it('tracks tool input, completion content and attachments by tool id', () => {
    let state = message(undefined, { type: 'session.tool.input.started', data: { sessionID: 's', assistantMessageID: 'a', id: 't1', name: 'capture' } });
    state = message(state, { type: 'session.tool.input.ended', data: { sessionID: 's', assistantMessageID: 'a', id: 't1', text: '{"screen":1}' } });
    state = message(state, { type: 'session.tool.success', data: { sessionID: 's', assistantMessageID: 'a', id: 't1', content: [{ type: 'text', text: 'done' }, { type: 'file', uri: DATA_URL, mime: 'video/mp4', name: 'clip.mp4' }] } });
    const record = liveTranscriptRecord(state);
    expect(record.parts[0]).toMatchObject({
      type: 'tool',
      callID: 't1',
      tool: 'capture',
      state: {
        status: 'completed',
        output: 'done\n[file] data:video/mp4;base64,AAAA',
      },
    });
    expect((record.parts[0] as ToolPart).state.status).toBe('completed');
    const completed = record.parts[0] as ToolPart;
    expect(completed.state.status === 'completed' ? completed.state.attachments?.[0].url : undefined).toBe(DATA_URL);
  });

  it('accumulates step usage and emits one patch and step-finish part', () => {
    let state = message(undefined, { type: 'session.step.started', data: { sessionID: 's', assistantMessageID: 'a', model: { providerID: 'p', id: 'm' } } });
    state = message(state, { type: 'session.step.ended', data: { sessionID: 's', assistantMessageID: 'a', finish: 'stop', cost: 0.5, tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 4 } }, files: ['src/a.ts'] } });
    state = message(state, { type: 'session.step.ended', data: { sessionID: 's', assistantMessageID: 'a', cost: 0.25, tokens: { input: 5, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, files: ['src/b.ts'] } });
    const record = liveTranscriptRecord(state);
    expect(record.parts.find((part) => part.type === 'patch')).toMatchObject({ files: ['src/a.ts', 'src/b.ts'] });
    expect(record.parts.find((part) => part.type === 'step-finish')).toMatchObject({
      cost: 0.75,
      tokens: { input: 15, output: 3, reasoning: 1, cache: { read: 3, write: 4 } },
    });
  });

  it('shows retry and error state without a fetch', () => {
    let state = message(undefined, { type: 'session.step.started', data: { sessionID: 's', assistantMessageID: 'a', model: { providerID: 'p', id: 'm' } } });
    state = message(state, { type: 'session.retry.scheduled', data: { sessionID: 's', assistantMessageID: 'a', attempt: 2, at: 1, error: { message: 'overloaded' } } });
    state = message(state, { type: 'session.step.failed', data: { sessionID: 's', assistantMessageID: 'a', error: { type: 'ProviderError', message: 'boom' } } });
    const record = liveTranscriptRecord(state);
    expect(record.parts.find((part) => part.type === 'retry')).toMatchObject({ attempt: 2, error: { data: { message: 'overloaded' } } });
    expect(record.info.role === 'assistant' ? record.info.error?.data?.message : undefined).toBe('boom');
  });

  it('overlays a live message over a page that landed mid-turn', () => {
    const page = [{ info: { id: 'a', sessionID: 's', role: 'assistant' as const, time: { created: 5 }, providerID: 'p', modelID: 'm' }, parts: [{ id: 'a-0', sessionID: 's', messageID: 'a', type: 'text' as const, text: 'old' }] }];
    let state = message(undefined, { type: 'session.text.started', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0 } });
    state = message(state, { type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta: 'new' } });
    const next = overlayLiveRecords(page, [state]);
    expect(next[0].parts[0]).toMatchObject({ type: 'text', text: 'new' });
  });

  it('seeds from a painted record so later deltas append to it', () => {
    const painted = {
      info: { id: 'a', sessionID: 's', role: 'assistant' as const, time: { created: 5 }, providerID: 'p', modelID: 'm' },
      parts: [{ id: 'a-0', sessionID: 's', messageID: 'a', type: 'text' as const, text: 'Hello ' }],
    };
    let state = seedLiveMessage(painted);
    state = message(state, { type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta: 'world' } });
    expect(liveTranscriptRecord(state).parts[0]).toMatchObject({ type: 'text', text: 'Hello world' });
  });

  it('consumes usage updates and rejects unmodelled rows', () => {
    expect(apply(undefined, { type: 'session.usage.updated', data: { sessionID: 's', cost: 1 } }).kind).toBe('consumed');
    expect(apply(undefined, { type: 'session.synthetic', data: { sessionID: 's', text: 'notice' } }).kind).toBe('unsupported');
  });

  it('builds the optimistic user record with its attachments', () => {
    const record = userMessageRecord({ id: 'u', sessionID: 's', text: 'look', createdAt: 1, attachments: [{ url: DATA_URL, mime: 'video/mp4', filename: 'clip.mp4' }] });
    expect(record.info).toMatchObject({ id: 'u', role: 'user' });
    expect(record.parts).toEqual([
      { id: 'u-text-0', sessionID: 's', messageID: 'u', type: 'text', text: 'look' },
      { id: 'u-file-0', sessionID: 's', messageID: 'u', type: 'file', url: DATA_URL, mime: 'video/mp4', filename: 'clip.mp4' },
    ]);
  });
});
