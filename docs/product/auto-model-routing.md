# Auto Model Routing

Auto model routing classifies each prompt into `simple`, `standard`, or
`complex` and selects a model from the enabled model catalog before submission.
It is opt-in and never falls back to a heuristic classifier.

## Classifiers

Two classifiers are supported. Neither one guesses a tier.

### On-device

- Runtime: `llama.rn` (llama.cpp) with a pinned GGUF pack.
- Pack: Qwen2.5-0.5B-Instruct Q4_K_M, Apache-2.0, approximately 491 MB.
- The pack is downloaded only after an explicit action and is never bundled in
  the app binary.
- Output is constrained with the GBNF grammar
  `root ::= "simple" | "standard" | "complex"`.
- The runtime uses a 2,048-token context, four threads, CPU inference, and
  releases the model after five minutes idle or when the app backgrounds.
- If the pack is missing, removed, or fails to load, on-device routing is
  disabled. The send uses the user's normal default model.

### OpenCode

- Request: `POST /api/experimental/generate` with the classifier prompt and a
  visible classifier model.
- V2 only. The endpoint is experimental, so it is probed before the option is
  enabled.
- Probe results are cached per connection and classifier model. A `404`/`405`
  marks the endpoint unsupported; `401`/`403` marks auth required; transport and
  `503` failures remain retryable.
- If a send-time classifier request fails or times out, that send uses the
  default model. It does not switch to the other classifier or invent a tier.

## Tier resolution

Each tier stores either `auto` or an explicit model ID.

- Simple → cheapest enabled tool-capable model.
- Standard → the current default model, falling back to the simple suggestion.
- Complex → the most capable enabled model: reasoning first, then context size,
  then price.

Automatic suggestions only consider enabled, configured, non-deprecated models.
An explicit tier model that is unavailable or incompatible causes routing to be
skipped rather than falling back to another tier.

## Guards

Routing is skipped when:

- auto-routing is disabled;
- the session is not idle;
- the prompt is empty or exceeds the classifier prompt limit;
- no visible models exist;
- the selected classifier is unavailable;
- attachments or the estimated context do not fit the selected model;
- the selected model is already the session model;
- the selected tier is unavailable;
- prompt-cache protection rejects a long-chat downgrade.

The cache guard is enabled by default. Above roughly 32k context tokens, a
simple or standard downgrade is skipped unless the target model's input price is
at most half of the current model's. Complex upgrades are still allowed.
Routing never switches models mid-turn for steer or queue submissions.

## Persistence

`chatPreferences.autoModel` stores:

```ts
{
  enabled: boolean;
  classifier: 'local' | 'server';
  classifierModelId?: string;
  tiers: { simple: string; standard: string; complex: string };
  protectLongChats: boolean;
}
```

Tier values are `auto` or a model ID. The object is server-scoped through the
workspace registry and saved connection profiles. Unavailable model IDs are kept
in preferences and treated as unavailable at send time rather than being
rewritten during a slow or incomplete capability refresh.

## UI

- Composer: an `Auto-routing` row in the model picker. Selecting an explicit
  model disables routing. The row is only shown when the selected classifier is
  available.
- Settings → AI & providers: classifier mode, on-device pack status/download/
  remove, OpenCode classifier model and probe, per-tier model mapping, and the
  long-chat cache guard.
- Onboarding: the same AI & providers panel is reused, so the routing choice is
  available during first-run setup.

## Privacy

- On-device classification never sends the prompt off the device.
- OpenCode classification sends the classifier prompt to the selected model on
  the connected OpenCode server before the main prompt is submitted.
- No prompt or classifier result is logged or persisted for training.

## Validation

- `features/ai/__tests__/auto-model.test.ts` covers prompt parsing, preferences, catalog
  suggestions, attachment/context guards, and cache protection.
- `tests/e2e/auto-model.spec.mjs` covers OpenCode probe success, simple/complex
  routing, and the explicit-model override against the fake V2 server.
- Native validation must cover pack download/integrity, llama.rn load and
  inference, memory release, OOM fallback, and a release build. Web has no local
  classifier and uses the OpenCode probe or leaves routing disabled.
