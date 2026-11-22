import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Keep every test suite in the TypeScript program.
const MAX_UNTYPED_SUITES = 21;

describe('test typecheck ratchet', () => {
  it('does not grow the untyped suite denylist', () => {
    const config = readFileSync(new URL('../../tsconfig.tests.json', import.meta.url), 'utf8');
    const excludeBlock = config.match(/"exclude"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const excluded = [...excludeBlock.matchAll(/"tests\/vitest\/([^"]+)"/g)].map((match) => match[1]);

    expect(
      excluded.length,
      `The untyped test denylist grew. Fix the suite types before excluding it. Excluded: ${excluded.join(', ')}`,
    ).toBeLessThanOrEqual(MAX_UNTYPED_SUITES);
  });
});
