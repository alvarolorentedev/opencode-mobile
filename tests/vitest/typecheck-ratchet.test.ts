import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The dynamic loadTs/hookRuntime suites cannot be type-checked yet. Keep the
// denylist shrinking; if a new suite needs the harness, migrate it instead of
// adding an entry here.
const MAX_UNTYPED_SUITES = 21;

describe('test typecheck ratchet', () => {
  it('does not grow the untyped suite denylist', () => {
    const config = readFileSync(new URL('../../tsconfig.tests.json', import.meta.url), 'utf8');
    const excludeBlock = config.match(/"exclude"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const excluded = [...excludeBlock.matchAll(/"tests\/vitest\/([^"]+)"/g)].map((match) => match[1]);

    expect(
      excluded.length,
      `The untyped test denylist grew. Migrate the suite off loadTs/hookRuntime instead of adding it to tsconfig.tests.json. Excluded: ${excluded.join(', ')}`,
    ).toBeLessThanOrEqual(MAX_UNTYPED_SUITES);
  });
});
