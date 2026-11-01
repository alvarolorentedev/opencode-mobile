import assert from 'node:assert/strict';
import { it } from 'vitest';

import { loadTs } from '../../../../tests/helpers/runtime.mjs';

it('selects Android compatibility and Google-recognizer recovery attempts', async () => {
  const module = await loadTs('shared/platform/voice/recognition-service.ts', {
    'react-native': { Platform: { OS: 'android', Version: 34 } },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: {} },
  });
  const bixby = 'com.samsung.android.bixby.agent';
  const base = {
    apiLevel: 34,
    defaultService: bixby,
    platform: 'android',
    services: [bixby, 'com.google.android.tts', 'com.google.android.googlequicksearchbox'],
  };

  assert.equal(module.nextStartAttempt({}, { ...base, platform: 'ios' }), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(module.nextStartAttempt({}, base))), { compatibility: true, forceNetwork: true });
  assert.deepEqual(
    JSON.parse(JSON.stringify(module.nextStartAttempt({ compatibility: true }, base))),
    { compatibility: true, forceNetwork: true, servicePackage: 'com.google.android.tts' },
  );
  assert.equal(
    module.nextStartAttempt({ compatibility: true, servicePackage: 'com.google.android.tts' }, base),
    undefined,
    'each recovery stage runs once',
  );

  // The default service is never retried, and API 33+ prefers the modern
  // Speech Recognition & Synthesis package.
  assert.equal(
    module.preferredGoogleRecognitionPackage({ apiLevel: 34, defaultService: 'com.google.android.tts', services: base.services }),
    'com.google.android.googlequicksearchbox',
  );
  assert.equal(
    module.preferredGoogleRecognitionPackage({ apiLevel: 30, defaultService: bixby, services: [bixby, 'com.google.android.googlequicksearchbox'] }),
    'com.google.android.googlequicksearchbox',
  );
  assert.equal(module.preferredGoogleRecognitionPackage({ apiLevel: 34, defaultService: bixby, services: [bixby] }), undefined);
});

it('reads recognition services defensively', async () => {
  const available = await loadTs('shared/platform/voice/recognition-service.ts', {
    'react-native': { Platform: { OS: 'android', Version: 35 } },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: {
        getSpeechRecognitionServices: () => ['com.google.android.tts'],
        getDefaultRecognitionService: () => ({ packageName: 'com.google.android.tts' }),
      },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(available.readRecognitionServices())), {
    apiLevel: 35,
    defaultService: 'com.google.android.tts',
    services: ['com.google.android.tts'],
  });

  const broken = await loadTs('shared/platform/voice/recognition-service.ts', {
    'react-native': { Platform: { OS: 'android', Version: 35 } },
    'expo-speech-recognition': {
      ExpoSpeechRecognitionModule: {
        getSpeechRecognitionServices: () => { throw new Error('not visible'); },
        getDefaultRecognitionService: () => { throw new Error('not visible'); },
      },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(broken.readRecognitionServices())), { apiLevel: 35, services: [] });

  const ios = await loadTs('shared/platform/voice/recognition-service.ts', {
    'react-native': { Platform: { OS: 'ios', Version: '18.0' } },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: {} },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(ios.readRecognitionServices())), { apiLevel: 0, services: [] });
});
