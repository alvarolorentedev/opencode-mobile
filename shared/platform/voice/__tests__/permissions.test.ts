import assert from 'node:assert/strict';
import { it } from 'vitest';
import { loadTs } from '../../../../tests/helpers/runtime.mjs';

async function permissionsHarness({
  canAskAgain = true,
  currentState = 'active',
  granted = false,
  restricted = false,
} = {}) {
  const listeners = new Set<(state: string) => void>();
  const appState = {
    currentState,
    addEventListener: (_event: string, listener: (state: string) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const calls = { local: 0, speech: 0 };
  let localRequest = async () => {
    calls.local++;
    return { granted: true, canAskAgain: true, restricted: false };
  };
  let speechRequest = async () => {
    calls.speech++;
    return { granted: true, canAskAgain: true, restricted: false };
  };
  const module = await loadTs('shared/platform/voice/permissions.ts', {
    'react-native': { AppState: appState },
    'expo-linking': { openSettings: async () => undefined },
    'expo-audio': {
      getRecordingPermissionsAsync: async () => ({ granted, canAskAgain, restricted }),
      requestRecordingPermissionsAsync: () => localRequest(),
    },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: {
        getPermissionsAsync: async () => ({ granted, canAskAgain, restricted }),
        requestPermissionsAsync: () => speechRequest(),
      },
    },
  });
  const emit = (state: string) => {
    appState.currentState = state;
    for (const listener of listeners) listener(state);
  };
  return {
    appState,
    calls,
    emit,
    module,
    setLocalRequest: (request: typeof localRequest) => { localRequest = request; },
    setSpeechRequest: (request: typeof speechRequest) => { speechRequest = request; },
  };
}

it('does not open the permission activity when the microphone is already granted', async () => {
  const harness = await permissionsHarness({ granted: true });

  const speech = await harness.module.ensureVoiceInputPermissionAsync();
  const local = await harness.module.ensureLocalVoicePermissionAsync();

  assert.equal(speech.granted, true);
  assert.equal(local.granted, true);
  assert.equal(harness.calls.speech, 0);
  assert.equal(harness.calls.local, 0);
  assert.equal(harness.module.isVoicePermissionPromptActive(), false);
});

it('does not prompt after the user blocked the permission', async () => {
  const harness = await permissionsHarness({ granted: false, canAskAgain: false });

  const result = await harness.module.ensureVoiceInputPermissionAsync();

  assert.equal(result.granted, false);
  assert.equal(harness.calls.speech, 0);
});

it('keeps the permission prompt marked active until Android resumes the app', async () => {
  const harness = await permissionsHarness({ granted: false });
  let grant!: (value: { granted: boolean; canAskAgain: boolean; restricted: boolean }) => void;
  harness.setSpeechRequest(() => {
    harness.calls.speech++;
    return new Promise((resolve) => { grant = resolve; });
  });

  const pending = harness.module.ensureVoiceInputPermissionAsync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.calls.speech, 1);
  assert.equal(harness.module.isVoicePermissionPromptActive(), true);

  harness.emit('background');
  grant({ granted: true, canAskAgain: true, restricted: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    harness.module.isVoicePermissionPromptActive(),
    true,
    'the prompt stays active while the host activity is paused',
  );

  harness.emit('active');
  const result = await pending;
  assert.equal(result.granted, true);
  assert.equal(harness.module.isVoicePermissionPromptActive(), false);
});
