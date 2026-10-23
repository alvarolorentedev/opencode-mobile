import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { canFallbackToNetwork, describeVoiceInputError } from '@/lib/voice/speech-errors';

// Pure error-classification logic for voice input. The hook and native module
// are not exercised here; this locks the recovery policy that UI surfaces and
// the on-device -> network fallback depend on.
//
// Migrated from the standalone tests/voice-errors.test.mjs Node script.
describe('voice input error classification', () => {
  it('classifies failures into recovery actions and network fallbacks', () => {
    // On-device failures are the only ones worth one automatic network retry.
    assert.equal(canFallbackToNetwork('service-not-allowed', true), true);
    assert.equal(canFallbackToNetwork('language-not-supported', true), true);
    assert.equal(canFallbackToNetwork('service-not-allowed', false), false);
    assert.equal(canFallbackToNetwork('not-allowed', true), false);
    assert.equal(canFallbackToNetwork(undefined, true), false);

    const permissionContext = { canAskAgain: true, onDeviceRequested: false, restricted: false };
    assert.deepEqual(describeVoiceInputError('not-allowed', undefined, permissionContext), {
      action: 'retry',
      message: 'Microphone or speech recognition access is needed for voice input. Try again to allow it.',
      retryable: true,
    });

    // After a denial the OS will not prompt again, so send the user to Settings.
    assert.equal(
      describeVoiceInputError('not-allowed', undefined, { ...permissionContext, canAskAgain: false }).action,
      'open-settings',
    );

    // A managed device cannot be fixed by the user.
    assert.equal(
      describeVoiceInputError('not-allowed', undefined, { ...permissionContext, restricted: true }).action,
      'none',
    );

    // Siri/Dictation disabled or a missing model; retry is actionable.
    assert.equal(describeVoiceInputError('service-not-allowed', undefined, permissionContext).action, 'retry');
    assert.equal(describeVoiceInputError('network', undefined, permissionContext).action, 'retry');
    assert.equal(describeVoiceInputError('audio-capture', undefined, permissionContext).action, 'retry');
    assert.equal(describeVoiceInputError('interrupted', undefined, permissionContext).action, 'retry');
    assert.equal(describeVoiceInputError('no-speech', undefined, permissionContext).action, 'retry');
    assert.equal(describeVoiceInputError('busy', undefined, permissionContext).action, 'retry');

    // A completely unsupported locale is not retryable as-is.
    assert.equal(describeVoiceInputError('language-not-supported', undefined, permissionContext).action, 'none');

    // Unknown errors keep the native message when provided.
    assert.deepEqual(describeVoiceInputError(undefined, 'boom', permissionContext), {
      action: 'retry',
      message: 'boom',
      retryable: true,
    });
  });
});
