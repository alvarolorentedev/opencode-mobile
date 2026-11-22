// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useVoiceSetupTest } from '@/features/voice/state/use-voice-setup-test';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({
  callbacks: {} as { onWake: () => void; onError: (message: string) => void },
  background: (_state: string) => {},
  start: vi.fn<() => Promise<boolean>>(),
  stop: vi.fn<() => Promise<void>>(),
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: (_event: string, fn: typeof native.background) => {
    native.background = fn;
    return { remove: vi.fn() };
  } },
}));
vi.mock('@/shared/platform/voice/permissions', () => ({ isVoicePermissionPromptActive: () => false }));
vi.mock('@/shared/platform/voice/use-local-wake-word', () => ({
  useLocalWakeWord: (options: typeof native.callbacks) => { native.callbacks = options; return { start: native.start, stop: native.stop }; },
}));

function startUpdate<T>(update: () => T): T {
  let result!: T;
  act(() => { result = update(); });
  return result;
}

function setup(active = false, started = Promise.resolve(true), stopped = Promise.resolve()) {
  native.start.mockReset().mockReturnValue(started);
  native.stop.mockReset().mockReturnValue(stopped);
  const runtime = renderHook(({ busy }) => useVoiceSetupTest(defaultChatPreferences, busy), { busy: active });
  return {
    runtime, start: native.start, stop: native.stop, callbacks: () => native.callbacks,
    background: (state: string) => act(() => native.background(state)),
  };
}

describe('isolated provider-owned wake test', () => {
  it('detects a wake and releases its microphone without a conversation callback', async () => {
    const view = await setup();
    await act(async () => { await view.runtime.result.current.start(); });
    expect(view.runtime.result.current.status).toBe('listening');
    expect(Object.keys(view.callbacks())).not.toContain('sendPrompt');
    act(() => view.callbacks().onWake());
    expect(view.runtime.result.current.status).toBe('detected');
    expect(view.stop).toHaveBeenCalledOnce();
    await act(async () => { await view.runtime.result.current.stop(); });
    expect(view.stop).toHaveBeenCalledOnce();
  });

  it('blocks another workspace conversation and never stops audio it does not own', async () => {
    const view = await setup(true);
    await act(async () => { await view.runtime.result.current.start(); });
    expect(view.start).not.toHaveBeenCalled();
    expect(view.runtime.result.current.status).toBe('busy');
    await act(async () => { await view.runtime.result.current.stop(); });
    view.background('background');
    view.runtime.unmount();
    expect(view.stop).not.toHaveBeenCalled();
  });

  it('cancels pending starts on dismissal and backgrounding', async () => {
    const pending = Promise.withResolvers<boolean>();
    const view = await setup(false, pending.promise);
    const start = startUpdate(view.runtime.result.current.start);
    await act(async () => {});
    expect(view.start).toHaveBeenCalledOnce();
    expect(view.runtime.result.current.status).toBe('starting');
    view.background('background');
    await act(async () => { pending.resolve(true); await start; });
    expect(view.runtime.result.current.status).toBe('idle');
    expect(view.stop).toHaveBeenCalledOnce();
  });

  it('surfaces failure, permits retry, and stops when a conversation becomes active', async () => {
    const view = await setup();
    await act(async () => { await view.runtime.result.current.start(); });
    act(() => view.callbacks().onError('Microphone denied'));
    expect(view.runtime.result.current.error).toBe('Microphone denied');
    expect(view.runtime.result.current.status).toBe('error');
    await act(async () => { await view.runtime.result.current.start(); });
    expect(view.start).toHaveBeenCalledTimes(2);
    view.runtime.rerender({ busy: true });
    expect(view.runtime.result.current.status).toBe('busy');
    expect(view.stop).toHaveBeenCalledTimes(2);
  });
});

it('waits for microphone release before restarting a detected test', async () => {
  const stopped = Promise.withResolvers<void>();
  const view = await setup(false, Promise.resolve(true), stopped.promise);
  await act(async () => { await view.runtime.result.current.start(); });
  act(() => view.callbacks().onWake());
  const next = startUpdate(view.runtime.result.current.start);
  await act(async () => {});
  expect(view.start).toHaveBeenCalledOnce();
  await act(async () => { stopped.resolve(); await next; });
  expect(view.start).toHaveBeenCalledTimes(2);
});

it('reserves the microphone while a conversation is still starting', async () => {
  const pending = Promise.withResolvers<void>();
  const view = await setup();
  const conversation = startUpdate(() => view.runtime.result.current.runConversation(() => pending.promise));
  await act(async () => {});
  expect(view.runtime.result.current.status).toBe('busy');
  await act(async () => { await view.runtime.result.current.start(); });
  expect(view.start).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await conversation; });
  expect(view.runtime.result.current.status).toBe('idle');
  await act(async () => { await view.runtime.result.current.start(); });
  expect(view.start).toHaveBeenCalledOnce();
});
