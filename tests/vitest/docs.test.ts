import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsRoot = path.join(root, 'docs');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('._')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function relative(file: string) {
  return path.relative(root, file).split(path.sep).join('/');
}

function linksIn(file: string) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

function resolveLink(file: string, target: string) {
  const [raw, anchor] = target.split('#');
  if (!raw || /^(?:https?:|mailto:|tel:|data:|\/)/.test(raw)) return undefined;
  return {
    anchor,
    file: path.normalize(path.join(path.dirname(file), raw)),
  };
}

function headingSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function anchorsIn(file: string) {
  return [...readFileSync(file, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => headingSlug(match[1]));
}

// Paths that are intentionally not in this checkout: historical locations
// named by ADRs, placeholders, external repositories, generated output, and
// proposed platform files. Keep this list short and explain each entry.
const INLINE_PATH_ALLOWLIST = new Set([
  // Retired flat documentation paths named as history in ADR 0008.
  'docs/architecture.md',
  'docs/state-and-data.md',
  'docs/api-contract.md',
  'docs/network-resilience.md',
  'docs/functional-spec.md',
  'docs/auto-model-routing.md',
  'docs/connect.md',
  'docs/app-updates.md',
  'docs/ios-share-parity.md',
  'docs/ios-widget-parity.md',
  'docs/design-system.md',
  'docs/component-inventory.md',
  'docs/development.md',
  'docs/testing-and-validation.md',
  'docs/integrations-and-operations.md',
  'docs/voice-validation.md',
  'docs/library-extraction.md',
  'docs/fdroid.md',
  'docs/known-gaps.md',
  'design-qa.md',
  'TESTING.md',
  // Section names in ADR 0008's historical context.
  'architecture/',
  'product/',
  'design/',
  'engineering/',
  'adr/',
  // Placeholders, external repositories, generated output, and proposals.
  // Generated/gitignored dirs referenced by docs (expo prebuild, Playwright).
  'android/',
  'ios/',
  'test-results/',
  'docs/adr/NNNN-short-kebab-title.md',
  'protocol/README.md',
  'widgets/ios/session-widget.tsx',
  'storybook-static/',
  'packages/',
  'Foundations/',
  'Controls/',
  'Feedback/',
  // Removed paths named as history in known-gaps.md.
  'components/chat/chat-content.tsx',
  'tests/e2e/flows.spec.mjs',
]);

function isInlinePath(value: string) {
  if (!value.includes('/')) return false;
  if (/^(?:https?:|mailto:|tel:|data:|file:|\/|~|#|@)/.test(value)) return false;
  if (/[\s*<>{}[\]|]/.test(value)) return false;
  if (value.includes('...')) return false;
  if (/^(?:npm|npx|git|node|expo|cd|curl|brew|adb|gradle)\b/.test(value)) return false;
  const filePart = value.split('#')[0].replace(/[),.;:]+$/, '');
  if (!filePart) return false;
  if (filePart.endsWith('/')) return true;
  return /\.(?:tsx?|m?js|json|md|png|jpe?g|mp4|ya?ml|xml|gradle|swift|kt|html|css|txt)$/.test(filePart);
}

describe('documentation contract', () => {
  it('keeps every doc reachable from a README and every relative link valid', () => {
    const docs = walk(docsRoot);
    const readmes = docs.filter((file) => path.basename(file) === 'README.md');
    const reachable = new Set<string>();

    for (const readme of readmes) {
      for (const target of linksIn(readme)) {
        const resolved = resolveLink(readme, target);
        if (resolved && existsSync(resolved.file)) reachable.add(relative(resolved.file));
      }
    }

    const unreachable = docs
      .map(relative)
      .filter((file) => !reachable.has(file));
    assert.deepEqual(
      unreachable,
      [],
      `Every doc must be linked from a README. Unreachable: ${unreachable.join(', ')}`,
    );

    const broken: string[] = [];
    const files = [
      ...docs,
      path.join(root, 'AGENTS.md'),
      path.join(root, 'README.md'),
      path.join(root, 'providers', 'AGENTS.md'),
    ];
    for (const file of files) {
      for (const target of linksIn(file)) {
        const resolved = resolveLink(file, target);
        if (!resolved) continue;
        if (!existsSync(resolved.file)) {
          broken.push(`${relative(file)} -> ${target} (missing)`);
          continue;
        }
        if (resolved.anchor && resolved.file.endsWith('.md')) {
          const anchors = anchorsIn(resolved.file);
          if (!anchors.includes(resolved.anchor)) {
            broken.push(`${relative(file)} -> ${target} (missing anchor)`);
          }
        }
      }
    }
    assert.deepEqual(broken, [], `Broken documentation links:\n${broken.join('\n')}`);

    const retired = [
      'docs/architecture.md',
      'docs/state-and-data.md',
      'docs/api-contract.md',
      'docs/network-resilience.md',
      'docs/functional-spec.md',
      'docs/auto-model-routing.md',
      'docs/connect.md',
      'docs/app-updates.md',
      'docs/ios-share-parity.md',
      'docs/ios-widget-parity.md',
      'docs/design-system.md',
      'docs/component-inventory.md',
      'docs/development.md',
      'docs/testing-and-validation.md',
      'docs/integrations-and-operations.md',
      'docs/voice-validation.md',
      'docs/library-extraction.md',
      'docs/fdroid.md',
      'docs/known-gaps.md',
      'design-qa.md',
      'TESTING.md',
    ];
    assert.deepEqual(
      retired.filter((file) => existsSync(path.join(root, file))),
      [],
      'Retired flat documentation paths must not be recreated; use the section tree.',
    );
  });

  it('keeps ADR numbering, structure, status, and index in sync', () => {
    const adrRoot = path.join(docsRoot, 'adr');
    const files = readdirSync(adrRoot)
      .filter((file) => /^\d{4}-.+\.md$/.test(file))
      .sort();
    assert.ok(files.length > 0, 'At least one ADR must exist.');

    const numbers = files.map((file) => Number(file.slice(0, 4)));
    assert.deepEqual(
      numbers,
      numbers.map((_, index) => index + 1),
      'ADR numbers must be unique, sequential, and start at 0001.',
    );

    const index = readFileSync(path.join(adrRoot, 'README.md'), 'utf8');
    const allowedStatus = /^(?:Proposed|Accepted|Rejected|Deprecated|Superseded by ADR \d{4})$/;

    for (const file of files) {
      const source = readFileSync(path.join(adrRoot, file), 'utf8');
      const number = file.slice(0, 4);
      assert.match(source, new RegExp(`^# ADR ${number}: .+`, 'm'), `${file} needs an ADR title.`);
      for (const field of ['Status', 'Date', 'Deciders', 'Supersedes', 'Related']) {
        assert.match(source, new RegExp(`^- ${field}: .+`, 'm'), `${file} needs "${field}".`);
      }
      for (const section of ['Context', 'Decision', 'Consequences', 'Alternatives considered']) {
        assert.match(source, new RegExp(`^## ${section}$`, 'm'), `${file} needs "## ${section}".`);
      }
      const status = source.match(/^- Status: (.+)$/m)?.[1].trim() ?? '';
      assert.match(status, allowedStatus, `${file} has an invalid status: ${status}`);
      assert.ok(index.includes(`](${file})`), `${file} must be linked from docs/adr/README.md.`);
    }
  });

  it('keeps the docs router, agent workflow, and Storybook catalog wired', () => {
    const router = readFileSync(path.join(docsRoot, 'README.md'), 'utf8');
    for (const section of ['architecture', 'product', 'design', 'engineering', 'adr']) {
      assert.ok(
        router.includes(`](${section}/README.md)`),
        `docs/README.md must route to ${section}/README.md.`,
      );
    }

    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    for (const reference of ['docs/README.md', 'docs/adr/README.md', 'docs/design/storybook.md']) {
      assert.ok(agents.includes(reference), `AGENTS.md must reference ${reference}.`);
    }
    assert.match(agents, /Architecture Decision Records/, 'AGENTS.md must document the ADR workflow.');

    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(typeof pkg.scripts?.storybook, 'string', 'package.json needs a storybook script.');
    assert.equal(typeof pkg.scripts?.['build:storybook'], 'string', 'package.json needs build:storybook.');
    assert.ok(existsSync(path.join(root, '.storybook', 'main.ts')), '.storybook/main.ts is missing.');
    assert.ok(existsSync(path.join(root, '.storybook', 'preview.tsx')), '.storybook/preview.tsx is missing.');

    const stories = [
      path.join(root, 'components', 'ui', 'text-input.stories.tsx'),
      path.join(root, 'components', 'ui', 'update-notice.stories.tsx'),
      path.join(root, 'components', 'settings', 'sections', 'setting-rows.stories.tsx'),
      path.join(root, '.storybook', 'stories', 'foundations.stories.tsx'),
    ];
    assert.deepEqual(
      stories.filter((file) => !existsSync(file)),
      [],
      'The initial Storybook catalog is incomplete.',
    );
  });

  it('keeps inline paths, npm scripts, and the agent routing surface valid', () => {
    const files = [
      ...walk(docsRoot),
      path.join(root, 'AGENTS.md'),
      path.join(root, 'README.md'),
      path.join(root, 'providers', 'AGENTS.md'),
    ];
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const scripts = new Set(Object.keys(pkg.scripts ?? {}));
    const missingPaths: string[] = [];
    const missingScripts: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/`([^`\n]+)`/g)) {
        const raw = match[1].trim();
        if (!isInlinePath(raw)) continue;
        const cleaned = raw.split('#')[0].replace(/[),.;:]+$/, '');
        if (INLINE_PATH_ALLOWLIST.has(cleaned) || INLINE_PATH_ALLOWLIST.has(raw)) continue;
        if (!existsSync(path.join(root, cleaned))) {
          missingPaths.push(`${relative(file)} -> ${raw}`);
        }
      }
      for (const match of source.matchAll(/npm run ([a-z0-9:._-]+)/g)) {
        if (!scripts.has(match[1])) {
          missingScripts.push(`${relative(file)} -> npm run ${match[1]}`);
        }
      }
    }

    const uniquePaths = [...new Set(missingPaths)];
    const uniqueScripts = [...new Set(missingScripts)];
    assert.deepEqual(uniquePaths, [], `Inline repository paths must resolve:\n${uniquePaths.join('\n')}`);
    assert.deepEqual(uniqueScripts, [], `Documented npm scripts must exist:\n${uniqueScripts.join('\n')}`);

    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    for (const reference of [
      'docs/README.md',
      'docs/engineering/task-recipes.md',
      'providers/AGENTS.md',
      'docs/adr/README.md',
      'docs/design/storybook.md',
    ]) {
      assert.ok(agents.includes(reference), `AGENTS.md must reference ${reference}.`);
    }
    assert.ok(!agents.includes('Read first:'), 'AGENTS.md must route by task, not preload the docs tree.');

    const recipes = readFileSync(path.join(root, 'docs/engineering/task-recipes.md'), 'utf8');
    for (const heading of [
      '## Translations',
      '## Settings section or row',
      '## Fake-server scenario and E2E flow',
      '## Provider state field or endpoint',
    ]) {
      assert.ok(recipes.includes(heading), `task-recipes.md needs ${heading}.`);
    }

    const providers = readFileSync(path.join(root, 'providers/AGENTS.md'), 'utf8');
    assert.ok(
      providers.includes('docs/architecture/state-and-data.md'),
      'providers/AGENTS.md must link the state model.',
    );

    const componentIndex = readFileSync(path.join(root, 'docs/design/component-inventory.md'), 'utf8');
    for (const file of [
      'components/chat.md',
      'components/settings.md',
      'components/screens.md',
      'components/onboarding.md',
      'components/shared.md',
    ]) {
      assert.ok(componentIndex.includes(file), `component-inventory.md must link ${file}.`);
    }

    const validationIndex = readFileSync(path.join(root, 'docs/engineering/testing-and-validation.md'), 'utf8');
    for (const file of [
      'validation/strategy.md',
      'validation/fake-server.md',
      'validation/e2e.md',
      'validation/regressions.md',
    ]) {
      assert.ok(validationIndex.includes(file), `testing-and-validation.md must link ${file}.`);
    }

    for (const file of [
      'docs/architecture/overview.md',
      'docs/architecture/state-and-data.md',
      'docs/product/functional-spec.md',
    ]) {
      assert.ok(
        readFileSync(path.join(root, file), 'utf8').includes('## Read by task'),
        `${file} needs a Read by task section.`,
      );
    }
  });
});
