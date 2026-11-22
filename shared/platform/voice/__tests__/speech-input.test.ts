// @vitest-environment happy-dom

import assert from 'node:assert/strict';
import { act, useEffect } from 'react';
import { it, onTestFinished, vi } from 'vitest';
import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';

import { createTranscriptAccumulator } from '@/shared/platform/voice/transcript-accumulate';
import { controlledClock, settleReact } from '../../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../../tests/helpers/render-hook';

type Listener = (payload: unknown) => void;
type AppState = { currentState: string; addEventListener: (event: string, handler: (state: string) => void) => { remove: () => unknown } };
type Native = { addListener: (event: string, handler: Listener) => { remove: () => unknown } };
type Permission = { ensure: () => Promise<{ granted: boolean }>; promptActive: boolean };

const device = vi.hoisted(() => ({
  os: 'android', version: 34, appState: {} as AppState, recognizer: {} as Native,
  permissions: {} as Permission, subscribeEvents: true, telemetry: {} as object,
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return device.os; }, get Version() { return device.version; } },
  AppState: { get currentState() { return device.appState.currentState; },
    addEventListener: (...args: Parameters<AppState['addEventListener']>) => device.appState.addEventListener(...args) },
}));
vi.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: new Proxy({}, { get: (_, key) => Reflect.get(device.recognizer, key) }),
  useSpeechRecognitionEvent: (event: string, handler: Listener) => useEffect(() => {
    if (!device.subscribeEvents) return;
    const subscription = device.recognizer.addListener(event, handler);
    return () => { subscription.remove(); };
  }, [event, handler]),
}));
vi.mock('@/shared/platform/voice/permissions', () => ({
  ensureVoiceInputPermissionAsync: () => device.permissions.ensure(),
  isVoicePermissionPromptActive: () => device.permissions.promptActive,
}));
vi.mock('@/shared/observability/client', () => ({
  telemetry: new Proxy({}, { get: (_, key) => Reflect.get(device.telemetry, key) ?? (() => {}) }),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

async function speechInput(os: string, version: number, appState: AppState, recognizer: Native,
  permissions: Permission = { ensure: async () => ({ granted: true }), promptActive: false },
  subscribeEvents = true, telemetry = {}) {
  Object.assign(device, { os, version, appState, recognizer, permissions, subscribeEvents, telemetry });
  // Each recognizer fixture represents a fresh native app process.
  vi.resetModules();
  return import('@/shared/platform/voice/use-speech-input');
}

async function invoke<T>(action: () => T | Promise<T>) {
  let result!: T;
  await act(async () => { result = await action(); });
  return result;
}
function start<T>(action: () => Promise<T>) {
  let pending!: Promise<T>;
  act(() => { pending = action(); });
  return pending;
}

it('isolates recognition owners through competing starts, cancellation and network fallback', async () => {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const starts: ExpoSpeechRecognitionOptions[] = [];
  const appStateListeners = new Set<(state: string) => void>();
  const appState = { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  } };
  let stops = 0, aborts = 0, speechStarts = 0;
  const transcripts = [createTranscriptAccumulator(), createTranscriptAccumulator()];
  const results: string[][] = [[], []];
  const alternativeResults: string[][] = [[], []];
  const permissions = {
    ensure: async () => ({ granted: true }),
    promptActive: false,
  };
  const native = {
    addListener: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return { remove: () => listeners.get(event)!.delete(listener) };
    },
    supportsOnDeviceRecognition: () => true,
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    start: (options: ExpoSpeechRecognitionOptions) => { starts.push(options); emit('start'); },
    stop: () => { stops++; },
    abort: () => { aborts++; },
  };
  function emit(event: string, payload: Parameters<Listener>[0] = null) {
    act(() => { for (const listener of [...(listeners.get(event) ?? [])]) listener(payload); });
  }
  const clock = controlledClock();
  const { useSpeechInput } = await speechInput('android', 34, appState, native, permissions);

  const options = (index: number) => ({
    preferOnDevice: true,
    onResult: (text: string, final: boolean, alternatives?: readonly string[]) => {
      results[index].push(transcripts[index].push(text, final));
      alternativeResults[index].push(...(alternatives ?? []));
    },
    onEnd: () => transcripts[index].checkpoint(),
    onSpeechStart: () => { speechStarts++; },
  });
  const runtime = renderHook(function useInputs() {
    return [useSpeechInput(options(0)), useSpeechInput(options(1))];
  }, undefined);
  await invoke(() => runtime.result.current[0].start()); await settleReact();
  assert.equal(runtime.result.current[0].isListening, true, 'synchronous start belongs to its initiating hook');
  assert.equal(runtime.result.current[1].isListening, false);
  assert.equal(await invoke(() => runtime.result.current[1].start()), false, 'a competing start cannot strand the listening owner');
  await settleReact();
  assert.equal(runtime.result.current[0].isListening, true);
  assert.equal(runtime.result.current[1].isListening, false);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].lang, 'en-US', 'an empty speech locale follows the system locale');
  emit('speechstart');
  emit('result', { results: [{ transcript: 'Привет' }, { transcript: 'Приветик' }], isFinal: false });
  assert.deepEqual(alternativeResults[0], ['Приветик'], 'lower recognition hypotheses reach the result callback');
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await settleReact();
  assert.equal(clock.countTimers(250), 1);
  assert.match(runtime.result.current[1].error!, /Stop the current voice input/);
  assert.equal(await invoke(() => runtime.result.current[1].start()), false, 'ownership remains reserved during the network retry delay');
  assert.equal(starts.length, 1);
  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].requiresOnDeviceRecognition, false);
  emit('result', { results: [{ transcript: 'мир' }], isFinal: false });
  emit('result', { results: [], isFinal: true });
  emit('result', { results: [{ transcript: 'мир!' }], isFinal: true });
  assert.deepEqual(results[0], ['Привет', 'Привет мир', 'Привет мир', 'Привет мир мир!']);
  assert.deepEqual(results[1], []);
  act(() => runtime.result.current[1].stop()); act(() => runtime.result.current[1].abort());
  assert.equal(stops, 0); assert.equal(aborts, 0);
  act(() => runtime.result.current[0].stop());
  act(() => runtime.result.current[0].stop());
  emit('result', { results: [{ transcript: 'ещё' }], isFinal: true });
  emit('end'); await settleReact();
  assert.equal(results[0].at(-1), 'Привет мир мир! ещё', 'stop drains the final result before end');
  assert.equal(stops, 1);
  await invoke(() => runtime.result.current[1].start()); await settleReact();
  emit('result', { results: [{ transcript: '你好' }], isFinal: true });
  assert.deepEqual(results[1], ['你好']);
  assert.equal(runtime.result.current[0].isListening, false, 'the previous owner ended before ownership moved');
  assert.equal(speechStarts, 1);
  act(() => runtime.result.current[1].abort());
  assert.equal(await invoke(() => runtime.result.current[0].start()), false, 'an aborted live session keeps ownership until its delayed end');
  emit('result', { results: [{ transcript: 'late aborted result' }], isFinal: true });
  assert.deepEqual(results[1], ['你好']);
  emit('error', { error: 'service-not-allowed' });
  emit('start');
  emit('volumechange', { value: 100 });
  await settleReact();
  assert.equal(clock.countTimers(250), 0, 'late errors cannot restart aborted recognition');
  assert.equal(runtime.result.current[1].isListening, false);
  assert.equal(runtime.result.current[1].level, 0);
  emit('end'); await settleReact();
  assert.equal(await invoke(() => runtime.result.current[0].start()), true, 'the next surface starts only after canceled events drain');
  emit('result', { results: [{ transcript: 'new owner' }], isFinal: true });
  assert.equal(results[0].at(-1), 'Привет мир мир! ещё new owner');
  act(() => runtime.result.current[0].abort()); emit('end'); await settleReact();
  let grantPermission!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grantPermission = resolve; });
  permissions.ensure = () => permission;
  const canceledStart = start(() => runtime.result.current[0].start());
  act(() => runtime.result.current[0].abort());
  grantPermission({ granted: true });
  assert.equal(await canceledStart, false, 'cancellation while permission is pending cannot restart recognition');
  assert.equal(starts.length, 4);
  permissions.ensure = async () => ({ granted: true });
  await invoke(() => runtime.result.current[1].start()); await settleReact();
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await settleReact();
  let grantRetry!: (value: { granted: boolean }) => void;
  const retryPermission = new Promise<{ granted: boolean }>((resolve) => { grantRetry = resolve; });
  permissions.ensure = () => retryPermission;
  await clock.advance(250); await settleReact();
  act(() => runtime.result.current[1].stop());
  await invoke(() => grantRetry({ granted: true })); await settleReact();
  assert.equal(runtime.result.current[1].isStarting, false);
  assert.equal(runtime.result.current[1].isListening, false);
  assert.equal(starts.length, 5, 'stopped retry permissions cannot start native recognition');
  permissions.ensure = async () => ({ granted: true });
  assert.equal(await invoke(() => runtime.result.current[0].start()), true, 'stopping permission-only retry releases ownership without another end');
  await settleReact();
  appState.currentState = 'background';
  for (const listener of appStateListeners) listener('background');
  act(() => runtime.result.current[0].abort());
  assert.equal(await invoke(() => runtime.result.current[0].start()), false, 'background recognition cannot restart');
  appState.currentState = 'active';
  const startsBeforeDrain = starts.length;
  const resultsBeforeDrain = results[0].length;
  const restart = start(() => runtime.result.current[0].start());
  await settleReact();
  assert.equal(starts.length, startsBeforeDrain, 'the same owner also waits for its canceled native session to end');
  emit('result', { results: [{ transcript: 'delayed canceled speech' }], isFinal: true });
  assert.equal(results[0].length, resultsBeforeDrain);
  emit('end');
  assert.equal(await restart, true); await settleReact();
  assert.equal(starts.length, startsBeforeDrain + 1);
  runtime.unmount();
  assert.equal(aborts, 4, 'only the active owner aborts on unmount');
  emit('end');
  assert.equal(listeners.get('end')!.size, 0, 'terminal cleanup survives owner unmount');
  assert.equal(appStateListeners.size, 0);
  assert.equal(clock.countTimers(250), 0);
});

it('allows an iOS permission alert to become inactive and still start after permission is granted', async () => {
  let grant!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grant = resolve; });
  let onAppState!: (state: string) => void, onEnd!: Listener, starts = 0;
  const appState = {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => { onAppState = callback; return { remove() {} }; },
  };
  const native = {
        supportsOnDeviceRecognition: () => true, isRecognitionAvailable: () => true,
        addListener: (_event: string, callback: Listener) => { onEnd = callback; return { remove() {} }; },
        start: () => { starts++; }, abort: () => {},
      };
  const { useSpeechInput } = await speechInput('ios', 0, appState, native, { ensure: () => permission, promptActive: true }, false);

  const runtime = renderHook(useSpeechInput, { preferOnDevice: true, onResult: () => {} });
  const pendingStart = start(() => runtime.result.current.start());
  appState.currentState = 'inactive'; await invoke(() => onAppState('inactive'));
  await invoke(() => grant({ granted: true }));
  assert.equal(await pendingStart, true);
  assert.equal(starts, 1);
  runtime.unmount(); await invoke(() => onEnd(null));
});

it('keeps an Android start alive while the permission activity backgrounds the app', async () => {
  let grant!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grant = resolve; });
  let onAppState!: (state: string) => void, starts = 0, aborts = 0;
  const appState = {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => { onAppState = callback; return { remove() {} }; },
  };
  const native = {
        supportsOnDeviceRecognition: () => true, isRecognitionAvailable: () => true,
        addListener: () => ({ remove() {} }),
        start: () => { starts++; }, abort: () => { aborts++; },
      };
  const { useSpeechInput } = await speechInput('android', 36, appState, native, { ensure: () => permission, promptActive: true }, false);

  const runtime = renderHook(useSpeechInput, { preferOnDevice: true, onResult: () => {} });
  const pendingStart = start(() => runtime.result.current.start());
  appState.currentState = 'background'; await invoke(() => onAppState('background'));
  await invoke(() => {
    grant({ granted: true });
    appState.currentState = 'active';
    onAppState('active');
  });
  assert.equal(await pendingStart, true);
  assert.equal(starts, 1);
  assert.equal(aborts, 0);
  runtime.unmount();
});

async function loadAndroidWatchdogHarness({
  services = ['com.samsung.android.bixby.agent', 'com.google.android.tts'],
  emitAbortEnd = true,
  getNativeState = async () => 'inactive',
}: {
  services?: string[];
  emitAbortEnd?: boolean;
  getNativeState?: () => Promise<string>;
} = {}) {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const starts: ExpoSpeechRecognitionOptions[] = [];
  const appState = {
    currentState: 'active',
    addEventListener: () => ({ remove() {} }),
  };
  let aborts = 0;
  let now = 1000;
  const outcomes: Record<string, unknown>[] = [];
  const failures: Record<string, unknown>[] = [];
  const wakeDiagnostics: Record<string, unknown>[] = [];
  const native = {
    addListener: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return { remove: () => listeners.get(event)!.delete(listener) };
    },
    supportsOnDeviceRecognition: () => true,
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    getSpeechRecognitionServices: () => services,
    getStateAsync: getNativeState,
    getDefaultRecognitionService: () => ({ packageName: 'com.samsung.android.bixby.agent' }),
    start: (options: ExpoSpeechRecognitionOptions) => {
      starts.push(options);
      if (starts.length === 3) emit('start');
    },
    stop: () => {},
    abort: () => {
      aborts++;
      emit('error', { error: 'aborted' });
      if (emitAbortEnd) emit('end');
    },
  };
  function emit(event: string, payload: Parameters<Listener>[0] = null) {
    act(() => { for (const listener of [...(listeners.get(event) ?? [])]) listener(payload); });
  }
  const clock = controlledClock();
  const { useSpeechInput } = await speechInput('android', 34, appState, native, undefined, true, {
    debug: (_name: string, attrs: Record<string, unknown>) => wakeDiagnostics.push(attrs),
    info: (_name: string, attrs: Record<string, unknown>) => outcomes.push(attrs),
    captureError: (_error: unknown, attrs: Record<string, unknown>) => failures.push(attrs),
  });
  const date = vi.spyOn(Date, 'now').mockImplementation(() => now);
  onTestFinished(() => { date.mockRestore(); });

  const runtime = renderHook(useSpeechInput, { source: 'conversation', preferOnDevice: true, onResult: () => {} });
  return { runtime, clock, starts, emit, outcomes, failures, wakeDiagnostics, advance: (ms: number) => { now += ms; }, get aborts() { return aborts; } };
}

it('retries an early empty Android end and reports one failure after an early native error exhausts recovery', async () => {
  const { runtime, clock, starts, emit, outcomes, failures } = await loadAndroidWatchdogHarness({ services: [] });
  await invoke(() => runtime.result.current.start());
  emit('start');
  emit('end');
  await settleReact();
  assert.equal(runtime.result.current.isStarting, true);
  assert.equal(outcomes[0].reason, 'early-end');
  assert.equal(outcomes[0].source, 'conversation');

  await clock.advance(250); await settleReact();
  assert.equal(starts[1].continuous, false);
  emit('start');
  emit('error', { error: 'audio-capture', code: 3, message: 'native payload' });
  emit('end'); await settleReact();
  assert.equal(runtime.result.current.startFailed, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].statusCode, 3);
  assert.equal(failures[0].reason, 'audio-capture');
  assert.doesNotMatch(JSON.stringify(failures), /native payload/);
});

it('preserves normal silence, speech, and user cancellation', async () => {
  const { runtime, emit, outcomes, failures, advance } = await loadAndroidWatchdogHarness();
  await invoke(() => runtime.result.current.start());
  emit('start');
  advance(1000);
  emit('end'); await settleReact();
  assert.equal(outcomes.length, 0);
  assert.equal(runtime.result.current.startFailed, false);

  await invoke(() => runtime.result.current.start());
  emit('speechstart');
  emit('end'); await settleReact();
  assert.equal(outcomes.length, 0);

  await invoke(() => runtime.result.current.start());
  act(() => runtime.result.current.abort());
  emit('end'); await settleReact();
  assert.deepEqual(outcomes.map(({ outcome }) => outcome), ['cancelled']);
  assert.equal(failures.length, 0);
});

it('requests unformatted Android wake alternatives on the initial attempt and on retry', async () => {
  const { runtime, clock, starts, emit } = await loadAndroidWatchdogHarness();
  await invoke(() => runtime.result.current.start({ continuous: true, wakeGate: true, contextualStrings: ['hey code'] }));
  assert.equal(starts[0].addsPunctuation, false);
  emit('error', { error: 'language-not-supported', code: 12 });
  emit('end');
  await clock.advance(250); await settleReact();

  assert.equal(starts[1].requiresOnDeviceRecognition, false);
  assert.equal(starts[1].addsPunctuation, false);
  assert.equal(starts[1].contextualStrings?.[0], 'hey code');
  assert.equal(starts[1].continuous, true);
});

it('records separate wake readiness, silence, restart gap, speech and transcript outcomes', async () => {
  const { runtime, emit, wakeDiagnostics, advance } = await loadAndroidWatchdogHarness();
  await invoke(() => runtime.result.current.start({ wakeGate: true }));
  emit('start');
  advance(2000);
  emit('end');
  advance(350);
  await invoke(() => runtime.result.current.start({ wakeGate: true }));
  emit('speechstart');
  emit('end');
  await invoke(() => runtime.result.current.start({ wakeGate: true }));
  emit('result', { isFinal: true, results: [{ transcript: 'ambient non-command' }] });
  emit('end');

  assert.deepEqual(wakeDiagnostics.map(({ outcome }) => outcome), [
    'ready', 'silence', 'restart-gap', 'speech-without-transcript', 'restart-gap', 'transcript',
  ]);
  assert.equal(wakeDiagnostics[2].durationMs, 350);
  assert.doesNotMatch(JSON.stringify(wakeDiagnostics), /ambient non-command/);
});

it('bounds a missing end callback and waits for confirmed native inactivity before retrying', async () => {
  let state = 'stopping';
  const { runtime, clock, starts, emit, failures } = await loadAndroidWatchdogHarness({
    emitAbortEnd: false,
    getNativeState: async () => state,
  });
  await invoke(() => runtime.result.current.start());
  emit('error', { error: 'client', code: 5 });
  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 1);
  await clock.advance(3000); await settleReact();
  assert.equal(runtime.result.current.isStarting, false);
  assert.equal(runtime.result.current.startFailed, true);
  assert.equal(failures[0].reason, 'teardown-timeout');

  state = 'inactive';
  const restart = start(() => runtime.result.current.start());
  await clock.advance(3000); await settleReact();
  assert.equal(await restart, true);
  assert.equal(starts.length, 2);
});

it('recovers a recognizer that never emits start with compatibility and Google service attempts', async () => {
  const { runtime, clock, starts } = await loadAndroidWatchdogHarness();
  assert.equal(await invoke(() => runtime.result.current.start()), true);
  await settleReact();
  assert.equal(starts.length, 1);
  assert.equal(starts[0].continuous, true);
  assert.equal(starts[0].addsPunctuation, true);
  assert.equal(starts[0].requiresOnDeviceRecognition, true);
  assert.equal(runtime.result.current.isStarting, true, 'a start without a native start event stays pending');

  await clock.advance(3000); await settleReact();
  assert.equal(starts.length, 1, 'the watchdog does not start a second session before the retry delay');
  assert.equal(runtime.result.current.isStarting, true);
  assert.equal(clock.countTimers(250), 1);

  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].continuous, false, 'compatibility mode bypasses the custom audio recorder');
  assert.equal(starts[1].addsPunctuation, false);
  assert.equal(starts[1].requiresOnDeviceRecognition, false);
  assert.equal(starts[1].androidRecognitionServicePackage, undefined);

  await clock.advance(3000); await settleReact();
  assert.equal(clock.countTimers(250), 1);
  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 3);
  assert.equal(starts[2].androidRecognitionServicePackage, 'com.google.android.tts');
  assert.equal(runtime.result.current.isListening, true);
  assert.equal(runtime.result.current.isStarting, false);
  assert.equal(runtime.result.current.startFailed, false);
  assert.equal(clock.countTimers(3000), 0);
  assert.equal(clock.countTimers(250), 0);
});

it('surfaces a retryable start failure when no Android recovery is available', async () => {
  const { runtime, clock, starts } = await loadAndroidWatchdogHarness({ services: [] });
  await invoke(() => runtime.result.current.start());
  await settleReact();
  await clock.advance(3000); await settleReact();
  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 2);
  await clock.advance(3000); await settleReact();
  assert.equal(starts.length, 2);
  assert.equal(runtime.result.current.isStarting, false);
  assert.equal(runtime.result.current.isListening, false);
  assert.equal(runtime.result.current.startFailed, true);
  assert.match(runtime.result.current.error!, /did not respond/);
  assert.equal(runtime.result.current.errorAction, 'retry');
  assert.equal(clock.countTimers(3000), 0);
  assert.equal(clock.countTimers(250), 0);
});

it('recovers when the recognizer ends before emitting start', async () => {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const starts: ExpoSpeechRecognitionOptions[] = [];
  const native = {
    addListener: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return { remove: () => listeners.get(event)!.delete(listener) };
    },
    supportsOnDeviceRecognition: () => false,
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    getSpeechRecognitionServices: () => [],
    getDefaultRecognitionService: () => ({ packageName: 'com.google.android.tts' }),
    start: (options: ExpoSpeechRecognitionOptions) => {
      starts.push(options);
      if (starts.length === 1) emit('end');
      else emit('start');
    },
    stop: () => {},
    abort: () => {},
  };
  function emit(event: string, payload: Parameters<Listener>[0] = null) {
    act(() => { for (const listener of [...(listeners.get(event) ?? [])]) listener(payload); });
  }
  const clock = controlledClock();
  const { useSpeechInput } = await speechInput('android', 33, { currentState: 'active', addEventListener: () => ({ remove() {} }) }, native);

  const runtime = renderHook(useSpeechInput, { preferOnDevice: false, onResult: () => {} });
  assert.equal(await invoke(() => runtime.result.current.start()), true);
  await settleReact();
  assert.equal(starts.length, 1);
  assert.equal(clock.countTimers(250), 1, 'an end before start schedules a compatibility retry');
  await clock.advance(250); await settleReact();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].continuous, false);
  assert.equal(runtime.result.current.isListening, true);
  assert.equal(runtime.result.current.startFailed, false);
});
