# Storybook

Storybook is the review catalog for reusable presentation components. It runs on
the web through `react-native-web` and renders the production components with
the real appearance provider and Uniwind theme. The decorator supplies a static
UpdatesContext fixture for interaction blockers; it runs no update orchestration.

It is a development tool. It is not part of the app bundle, the E2E export, or
the release artifacts.

## Run

```bash
npm run storybook        # http://localhost:6006
npm run build:storybook  # static build check, output in storybook-static/
```

`storybook-static/` is generated and gitignored. Run the build check when you
change a story, a shared component used by a story, or the Storybook config. CI
runs the same build in the static validate job.

## Configuration

| File | Purpose |
| --- | --- |
| `.storybook/main.ts` | Story globs, addons, `react-native` → `react-native-web` aliasing, web extension resolution |
| `.storybook/preview.tsx` | Appearance provider, Uniwind theme, i18n, light/dark and accent toolbar controls |
| `.storybook/stubs/vector-icons.tsx` | Placeholder icon component because Expo icon fonts are not loaded on web |
| `.storybook/stories/` | Cross-cutting stories such as design foundations |

Stories are co-located with components:

```text
shared/ui/text-field.tsx
shared/ui/text-field.stories.tsx
shared/ui/settings/setting-rows.tsx
shared/ui/settings/setting-rows.stories.tsx
```

## What belongs

Add a story when a component is reusable or shared:

- primitives in `shared/ui/`
- shared settings controls in `features/settings/ui/sections/`
- reusable feedback/status components
- foundations such as palette, spacing, shape, and typography

A story should:

- import the production component, never a copy
- render meaningful props and states: default, disabled, error, loading, long
  values, narrow width, and destructive where relevant
- use the preview decorators for theme and shared UI; do not wrap it in a parallel
  visual system
- use localized strings or stable story-only labels; do not hard-code product
  copy that must be translated
- remain deterministic; no network, timers, or real native modules

## What does not belong

- full screens or route controllers
- provider orchestration, connection setup, or session state
- components that require a real native module, camera, microphone, store,
  Bluetooth, or a physical device
- stories that duplicate E2E coverage instead of isolating a presentation state

Provider-coupled surfaces are covered by Playwright flows. If a shared component
needs a provider only for a palette or theme, use the existing preview decorator
instead of adding a new mock.

## Adding a story

1. Put the story next to the component as `<component>.stories.tsx`.
2. Use CSF 3 with `Meta` and `StoryObj` from `@storybook/react-vite`.
3. Give it a stable `title` under `Foundations/`, `Controls/`, `Feedback/`, or
   the matching surface.
4. Cover the states a reviewer cannot easily reach in the app.
5. Run `npm run build:storybook`.
6. If the component has a visual contract, link the story from the
   [component inventory](component-inventory.md) or the change summary.

Example:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './text-field';

const meta = {
  title: 'Controls/Text input',
  component: TextField,
  args: { label: 'Server URL' },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Error: Story = { args: { invalid: true, value: 'invalid' } };
```

## Review checklist

- Light and dark scheme
- Every accent preset when color is part of the contract
- Disabled, error, loading, and empty states where applicable
- Long labels, long values, and 320-point width
- Keyboard focus and accessible name/state
- No horizontal overflow
- No network or native dependency

## Limitations

- The web preview does not prove native gestures, keyboard behavior, safe areas,
  screen-reader output, or native module behavior.
- Icon fonts are replaced by a placeholder in the web catalog. This is a
  Storybook-only shim; production icons are unchanged.
- A component that cannot be isolated without a large provider mock should stay
  in E2E coverage rather than gaining a fragile story.
- Overlay and selection stories run the production web primitives, appearance, safe areas and portal host. Native gestures and window behavior still require device validation.

## Related

- [Design system](design-system.md)
- [Component inventory](component-inventory.md)
- [Design QA](qa/README.md)
- [ADR 0007](../adr/0007-storybook-component-catalog.md)

The Vite config applies Tailwind and Uniwind and transforms the JSX published in RN Primitives JavaScript modules. Registry defaults are adapted in source; stories use the same files as the application.

Vite resolves `.web.mjs` before `.web.js` so RN Primitives and its underlying
Radix content frames share the ESM context instance. Keep this order when
upgrading the registry or Vite.
