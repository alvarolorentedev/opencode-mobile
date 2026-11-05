import { describe, expect, it } from 'vitest';

import { projectParentPath } from '@/features/projects/model/project-utils';

describe('project browser navigation', () => {
  it('walks relative folders without leaving the project root', () => {
    expect(projectParentPath('src/components')).toBe('src');
    expect(projectParentPath('src')).toBe('');
    expect(projectParentPath('')).toBe('');
  });
});
