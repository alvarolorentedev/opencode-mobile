// @vitest-environment happy-dom

import { audioFixture } from '../../../../tests/helpers/local-audio-probe';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { useLocalVoiceEnrollment } from '@/shared/platform/voice/use-local-voice-enrollment';
import { deferred, settleReact } from '../../../../tests/helpers/controlled-clock';
import { i18n } from '@/shared/i18n/index';
import { renderHook } from '../../../../tests/helpers/render-hook';

async function enrollment(permission = Promise.resolve({ granted: true }), embedding = Promise.resolve([1, 0])) {
  const { clock, feed, native } = audioFixture();
  native.permission.mockReturnValue(permission);
  native.embedding.mockReturnValue(embedding);
  native.profile.mockResolvedValue([1, 0]);
  const runtime = renderHook(useLocalVoiceEnrollment, undefined);
  await settleReact();
  return { runtime, clock, ...native, feed: () => feed(6000, 64_000) };
}

function startEnrollment(enroll: () => Promise<void>) {
  let pending!: Promise<void>;
  act(() => { pending = enroll(); });
  return pending;
}

describe('leaving voice setup', () => {
  it('does not start recording after leaving while microphone permission is pending', async () => {
    const permission = deferred<{ granted: boolean }>();
    const view = await enrollment(permission.promise);
    const pending = startEnrollment(view.runtime.result.current.enroll);
    await settleReact();
    view.runtime.unmount();
    permission.resolve({ granted: true });
    await pending;
    expect(view.stream.start).not.toHaveBeenCalled();
    expect(view.clock.countTimers(12_000)).toBe(0);
    expect(view.save).not.toHaveBeenCalled();
  });

  it('stops active capture and cancels the enrollment timer on leaving', async () => {
    const view = await enrollment();
    await act(() => view.runtime.result.current.enroll());
    expect(view.stream.start).toHaveBeenCalledOnce();
    await settleReact();
    expect(view.runtime.result.current.status).toBe('starting');
    expect(view.clock.countTimers(12_000)).toBe(0);
    view.feed();
    await settleReact();
    expect(view.runtime.result.current.status).toBe('recording');
    expect(view.clock.countTimers(3000)).toBe(0);
    expect(view.clock.countTimers(12_000)).toBe(1);
    view.runtime.unmount();
    expect(view.stream.stop).toHaveBeenCalled();
    expect(view.deactivate).toHaveBeenCalled();
    expect(view.clock.countTimers(12_000)).toBe(0);
    expect(view.save).not.toHaveBeenCalled();
  });
});

describe('cancel enrollment without unmounting Settings', () => {
  it('invalidates a pending permission request and keeps saved profiles untouched', async () => {
    const permission = deferred<{ granted: boolean }>();
    const view = await enrollment(permission.promise);
    const pending = startEnrollment(view.runtime.result.current.enroll);
    await settleReact();
    await act(() => view.runtime.result.current.cancel());
    permission.resolve({ granted: true });
    await pending;
    await settleReact();
    expect(view.runtime.result.current.status).toBe('idle');
    expect(view.stream.start).not.toHaveBeenCalled();
    expect(view.save).not.toHaveBeenCalled();
    expect(view.clock.countTimers(12_000)).toBe(0);
  });
});

it('does not save a canceled voice profile after an embedding resolves', async () => {
  const embedding = deferred<number[]>();
  const view = await enrollment(Promise.resolve({ granted: true }), embedding.promise);
  await act(() => view.runtime.result.current.enroll());
  view.feed();
  await view.clock.advance(12_000);
  await settleReact();
  expect(view.runtime.result.current.status).toBe('saving');
  await act(() => view.runtime.result.current.cancel());
  embedding.resolve([1, 0]);
  await settleReact();
  expect(view.save).not.toHaveBeenCalled();
  expect(view.runtime.result.current.status).toBe('idle');
});

it('reports a rejected native start without its raw message and preserves the profile', async () => {
  const view = await enrollment();
  view.stream.start.mockRejectedValueOnce(Object.assign(new Error('private native payload'), { code: 'ERR_AUDIO_STREAM_INITIALIZATION' }));
  await act(() => view.runtime.result.current.enroll());
  await settleReact();
  expect(view.runtime.result.current.error).toBe(i18n.t('settings:voice.localWake.microphoneStartFailed'));
  expect(view.runtime.result.current.hasProfile).toBe(true);
  expect(view.deactivate).toHaveBeenCalledOnce();
  expect(view.captureError).toHaveBeenCalledWith(
    { name: 'VoiceCaptureError', message: 'Voice enrollment failed' },
    expect.objectContaining({
      operation: 'voice.enrollment', phase: 'stream', reason: 'startup-rejected', statusCode: 'ERR_AUDIO_STREAM_INITIALIZATION',
    }),
    false,
  );
});

it('reports missing PCM and releases the recorder after three seconds', async () => {
  const view = await enrollment();
  await act(() => view.runtime.result.current.enroll());
  await view.clock.advance(3000);
  await settleReact();
  expect(view.runtime.result.current.status).toBe('error');
  expect(view.runtime.result.current.error).toBe(i18n.t('settings:voice.localWake.microphoneStartFailed'));
  expect(view.stream.stop).toHaveBeenCalledOnce();
  expect(view.deactivate).toHaveBeenCalledOnce();
  expect(view.save).not.toHaveBeenCalled();
  expect(view.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'first-frame-timeout' }), false);
});

it('keeps a background cancellation local and ignores late frames', async () => {
  const view = await enrollment();
  await act(() => view.runtime.result.current.enroll());
  await act(() => view.runtime.result.current.cancel('background'));
  view.feed();
  await settleReact();
  expect(view.runtime.result.current.status).toBe('idle');
  expect(view.clock.countTimers(3000)).toBe(0);
  expect(view.clock.countTimers(12_000)).toBe(0);
  expect(view.captureError).not.toHaveBeenCalled();
  expect(view.info).toHaveBeenCalledWith('voice.cancelled', expect.objectContaining({ reason: 'background' }));
});

it('does not start after the setup closes while the voice test is stopping', async () => {
  const view = await enrollment();
  const stoppingTest = deferred<void>();
  const starting = startEnrollment(() => view.runtime.result.current.enroll(() => stoppingTest.promise));
  await act(() => view.runtime.result.current.cancel('screen-exit'));
  stoppingTest.resolve(undefined);
  await starting;
  expect(view.stream.start).not.toHaveBeenCalled();
  expect(view.info).toHaveBeenCalledWith('voice.cancelled', expect.objectContaining({ phase: 'preflight', reason: 'screen-exit' }));
});
