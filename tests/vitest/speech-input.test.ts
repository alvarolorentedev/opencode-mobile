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
  let stops = 0, aborts = 0, identity = 0, speechStarts = 0;
  const transcripts = [createTranscriptAccumulator(), createTranscriptAccumulator()];
  const results: string[][] = [[], []];
  const native = {
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
    'react-native': { Platform: { OS: 'android' } },
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
  emit('result', { results: [{ transcript: 'late aborted result' }], isFinal: true });
  assert.deepEqual(results[1], ['你好']);
  emit('error', { error: 'service-not-allowed' });
  emit('start');
  await runtime.settle();
  assert.equal(runtime.countTimers(250), 0, 'late errors cannot restart aborted recognition');
  assert.equal(runtime.value[1].isListening, false);
  let grantPermission!: (value: { granted: boolean }) => void;
  const permission = new Promise<{ granted: boolean }>((resolve) => { grantPermission = resolve; });
  native.requestPermissionsAsync = () => permission;
  const canceledStart = runtime.value[0].start();
  runtime.value[0].abort();
  grantPermission({ granted: true });
  assert.equal(await canceledStart, false, 'cancellation while permission is pending cannot restart recognition');
  assert.equal(starts.length, 3);
  native.requestPermissionsAsync = async () => ({ granted: true });
  await runtime.value[1].start(); await runtime.settle();
  emit('error', { error: 'service-not-allowed' });
  emit('end'); await runtime.settle();
  native.requestPermissionsAsync = async () => { throw new Error('permission request failed'); };
  runtime.fire(250); await runtime.settle();
  assert.equal(runtime.value[1].isStarting, false);
  assert.equal(runtime.value[1].isListening, false);
  native.requestPermissionsAsync = async () => ({ granted: true });
  assert.equal(await runtime.value[0].start(), true, 'a failed retry releases ownership for the next surface');
  await runtime.settle();
  runtime.unmount();
  assert.equal(aborts, 2, 'only the active owner aborts on unmount');
  assert.equal(runtime.countTimers(250), 0);
});
