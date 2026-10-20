import { describe, expect, it } from 'vitest';

import { getModelVariantLabel } from '@/components/chat/chat-view-utils';

describe('model variant labels', () => {
  it('translates common variants and preserves unknown server IDs', () => {
    const t = (key: string) => `translated:${key}`;

    expect(getModelVariantLabel(undefined, t)).toBe('translated:chat:reasoning.default');
    expect(getModelVariantLabel('max', t)).toBe('translated:chat:reasoning.max');
    expect(getModelVariantLabel('custom-effort', t)).toBe('custom-effort');
  });
});
