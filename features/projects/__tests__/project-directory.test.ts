import { describe, expect, it } from 'vitest';

import { childDirectory, parentDirectory } from '@/features/projects/model/project-directory';

describe('project directory navigation', () => {
  it('walks parents without losing the root', () => {
    expect(parentDirectory('/workspace/demo/src')).toBe('/workspace/demo');
    expect(parentDirectory('/workspace/demo/')).toBe('/workspace');
    expect(parentDirectory('/workspace')).toBe('/');
    expect(parentDirectory('/')).toBe('/');
  });

  it('joins server folders with the root separator', () => {
    expect(childDirectory('/workspace', 'demo')).toBe('/workspace/demo');
    expect(childDirectory('/workspace/', 'demo')).toBe('/workspace/demo');
    expect(childDirectory('C:\\workspace', 'demo')).toBe('C:\\workspace\\demo');
  });
});
