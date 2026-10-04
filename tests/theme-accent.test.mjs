import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// The accent module is deliberately free of React Native / expo-router imports
// so the pure resolver and contrast behavior can be exercised in Node.
const source = await readFile(new URL('../constants/accent.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { ACCENT_MODES, isAccentMode, resolveStaticAccent } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

assert.deepEqual(ACCENT_MODES, ['system', 'opencode', 'blue', 'violet', 'orange']);
assert.equal(isAccentMode('system'), true);
assert.equal(isAccentMode('opencode'), true);
assert.equal(isAccentMode('magenta'), false);
assert.equal(isAccentMode(undefined), false);
assert.equal(isAccentMode(3), false);

for (const mode of ACCENT_MODES) {
  for (const scheme of ['light', 'dark']) {
    const roles = resolveStaticAccent(scheme, mode);
    for (const key of ['accent', 'accentForeground', 'accentMuted', 'accentOnMuted']) {
      assert.match(roles[key], /^#[0-9a-f]{6}$/i, `${mode}/${scheme}/${key} must be a hex string`);
    }
  }
}

// `system` shares the Opencode fallback; explicit modes differ.
for (const scheme of ['light', 'dark']) {
  assert.deepEqual(resolveStaticAccent(scheme, 'system'), resolveStaticAccent(scheme, 'opencode'));
}
assert.notEqual(resolveStaticAccent('light', 'opencode').accent, resolveStaticAccent('light', 'blue').accent);

function luminance(hex) {
  const channels = hex.replace('#', '').match(/.{2}/g).map((pair) => parseInt(pair, 16) / 255);
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

for (const mode of ACCENT_MODES) {
  for (const scheme of ['light', 'dark']) {
    const roles = resolveStaticAccent(scheme, mode);
    // The Opencode brand accent sits at ~4.2:1 against white (a pre-existing
    // ratio); curated accents are held to the WCAG AA normal-text floor.
    const accentFloor = mode === 'opencode' || mode === 'system' ? 4.0 : 4.5;
    assert.ok(
      contrast(roles.accent, roles.accentForeground) >= accentFloor,
      `${mode}/${scheme} accent/foreground contrast is below ${accentFloor}`,
    );
    assert.ok(
      contrast(roles.accentMuted, roles.accentOnMuted) >= 4.5,
      `${mode}/${scheme} muted/onMuted contrast is below 4.5`,
    );
  }
}

console.log('theme accent tests passed');
