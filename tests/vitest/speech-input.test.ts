import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';
import { createTranscriptAccumulator } from '@/lib/voice/transcript-accumulate';

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
  const speech = await loadTs('lib/voice/use-speech-input.ts', {
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
    '@/lib/voice/speech-errors': await loadTs('lib/voice/speech-errors.ts'),
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
  native.requestPermissionsAsync = () => permission;
  const canceledStart = runtime.value[0].start();
  runtime.value[0].abort();
  grantPermission({ granted: true });
  assert.equal(await canceledStart, false, 'cancellation while permission is pending cannot restart recognition');
  assert.equal(starts.length, 4);
  native.requestPermissionsAsync = async () => ({ granted: true });
  await runtime.value[1].start(); await runtime.settle();
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await runtime.settle();
  let grantRetry!: (value: { granted: boolean }) => void;
  const retryPermission = new Promise<{ granted: boolean }>((resolve) => { grantRetry = resolve; });
  native.requestPermissionsAsync = () => retryPermission;
  runtime.fire(250); await runtime.settle();
  runtime.value[1].stop();
  grantRetry({ granted: true }); await runtime.settle();
  assert.equal(runtime.value[1].isStarting, false);
  assert.equal(runtime.value[1].isListening, false);
  assert.equal(starts.length, 5, 'stopped retry permissions cannot start native recognition');
  native.requestPermissionsAsync = async () => ({ granted: true });
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
  const speech = await loadTs('lib/voice/use-speech-input.ts', {
    react: { ...runtime.react, useId: () => 'permission-owner' },
    'react-native': { Platform: { OS: 'ios' }, AppState: appState },
    'expo-speech-recognition': {
      useSpeechRecognitionEvent: () => {},
      ExpoSpeechRecognitionModule: {
        supportsOnDeviceRecognition: () => true, isRecognitionAvailable: () => true,
        requestPermissionsAsync: () => permission,
        addListener: (_event: string, callback: () => void) => { onEnd = callback; return { remove() {} }; },
        start: () => { starts++; }, abort: () => {},
      },
    },
    '@/lib/voice/speech-errors': await loadTs('lib/voice/speech-errors.ts'),
  }, runtime.globals);
  runtime.mount(speech.useSpeechInput, { preferOnDevice: true, onResult: () => {} });
  const pendingStart = runtime.value.start();
  appState.currentState = 'inactive'; onAppState('inactive');
  grant({ granted: true });
  assert.equal(await pendingStart, true);
  assert.equal(starts, 1);
  runtime.unmount(); onEnd();
});
