import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';
import { hookRuntime, loadTs } from '../../../../tests/helpers/runtime.mjs';
import { createTranscriptAccumulator } from '@/shared/platform/voice/transcript-accumulate';

it('isolates recognition owners through competing starts, cancellation and network fallback', async () => {
  const runtime = hookRuntime();
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const starts: ExpoSpeechRecognitionOptions[] = [];
  const appStateListeners = new Set<(state: string) => void>();
  const appState = { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  } };
  let stops = 0, aborts = 0, identity = 0, speechStarts = 0;
  const transcripts = [createTranscriptAccumulator(), createTranscriptAccumulator()];
  const results: string[][] = [[], []];
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
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  }
  const speech = await loadTs('shared/platform/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => runtime.react.useRef(`owner-${identity++}`).current },
    'react-native': {
      Platform: { OS: 'android' },
      AppState: appState,
    },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: native,
      useSpeechRecognitionEvent: (event: string, listener: Listener) => runtime.react.useEffect(() => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return () => listeners.get(event)!.delete(listener);
      }, [event, listener]),
    },
    '@/shared/platform/voice/permissions': {
      ensureVoiceInputPermissionAsync: () => permissions.ensure(),
      isVoicePermissionPromptActive: () => permissions.promptActive,
    },
    '@/shared/platform/voice/speech-errors': await loadTs('shared/platform/voice/speech-errors.ts')
  }, runtime.globals);
  const options = (index: number) => ({
    preferOnDevice: true,
    onResult: (text: string, final: boolean) => results[index].push(transcripts[index].push(text, final)),
    onEnd: () => transcripts[index].checkpoint(),
    onSpeechStart: () => { speechStarts++; },
  });
  runtime.mount(function useInputs() {
    return [speech.useSpeechInput(options(0)), speech.useSpeechInput(options(1))];
  }, {});
  await runtime.value[0].start(); await runtime.settle();
  assert.equal(runtime.value[0].isListening, true, 'synchronous start belongs to its initiating hook');
  assert.equal(runtime.value[1].isListening, false);
  assert.equal(await runtime.value[1].start(), false, 'a competing start cannot strand the listening owner');
  await runtime.settle();
  assert.equal(runtime.value[0].isListening, true);
  assert.equal(runtime.value[1].isListening, false);
  assert.equal(starts.length, 1);
  emit('speechstart');
  emit('result', { results: [{ transcript: 'Привет' }], isFinal: false });
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await runtime.settle();
  assert.equal(runtime.countTimers(250), 1);
  assert.match(runtime.value[1].error, /Stop the current voice input/);
  assert.equal(await runtime.value[1].start(), false, 'ownership remains reserved during the network retry delay');
  assert.equal(starts.length, 1);
  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].requiresOnDeviceRecognition, false);
  emit('result', { results: [{ transcript: 'мир' }], isFinal: false });
  emit('result', { results: [], isFinal: true });
  emit('result', { results: [{ transcript: 'мир!' }], isFinal: true });
  assert.deepEqual(results[0], ['Привет', 'Привет мир', 'Привет мир', 'Привет мир мир!']);
  assert.deepEqual(results[1], []);
  runtime.value[1].stop(); runtime.value[1].abort();
  assert.equal(stops, 0); assert.equal(aborts, 0);
  runtime.value[0].stop();
  runtime.value[0].stop();
  emit('result', { results: [{ transcript: 'ещё' }], isFinal: true });
  emit('end'); await runtime.settle();
  assert.equal(results[0].at(-1), 'Привет мир мир! ещё', 'stop drains the final result before end');
  assert.equal(stops, 1);
  await runtime.value[1].start(); await runtime.settle();
  emit('result', { results: [{ transcript: '你好' }], isFinal: true });
  assert.deepEqual(results[1], ['你好']);
  assert.equal(runtime.value[0].isListening, false, 'the previous owner ended before ownership moved');
  assert.equal(speechStarts, 1);
  runtime.value[1].abort();
  assert.equal(await runtime.value[0].start(), false, 'an aborted live session keeps ownership until its delayed end');
  emit('result', { results: [{ transcript: 'late aborted result' }], isFinal: true });
  assert.deepEqual(results[1], ['你好']);
  emit('error', { error: 'service-not-allowed' });
  emit('start');
  emit('volumechange', { value: 100 });
  await runtime.settle();
  assert.equal(runtime.countTimers(250), 0, 'late errors cannot restart aborted recognition');
  assert.equal(runtime.value[1].isListening, false);
  assert.equal(runtime.value[1].level, 0);
  emit('end'); await runtime.settle();
  assert.equal(await runtime.value[0].start(), true, 'the next surface starts only after canceled events drain');
  emit('result', { results: [{ transcript: 'new owner' }], isFinal: true });
  assert.equal(results[0].at(-1), 'Привет мир мир! ещё new owner');
  runtime.value[0].abort(); emit('end'); await runtime.settle();
  let grantPermission!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grantPermission = resolve; });
  permissions.ensure = () => permission;
  const canceledStart = runtime.value[0].start();
  runtime.value[0].abort();
  grantPermission({ granted: true });
  assert.equal(await canceledStart, false, 'cancellation while permission is pending cannot restart recognition');
  assert.equal(starts.length, 4);
  permissions.ensure = async () => ({ granted: true });
  await runtime.value[1].start(); await runtime.settle();
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await runtime.settle();
  let grantRetry!: (value: { granted: boolean }) => void;
  const retryPermission = new Promise<{ granted: boolean }>((resolve) => { grantRetry = resolve; });
  permissions.ensure = () => retryPermission;
  runtime.fire(250); await runtime.settle();
  runtime.value[1].stop();
  grantRetry({ granted: true }); await runtime.settle();
  assert.equal(runtime.value[1].isStarting, false);
  assert.equal(runtime.value[1].isListening, false);
  assert.equal(starts.length, 5, 'stopped retry permissions cannot start native recognition');
  permissions.ensure = async () => ({ granted: true });
  assert.equal(await runtime.value[0].start(), true, 'stopping permission-only retry releases ownership without another end');
  await runtime.settle();
  appState.currentState = 'background';
  for (const listener of appStateListeners) listener('background');
  runtime.value[0].abort();
  assert.equal(await runtime.value[0].start(), false, 'background recognition cannot restart');
  appState.currentState = 'active';
  const startsBeforeDrain = starts.length;
  const resultsBeforeDrain = results[0].length;
  const restart = runtime.value[0].start();
  await runtime.settle();
  assert.equal(starts.length, startsBeforeDrain, 'the same owner also waits for its canceled native session to end');
  emit('result', { results: [{ transcript: 'delayed canceled speech' }], isFinal: true });
  assert.equal(results[0].length, resultsBeforeDrain);
  emit('end');
  assert.equal(await restart, true); await runtime.settle();
  assert.equal(starts.length, startsBeforeDrain + 1);
  runtime.unmount();
  assert.equal(aborts, 4, 'only the active owner aborts on unmount');
  emit('end');
  assert.equal(listeners.get('end')!.size, 0, 'terminal cleanup survives owner unmount');
  assert.equal(appStateListeners.size, 0);
  assert.equal(runtime.countTimers(250), 0);
});

it('allows an iOS permission alert to become inactive and still start after permission is granted', async () => {
  const runtime = hookRuntime();
  let grant!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grant = resolve; });
  let onAppState!: (state: string) => void, onEnd!: () => void, starts = 0;
  const appState = {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => { onAppState = callback; return { remove() {} }; },
  };
  const speech = await loadTs('shared/platform/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => 'permission-owner' },
    'react-native': { Platform: { OS: 'ios' }, AppState: appState },
    'expo-speech-recognition': {
      useSpeechRecognitionEvent: () => {},
      ExpoSpeechRecognitionModule: {
        supportsOnDeviceRecognition: () => true, isRecognitionAvailable: () => true,
        addListener: (_event: string, callback: () => void) => { onEnd = callback; return { remove() {} }; },
        start: () => { starts++; }, abort: () => {},
      },
    },
    '@/shared/platform/voice/permissions': {
      ensureVoiceInputPermissionAsync: () => permission,
      isVoicePermissionPromptActive: () => true,
    },
    '@/shared/platform/voice/speech-errors': await loadTs('shared/platform/voice/speech-errors.ts')
  }, runtime.globals);
  runtime.mount(speech.useSpeechInput, { preferOnDevice: true, onResult: () => {} });
  const pendingStart = runtime.value.start();
  appState.currentState = 'inactive'; onAppState('inactive');
  grant({ granted: true });
  assert.equal(await pendingStart, true);
  assert.equal(starts, 1);
  runtime.unmount(); onEnd();
});

it('keeps an Android start alive while the permission activity backgrounds the app', async () => {
  const runtime = hookRuntime();
  let grant!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grant = resolve; });
  let onAppState!: (state: string) => void, starts = 0, aborts = 0;
  const appState = {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => { onAppState = callback; return { remove() {} }; },
  };
  const speech = await loadTs('shared/platform/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => 'permission-background-owner' },
    'react-native': { Platform: { OS: 'android', Version: 36 }, AppState: appState },
    'expo-speech-recognition': {
      useSpeechRecognitionEvent: () => {},
      ExpoSpeechRecognitionModule: {
        supportsOnDeviceRecognition: () => true, isRecognitionAvailable: () => true,
        addListener: () => ({ remove() {} }),
        start: () => { starts++; }, abort: () => { aborts++; },
      },
    },
    '@/shared/platform/voice/permissions': {
      ensureVoiceInputPermissionAsync: () => permission,
      isVoicePermissionPromptActive: () => true,
    },
    '@/shared/platform/voice/speech-errors': await loadTs('shared/platform/voice/speech-errors.ts'),
  }, runtime.globals);
  runtime.mount(speech.useSpeechInput, { preferOnDevice: true, onResult: () => {} });
  const pendingStart = runtime.value.start();
  appState.currentState = 'background'; onAppState('background');
  grant({ granted: true });
  appState.currentState = 'active'; onAppState('active');
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
  const runtime = hookRuntime();
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
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  }
  const speech = await loadTs('shared/platform/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => 'watchdog-owner' },
    'react-native': { Platform: { OS: 'android', Version: 34 }, AppState: appState },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: native,
      useSpeechRecognitionEvent: (event: string, listener: Listener) => runtime.react.useEffect(() => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return () => listeners.get(event)!.delete(listener);
      }, [event, listener]),
    },
    '@/shared/platform/voice/permissions': {
      ensureVoiceInputPermissionAsync: async () => ({ granted: true }),
      isVoicePermissionPromptActive: () => false,
    },
    '@/shared/platform/voice/speech-errors': await loadTs('shared/platform/voice/speech-errors.ts'),
    '@/shared/observability/client': {
      telemetry: {
        info: (_name: string, attrs: Record<string, unknown>) => outcomes.push(attrs),
        captureError: (_error: unknown, attrs: Record<string, unknown>) => failures.push(attrs),
      },
    },
  }, { ...runtime.globals, Date: { now: () => now } });
  runtime.mount(speech.useSpeechInput, { source: 'conversation', preferOnDevice: true, onResult: () => {} });
  return { runtime, starts, emit, outcomes, failures, advance: (ms: number) => { now += ms; }, get aborts() { return aborts; } };
}

it('retries an early empty Android end and reports one failure after an early native error exhausts recovery', async () => {
  const { runtime, starts, emit, outcomes, failures } = await loadAndroidWatchdogHarness({ services: [] });
  await runtime.value.start();
  emit('start');
  emit('end');
  await runtime.settle();
  assert.equal(runtime.value.isStarting, true);
  assert.equal(outcomes[0].reason, 'early-end');
  assert.equal(outcomes[0].source, 'conversation');

  runtime.fire(250); await runtime.settle();
  assert.equal(starts[1].continuous, false);
  emit('start');
  emit('error', { error: 'audio-capture', code: 3, message: 'native payload' });
  emit('end'); await runtime.settle();
  assert.equal(runtime.value.startFailed, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].statusCode, 3);
  assert.equal(failures[0].reason, 'audio-capture');
  assert.doesNotMatch(JSON.stringify(failures), /native payload/);
});

it('preserves normal silence, speech, and user cancellation', async () => {
  const { runtime, emit, outcomes, failures, advance } = await loadAndroidWatchdogHarness();
  await runtime.value.start();
  emit('start');
  advance(1000);
  emit('end'); await runtime.settle();
  assert.equal(outcomes.length, 0);
  assert.equal(runtime.value.startFailed, false);

  await runtime.value.start();
  emit('speechstart');
  emit('end'); await runtime.settle();
  assert.equal(outcomes.length, 0);

  await runtime.value.start();
  runtime.value.abort();
  emit('end'); await runtime.settle();
  assert.deepEqual(outcomes.map(({ outcome }) => outcome), ['cancelled']);
  assert.equal(failures.length, 0);
});

it('bounds a missing end callback and waits for confirmed native inactivity before retrying', async () => {
  let state = 'stopping';
  const { runtime, starts, emit, failures } = await loadAndroidWatchdogHarness({
    emitAbortEnd: false,
    getNativeState: async () => state,
  });
  await runtime.value.start();
  emit('error', { error: 'client', code: 5 });
  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 1);
  runtime.fire(3000); await runtime.settle();
  assert.equal(runtime.value.isStarting, false);
  assert.equal(runtime.value.startFailed, true);
  assert.equal(failures[0].reason, 'teardown-timeout');

  state = 'inactive';
  const restart = runtime.value.start();
  runtime.fire(3000); await runtime.settle();
  assert.equal(await restart, true);
  assert.equal(starts.length, 2);
});

it('recovers a recognizer that never emits start with compatibility and Google service attempts', async () => {
  const { runtime, starts } = await loadAndroidWatchdogHarness();
  assert.equal(await runtime.value.start(), true);
  await runtime.settle();
  assert.equal(starts.length, 1);
  assert.equal(starts[0].continuous, true);
  assert.equal(starts[0].addsPunctuation, true);
  assert.equal(starts[0].requiresOnDeviceRecognition, true);
  assert.equal(runtime.value.isStarting, true, 'a start without a native start event stays pending');

  runtime.fire(3000); await runtime.settle();
  assert.equal(starts.length, 1, 'the watchdog does not start a second session before the retry delay');
  assert.equal(runtime.value.isStarting, true);
  assert.equal(runtime.countTimers(250), 1);

  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].continuous, false, 'compatibility mode bypasses the custom audio recorder');
  assert.equal(starts[1].addsPunctuation, false);
  assert.equal(starts[1].requiresOnDeviceRecognition, false);
  assert.equal(starts[1].androidRecognitionServicePackage, undefined);

  runtime.fire(3000); await runtime.settle();
  assert.equal(runtime.countTimers(250), 1);
  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 3);
  assert.equal(starts[2].androidRecognitionServicePackage, 'com.google.android.tts');
  assert.equal(runtime.value.isListening, true);
  assert.equal(runtime.value.isStarting, false);
  assert.equal(runtime.value.startFailed, false);
  assert.equal(runtime.countTimers(3000), 0);
  assert.equal(runtime.countTimers(250), 0);
});

it('surfaces a retryable start failure when no Android recovery is available', async () => {
  const { runtime, starts } = await loadAndroidWatchdogHarness({ services: [] });
  await runtime.value.start();
  await runtime.settle();
  runtime.fire(3000); await runtime.settle();
  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 2);
  runtime.fire(3000); await runtime.settle();
  assert.equal(starts.length, 2);
  assert.equal(runtime.value.isStarting, false);
  assert.equal(runtime.value.isListening, false);
  assert.equal(runtime.value.startFailed, true);
  assert.match(runtime.value.error, /did not respond/);
  assert.equal(runtime.value.errorAction, 'retry');
  assert.equal(runtime.countTimers(3000), 0);
  assert.equal(runtime.countTimers(250), 0);
});

it('recovers when the recognizer ends before emitting start', async () => {
  const runtime = hookRuntime();
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
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  }
  const speech = await loadTs('shared/platform/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => 'ended-owner' },
    'react-native': { Platform: { OS: 'android', Version: 33 }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: native,
      useSpeechRecognitionEvent: (event: string, listener: Listener) => runtime.react.useEffect(() => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return () => listeners.get(event)!.delete(listener);
      }, [event, listener]),
    },
    '@/shared/platform/voice/permissions': {
      ensureVoiceInputPermissionAsync: async () => ({ granted: true }),
      isVoicePermissionPromptActive: () => false,
    },
    '@/shared/platform/voice/speech-errors': await loadTs('shared/platform/voice/speech-errors.ts'),
  }, runtime.globals);
  runtime.mount(speech.useSpeechInput, { preferOnDevice: false, onResult: () => {} });
  assert.equal(await runtime.value.start(), true);
  await runtime.settle();
  assert.equal(starts.length, 1);
  assert.equal(runtime.countTimers(250), 1, 'an end before start schedules a compatibility retry');
  runtime.fire(250); await runtime.settle();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].continuous, false);
  assert.equal(runtime.value.isListening, true);
  assert.equal(runtime.value.startFailed, false);
});
