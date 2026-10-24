import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';

// Ratchets that keep the documented layering from eroding. When a limit is
// genuinely outgrown, move the code into the right layer (a domain hook, a
// service, or lib/) and lower the number here in the same change.
//
// Migrated from the standalone tests/architecture.test.mjs Node script.
describe('architecture ratchets', () => {
  it('keeps the provider, file sizes, context surface, and SDK boundary in bounds', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, '..', '..');

    function read(relative: string) {
      return readFile(path.join(root, relative), 'utf8');
    }

    async function collectSourceFiles(dir: string): Promise<string[]> {
      const files: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await collectSourceFiles(full)));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    }

    // 1. The provider orchestrates domains; it should not regrow into a god object.
    // Composition lives in providers/use-opencode-provider-composition.ts and the
    // context wiring in providers/opencode-provider-tree.tsx; the entrypoint stays
    // a thin wrapper so it cannot accumulate orchestration again.
    const provider = await read('providers/opencode-provider.tsx');
    const providerLines = provider.split('\n').length;
    assert.ok(
      providerLines <= 60,
      `providers/opencode-provider.tsx is ${providerLines} lines. Keep it a thin wrapper over use-opencode-provider-composition.ts / opencode-provider-tree.tsx instead of growing the provider.`,
    );

    // 1b. No source file may exceed the readable-size ceiling. Generated locale
    // registries are exempt. 400 is the target, 500 the hard limit.
    const MAX_LINES = 500;
    const LINE_LIMIT_EXEMPT = new Set(['lib/i18n/resources.ts']);
    const oversized: string[] = [];
    // `widgets/` holds the headless native widget trees and task handler; they are
    // not app routes, so they live outside app/ but still follow the size ratchet.
    for (const dir of ['app', 'components', 'providers', 'lib', 'widgets']) {
      for (const file of await collectSourceFiles(path.join(root, dir))) {
        const relative = path.relative(root, file);
        if (LINE_LIMIT_EXEMPT.has(relative)) continue;
        const lines = (await readFile(file, 'utf8')).split('\n').length;
        if (lines > MAX_LINES) oversized.push(`${relative} (${lines})`);
      }
    }
    assert.deepEqual(
      oversized,
      [],
      `Source files over ${MAX_LINES} lines must be split: ${oversized.join(', ')}`,
    );

    // 2. The public context surface stays a deliberate contract, not an accidental
    // dump. Count members across every domain context value.
    const types = await read('providers/opencode-provider-types.ts');
    const domainBlocks = [...types.matchAll(/export type \w+ContextValue = \{([\s\S]*?)\n\};/g)];
    assert.ok(domainBlocks.length >= 2, 'Domain context value types must exist.');
    const contextMembers = domainBlocks.reduce(
      (total, match) => total + (match[1].match(/^  [a-zA-Z]+[?]?[:(]/gm) || []).length,
      0,
    );
    assert.ok(
      contextMembers <= 127,
      `The domain contexts expose ${contextMembers} members in total. Add a domain hook or provider action instead of widening them.`,
    );

    // 3. Screens and presentational components never reach the network directly.
    const layerDirs = ['app', 'components'];
    const networkCalls = /(^|[^\w.])fetch\s*\(|new XMLHttpRequest|from ['"]axios['"]/;
    const offenders: string[] = [];
    const persistenceCalls = /(?:from ['"](?:@react-native-async-storage|expo-secure-store)|\b(?:loadConnectionProfiles|saveProfilePassword|getProfilePassword|deleteProfilePassword)\s*\()/;
    let keyboardSurfaces = 0;
    for (const dir of layerDirs) {
      for (const file of await collectSourceFiles(path.join(root, dir))) {
        const source = await readFile(file, 'utf8');
        if (networkCalls.test(source) || persistenceCalls.test(source)) {
          offenders.push(path.relative(root, file));
        }
        // adjustResize alone can leave keyboard overlap on edge-to-edge Android.
        // Padding preserves the flex frame without explicit height adjustment.
        if (source.includes('KeyboardAvoidingView')) {
          const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
          function visit(node: ts.Node) {
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'KeyboardAvoidingView') {
              const behavior = node.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'behavior')?.initializer;
              assert.equal((behavior as ts.StringLiteral | undefined)?.text, 'padding', `${file}: keyboard avoidance must use padding on all platforms`);
              keyboardSurfaces += 1;
            }
            ts.forEachChild(node, visit);
          }
          visit(ast);
        }
      }
    }
    assert.ok(keyboardSurfaces > 0, 'Keyboard layout surfaces must be checked.');
    for (const screen of ['components/chat/chat-view.tsx', 'components/terminal/terminal-screen.tsx']) {
      assert.doesNotMatch(await read(screen), /keyboardVerticalOffset/, `${screen}: full-screen avoidance must not add the header's safe-area inset again`);
    }
    assert.match(
      await read('app/(tabs)/_layout.tsx'),
      /\btabBarHideOnKeyboard:\s*false\b/,
      'Tabs must remain in layout when keyboard visibility changes.',
    );
    assert.deepEqual(
      offenders,
      [],
      `Network and persistence calls belong in providers/services or lib, never in ${layerDirs.join('/')}: ${offenders.join(', ')}`,
    );

    // Deep-link resolution is only for external entry points (notifications,
    // widgets, quick actions, OS links). In-app screens navigate through the
    // workspace registry so a slow server session list never blocks a tap.
    const deepLinkOffenders: string[] = [];
    for (const dir of layerDirs) {
      for (const file of await collectSourceFiles(path.join(root, dir))) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (relative === 'app/session/[id].tsx') continue;
        if (/\bopen(?:DeepLink|External)Session\b/.test(await readFile(file, 'utf8'))) deepLinkOffenders.push(relative);
      }
    }
    assert.deepEqual(
      deepLinkOffenders,
      [],
      `In-app navigation must use registry.navigate(...), not openDeepLinkSession: ${deepLinkOffenders.join(', ')}`,
    );

    // OpenCode 2 is the transport contract; the old SDK belongs only to its adapter.
    const legacyImports: string[] = [];
    for (const dir of ['app', 'components', 'providers', 'lib']) {
      for (const file of await collectSourceFiles(path.join(root, dir))) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (relative.startsWith('lib/opencode/compat/v1/')) continue;
        if (/(?:from\s*|import\s*\(|require\s*\()["']@opencode-ai\/sdk/.test(await readFile(file, 'utf8'))) legacyImports.push(relative);
      }
    }
    assert.deepEqual(legacyImports, [], `V1 SDK imports belong in the compatibility boundary: ${legacyImports.join(', ')}`);
  });
});
