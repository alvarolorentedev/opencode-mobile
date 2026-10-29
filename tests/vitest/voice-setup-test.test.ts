import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

async function setup(active = false, started = Promise.resolve(true), stopped = Promise.resolve()) {
  const runtime = hookRuntime();
  const start = vi.fn(() => started);
  const stop = vi.fn(() => stopped);
  let callbacks: any;
  let background: (state: string) => void = () => {};
  const { useVoiceSetupTest } = await loadTs('providers/use-voice-setup-test.ts', {
    react: { ...runtime.react, createContext: () => ({}), useContext: vi.fn() },
    'react-native': { AppState: { currentState: 'active', addEventListener: (_event: string, fn: typeof background) => { background = fn; return { remove: vi.fn() }; } } },
    '@/lib/voice/use-local-wake-word': { useLocalWakeWord: (options: any) => { callbacks = options; return { start, stop }; } },
  }, runtime.globals);
  runtime.mount(({ busy }: { busy: boolean }) => useVoiceSetupTest({}, busy), { busy: active });
  return { runtime, start, stop, callbacks: () => callbacks, background: (state: string) => background(state) };
}

describe('isolated provider-owned wake test', () => {
  it('detects a wake and releases its microphone without a conversation callback', async () => {
    const view = await setup();
    await view.runtime.value.start();
    view.runtime.flush();
    expect(view.runtime.value.status).toBe('listening');
    expect(Object.keys(view.callbacks())).not.toContain('sendPrompt');
    view.callbacks().onWake();
    view.runtime.flush();
    expect(view.runtime.value.status).toBe('detected');
    expect(view.stop).toHaveBeenCalledOnce();
    await view.runtime.value.stop();
    expect(view.stop).toHaveBeenCalledOnce();
  });

  it('blocks another workspace conversation and never stops audio it does not own', async () => {
    const view = await setup(true);
    await view.runtime.value.start();
    expect(view.start).not.toHaveBeenCalled();
    expect(view.runtime.value.status).toBe('busy');
    await view.runtime.value.stop();
    view.background('background');
    view.runtime.unmount();
    expect(view.stop).not.toHaveBeenCalled();
  });

  it('cancels pending starts on dismissal and backgrounding', async () => {
    const pending = deferred<boolean>();
    const view = await setup(false, pending.promise);
    const start = view.runtime.value.start();
    await view.runtime.settle();
    expect(view.start).toHaveBeenCalledOnce();
    expect(view.runtime.value.status).toBe('starting');
    view.background('background');
    pending.resolve(true);
    await start;
    view.runtime.flush();
    expect(view.runtime.value.status).toBe('idle');
    expect(view.stop).toHaveBeenCalledOnce();
  });

  it('surfaces failure, permits retry, and stops when a conversation becomes active', async () => {
    const view = await setup();
    await view.runtime.value.start();
    view.callbacks().onError('Microphone denied');
    view.runtime.flush();
    expect(view.runtime.value.error).toBe('Microphone denied');
    expect(view.runtime.value.status).toBe('error');
    await view.runtime.value.start();
    view.runtime.flush();
    expect(view.start).toHaveBeenCalledTimes(2);
    view.runtime.update({ busy: true });
    expect(view.runtime.value.status).toBe('busy');
    expect(view.stop).toHaveBeenCalledTimes(2);
  });
});


it('waits for microphone release before restarting a detected test', async () => {
  const stopped = deferred<void>();
  const view = await setup(false, Promise.resolve(true), stopped.promise);
  await view.runtime.value.start();
  view.callbacks().onWake();
  view.runtime.flush();
  const next = view.runtime.value.start();
  await view.runtime.settle();
  expect(view.start).toHaveBeenCalledOnce();
  stopped.resolve();
  await next;
  expect(view.start).toHaveBeenCalledTimes(2);
});


it('reserves the microphone while a conversation is still starting', async () => {
  const pending = deferred<void>();
  const view = await setup();
  const conversation = view.runtime.value.runConversation(() => pending.promise);
  await view.runtime.settle();
  expect(view.runtime.value.status).toBe('busy');
  await view.runtime.value.start();
  expect(view.start).not.toHaveBeenCalled();
  pending.resolve();
  await conversation;
  view.runtime.flush();
  expect(view.runtime.value.status).toBe('idle');
  await view.runtime.value.start();
  expect(view.start).toHaveBeenCalledOnce();
});
