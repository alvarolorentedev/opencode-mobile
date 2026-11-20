# Voice Validation

This document separates reproducible offline measurements from physical-device
acceptance. Mocked or simulated results are never reported as device benchmarks.

## Automated coverage

Run the focused voice checks and the affected flows:

```bash
npm run test:ci:static
npm run test:fake-server:self
npx playwright test tests/e2e/chat.spec.mjs tests/e2e/settings.spec.mjs
```

The tag release runs the full browser suite and native release verification.

Relevant Vitest suites:

- `confirmation.test.ts`: localized strict grammar, ambiguity, readback policy.
- `permissions.test.ts`: read-before-request, blocked-permission handling, and the Android permission-prompt window.
- `speech-input.test.ts`: start watchdog, early empty end, missing teardown callback, Android compatibility and
  Google-recognizer recovery, the retryable total-failure path, permission-prompt background tolerance, and
  alternative-hypothesis delivery.
- `speech-input-config.test.ts`: system-locale fallback, explicit speech-locale override and result-hypothesis order.
- `wake-phrase.test.ts`: literal and joined-token matching, alternatives through
  final revisions, compound prefixes across a restart, expiry and reset.
- `voice-enrollment.test.ts`: first PCM frame, startup rejection, missing PCM, and cancellation.
- `recognition-service.test.ts`: recognizer package availability and recovery order.
- `conversation-confirmation.test.ts`: TTS/echo guard, confirm/retry/edit/cancel,
  timeout, duplicate confirmation, disabled mode.
- `provider-runtime.test.ts`: integrated system/local, wake/no-wake, and
  confirmation submission.
- `local-wake-word.test.ts`: resampling, downmix, speaker segment, token checks.
- `local-wake-word-hook.test.ts`: first frame, no-frame timeout, cancellation,
  handoff queue and KWS failure recovery.
- `local-command-capture.test.ts`: handoff audio and short-turn timeout recovery.

## Offline acoustic benchmark

Use the pinned KWS model and a local, licensed/consented WAV set. Record the
device-independent results separately:

1. Both phrases, multiple speakers/accents, 0.5/2/4 m, quiet/TV/music/babble.
2. At least 20 positive trials per condition and enough negative audio to report
   false activations per hour.
3. Sweep `keywordsScore`, `keywordsThreshold`, `numTrailingBlanks` and
   `maxActivePaths`; record detection rate, false activations/hour, p50/p95
   detection latency.
4. Keep audio and transcripts local. Commit only a manifest and consent/license
   notes, never microphone audio or diagnostic uploads.

Do not call this a phone benchmark. Device CPU, microphone, audio session and
native bridge timing are measured separately.

For a bridge regression check, feed the same 16 kHz mono PCM WAV through the
production Sherpa bridge with the pinned model. Start with a fresh keyword
stream for each run. Use approximately 100 ms chunks for one run and coalesce
the keyword and trailing silence into a single batch for the other. Expect
exactly one detection in each run. Also check the next wake after a speaker
rejection.

## Android wake regression comparison

Compare version `1.0.156` with the candidate build on the affected Android when
available, plus a Pixel and an iPhone control. Log the phone, OS version,
recognizer service and settings in the validation notes. Enable local verbose
[voice diagnostics](../architecture/observability.md#voice-capture-diagnostics)
before each run.

- Test each mode with 20 positive trials at 0.5 m in quiet and 20 at 2 m with
  55–65 dBA background speech. Start with `Hey code` and include `Hey opencode`
  in the device checklist below. Repeat local trials with speaker verification
  enabled and a current profile. Use the same speakers, commands, distance and
  conditions for both builds.
- Record wake cues, complete commands when spoken without a pause, median and
  p95 wake latency, and false activations over at least one hour of negative
  audio per mode. Keep logs and any consented fixtures local.
- Target 18 of 20 wakes in quiet, 16 of 20 in noise, and at most one false wake
  per hour with no increase from baseline. Where a trial fails, classify it
  from the local records before attributing it to acoustic accuracy.
- If On-device misses persist with valid frames and successful decoding, use
  the offline benchmark above to tune Sherpa against separate positive and
  negative samples before changing model settings.

## Physical-device checklist

Run on at least one low-end Android device and one current iPhone, with wired,
Bluetooth and speakerphone routes.

### Wake and command capture

- [ ] Both phrases at 0.5 m, 2 m and 4 m, quiet and 55–65 dBA TV/music/babble.
- [ ] “Hey Code, refactor the login component” without a pause; full command.
- [ ] A phrase present only in a lower recognition alternative still wakes the turn.
- [ ] An explicit speech locale overrides the device locale; the empty preference follows it.
- [ ] Repeated immediate retries after a speaker rejection.
- [ ] Speaker verification on/off; re-enrollment; TV/child voice rejection.
- [ ] Incoming call, microphone interruption, route change, app background.
- [ ] Armed idle battery/CPU/memory over 10 minutes.

### Confirmation

- [ ] Enabled by default after upgrading an existing install.
- [ ] No prompt before exact final “yes” or touch Send.
- [ ] “Yes, but…” is ambiguous and is not sent.
- [ ] Retry captures again without the wake phrase (or directly in no-wake mode).
- [ ] Edit sends edited text; cancel/timeout never sends.
- [ ] TTS readback uses the selected engine; no self-confirmation; echo guard.
- [ ] Long command uses the short spoken fallback with visible full text.
- [ ] Background/stop/connection loss clears the pending command.
- [ ] Exactly one prompt after confirmation; conversation resumes and reads reply.

### No-wake mode

- [ ] System mode starts listening immediately and shows the privacy warning.
- [ ] Local mode skips KWS and starts command capture directly.
- [ ] Ambient TV/babble does not send without confirmation.
- [ ] TTS readback pauses input, resumes after the echo guard, and does not
      capture its own voice.
- [ ] Disabling the wake phrase does not enable background listening.

### Android recognizer compatibility

- [ ] A device whose default recognizer is an OEM service (for example Samsung
      Bixby on One UI) starts dictation and conversation mode, or falls back to
      the compatibility/Google attempts.
- [ ] A recognizer that never emits a native start shows the retryable
      “voice input could not start” message instead of silently doing nothing.
- [ ] Continuous capture, punctuation, and on-device formatter failures do not
      leave conversation mode flashing its overlay.
- [ ] A Google recognizer is only selected when it is visible to the app; FOSS
      or AOSP devices without it keep the system default.

### Issue #93 device reproduction

- [ ] On the Samsung S21 Ultra and Asus Zenfone 10 (Android 15), try dictation,
      System conversation with on-device preference on and off, and voice
      enrollment. Repeat on Pixel 9a as a control.
- [ ] With RECORD_AUDIO already granted, starting dictation, conversation,
      enrollment or the voice check must not open Android's permission
      controller. Logcat must show no `REQUEST_PERMISSIONS`
      (`GrantPermissionsActivity`) from the app, and the recognizer start must
      appear.
- [ ] A first-time permission grant returns to the app before capture starts;
      the prompt-induced background state must not cancel the overlay,
      enrollment or voice check.
- [ ] An Android recognizer that ends unexpectedly within one second of readiness
      before speech or a nonempty result gets the bounded compatibility retries.
      Normal silence and deliberate stops still end normally.
- [ ] Enrollment shows microphone startup until the first valid frame, then starts
      the sample timer. After a successful native start with no frames for three
      seconds, enrollment releases the recorder and offers a retry.
- [ ] Verify local and remote records using the
      [voice diagnostics procedure](../architecture/observability.md#voice-capture-diagnostics).
      Record the app build and result for each device before closing the issue.

### Settings and migration

- [ ] Old preferences get confirmation on and wake phrase required on.
- [ ] Explicit off values survive restart for both switches.
- [ ] Voice settings and onboarding expose the same controls.
