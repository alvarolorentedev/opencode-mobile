import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { collectImpact } from '../../scripts/impact.mjs';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

describe('impact script', () => {
  it('lists tests that depend on a source file and omits the source itself', () => {
    const affected = collectImpact(root, 'runtime/core/store.ts');
    expect(affected).toContain('runtime/__tests__/app-store.test.ts');
    expect(affected).toContain('runtime/__tests__/app-core.test.ts');
    expect(affected).not.toContain('runtime/core/store.ts');
  });

  it('rejects an unknown path', () => {
    expect(() => collectImpact(root, 'runtime/core/does-not-exist.ts')).toThrow('Unknown source file');
  });
});
