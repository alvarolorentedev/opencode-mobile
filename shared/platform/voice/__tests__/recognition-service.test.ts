import assert from 'node:assert/strict';
import { it, vi } from 'vitest';

import * as services from '@/shared/platform/voice/recognition-service';

const native = vi.hoisted(() => ({
  Platform: { OS: 'android', Version: 34 as number | string },
  ExpoSpeechRecognitionModule: {
    getSpeechRecognitionServices: vi.fn(),
    getDefaultRecognitionService: vi.fn(),
  },
}));
vi.mock('react-native', () => ({ Platform: native.Platform }));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: native.ExpoSpeechRecognitionModule }));

it('selects Android compatibility and Google-recognizer recovery attempts', async () => {
  const bixby = 'com.samsung.android.bixby.agent';
  const base = {
    apiLevel: 34,
    defaultService: bixby,
    platform: 'android',
    services: [bixby, 'com.google.android.tts', 'com.google.android.googlequicksearchbox'],
  };

  assert.equal(services.nextStartAttempt({}, { ...base, platform: 'ios' }), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(services.nextStartAttempt({}, base))), { compatibility: true, forceNetwork: true });
  assert.deepEqual(
    JSON.parse(JSON.stringify(services.nextStartAttempt({ compatibility: true }, base))),
    { compatibility: true, forceNetwork: true, servicePackage: 'com.google.android.tts' },
  );
  assert.equal(
    services.nextStartAttempt({ compatibility: true, servicePackage: 'com.google.android.tts' }, base),
    undefined,
    'each recovery stage runs once',
  );

  // The default service is never retried, and API 33+ prefers the modern
  // Speech Recognition & Synthesis package.
  assert.equal(
    services.preferredGoogleRecognitionPackage({ apiLevel: 34, defaultService: 'com.google.android.tts', services: base.services }),
    'com.google.android.googlequicksearchbox',
  );
  assert.equal(
    services.preferredGoogleRecognitionPackage({ apiLevel: 30, defaultService: bixby, services: [bixby, 'com.google.android.googlequicksearchbox'] }),
    'com.google.android.googlequicksearchbox',
  );
  assert.equal(services.preferredGoogleRecognitionPackage({ apiLevel: 34, defaultService: bixby, services: [bixby] }), undefined);
});

it('reads recognition services defensively', async () => {
  native.Platform.Version = 35;
  native.ExpoSpeechRecognitionModule.getSpeechRecognitionServices.mockReturnValue(['com.google.android.tts']);
  native.ExpoSpeechRecognitionModule.getDefaultRecognitionService.mockReturnValue({ packageName: 'com.google.android.tts' });
  assert.deepEqual(JSON.parse(JSON.stringify(services.readRecognitionServices())), {
    apiLevel: 35,
    defaultService: 'com.google.android.tts',
    services: ['com.google.android.tts'],
  });

  native.ExpoSpeechRecognitionModule.getSpeechRecognitionServices.mockImplementation(() => { throw new Error('not visible'); });
  native.ExpoSpeechRecognitionModule.getDefaultRecognitionService.mockImplementation(() => { throw new Error('not visible'); });
  assert.deepEqual(JSON.parse(JSON.stringify(services.readRecognitionServices())), { apiLevel: 35, services: [] });

  Object.assign(native.Platform, { OS: 'ios', Version: '18.0' });
  assert.deepEqual(JSON.parse(JSON.stringify(services.readRecognitionServices())), { apiLevel: 0, services: [] });
});
