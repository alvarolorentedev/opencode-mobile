# Voice Validation

This document separates reproducible offline measurements from physical-device
acceptance. Mocked or simulated results are never reported as device benchmarks.

## Automated coverage

Run the repository gates:

```bash
npm run test:ci:static
npm run test:fake-server:self
npm run test:e2e:web
```

Relevant Vitest suites:

- `confirmation.test.ts`: localized strict grammar, ambiguity, readback policy.
- `conversation-confirmation.test.ts`: TTS/echo guard, confirm/retry/edit/cancel,
  timeout, duplicate confirmation, disabled mode.
- `provider-runtime.test.ts`: integrated system/local, wake/no-wake, and
  confirmation submission.
- `local-wake-word.test.ts`: resampling, downmix, speaker segment, token checks.
- `local-wake-word-hook.test.ts`: handoff queue and KWS failure recovery.
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

## Recorded validation

2026-10-29, local checkout:

- `npm run test:ci:static`: passed, 759 Vitest checks.
- `npm run test:fake-server:self`: passed for both V1 and V2 fixtures.
- `npm run test:e2e:web`: passed, 169 flows.
- No physical-device wake/ASR benchmark was run in this environment. Do not
  treat the automated results as microphone, battery or acoustic evidence.

## Physical-device checklist

Run on at least one low-end Android device and one current iPhone, with wired,
Bluetooth and speakerphone routes.

### Wake and command capture

- [ ] Both phrases at 0.5 m, 2 m and 4 m, quiet and 55–65 dBA TV/music/babble.
- [ ] “Hey Code, refactor the login component” without a pause; full command.
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

### Settings and migration

- [ ] Old preferences get confirmation on and wake phrase required on.
- [ ] Explicit off values survive restart for both switches.
- [ ] Voice settings and onboarding expose the same controls.
