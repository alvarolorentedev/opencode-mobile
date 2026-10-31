import { describe, expect, it } from 'vitest';

import { classifyValidation } from '../../scripts/ci/validation-map.mjs';

describe('validation selection', () => {
  it('skips E2E for documentation-only changes', () => {
    expect(classifyValidation(['docs/architecture/overview.md', 'README.md'])).toMatchObject({
      mode: 'none',
      storybook: false,
    });
  });

  it('skips E2E for Vitest-only changes', () => {
    expect(classifyValidation(['shared/protocol/__tests__/format.test.ts'])).toMatchObject({
      mode: 'none',
      storybook: false,
    });
  });

  it('runs the settings spec for settings presentation changes', () => {
    expect(classifyValidation(['shared/ui/settings/setting-rows.tsx'])).toMatchObject({
      mode: 'affected',
      storybook: true,
      specs: ['tests/e2e/settings.spec.mjs'],
    });
  });

  it('runs chat, interactions and diffs for chat presentation changes', () => {
    expect(classifyValidation(['features/chat/ui/chat-composer.tsx'])).toMatchObject({
      mode: 'affected',
      specs: [
        'tests/e2e/chat.spec.mjs',
        'tests/e2e/diffs.spec.mjs',
        'tests/e2e/interactions.spec.mjs',
      ],
    });
  });

  it('falls back to smoke for low-risk shared UI or library changes', () => {
    expect(classifyValidation(['shared/ui/theme/theme.ts'])).toMatchObject({ mode: 'smoke', storybook: true });
    expect(classifyValidation(['shared/i18n/languages.ts'])).toMatchObject({ mode: 'smoke', storybook: false });
  });

  it('uses the full suite for provider, protocol and fake-server changes', () => {
    for (const file of [
      'runtime/composition/use-opencode-provider-composition.ts',
      'shared/protocol/opencode/client.ts',
      'features/ai/services/capabilities-service.ts',
      'tests/fake-opencode/server.mjs',
      'tests/e2e/chat.spec.mjs',
    ]) {
      expect(classifyValidation([file])).toMatchObject({ mode: 'full' });
    }
  });

  it('uses the full suite for dependencies, build config and CI changes', () => {
    for (const file of [
      'package.json',
      'package-lock.json',
      'app.config.ts',
      'playwright.config.mjs',
      '.github/workflows/validate.yml',
      'scripts/build-web-e2e.mjs',
    ]) {
      expect(classifyValidation([file])).toMatchObject({ mode: 'full' });
    }
  });

  it('falls back to full for an unknown path', () => {
    expect(classifyValidation(['new-area/widget.ts'])).toMatchObject({ mode: 'full' });
  });

  it('uses full for broad or multi-domain changes', () => {
    expect(classifyValidation(Array.from({ length: 21 }, (_, index) => `lib/generated-${index}.ts`)))
      .toMatchObject({ mode: 'full' });
    expect(classifyValidation([
      'features/chat/ui/chat-view.tsx',
      'shared/ui/settings/setting-rows.tsx',
      'features/projects/ui/projects-screen.tsx',
    ])).toMatchObject({ mode: 'full' });
  });

  it('keeps Storybook-only changes out of Playwright', () => {
    expect(classifyValidation(['.storybook/main.ts'])).toMatchObject({
      mode: 'none',
      storybook: true,
    });
  });

  it('validates fully when the diff or event is unknown', () => {
    expect(classifyValidation([], { event: 'pull_request' })).toMatchObject({ mode: 'full' });
    expect(classifyValidation(['docs/README.md'], { event: 'workflow_dispatch' })).toMatchObject({ mode: 'full' });
    expect(classifyValidation(['docs/README.md'], { event: 'tag' })).toMatchObject({ mode: 'full' });
  });

  it('runs chat for app route changes and the full gate for layouts', () => {
    expect(classifyValidation(['app/(tabs)/index.tsx'])).toMatchObject({
      mode: 'affected',
      specs: ['tests/e2e/chat.spec.mjs'],
    });
    expect(classifyValidation(['app/(tabs)/_layout.tsx'])).toMatchObject({ mode: 'full' });
  });
});
