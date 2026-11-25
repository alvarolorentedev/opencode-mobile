import { describe, expect, it } from 'vitest';

import { childDirectory, parentDirectory, rootDirectory } from '@/features/projects/model/project-directory';

describe('project directory navigation', () => {
  it('walks parents without losing the root', () => {
    expect(parentDirectory('/workspace/demo/src')).toBe('/workspace/demo');
    expect(parentDirectory('/workspace/demo/')).toBe('/workspace');
    expect(parentDirectory('/workspace')).toBe('/');
    expect(parentDirectory('/')).toBe('/');
    expect(parentDirectory('C:/')).toBe('C:/');
    expect(parentDirectory('C:\\workspace')).toBe('C:/');
  });

  it('derives the server filesystem root for browsing', () => {
    expect(rootDirectory('/workspace/demo-project')).toBe('/');
    expect(rootDirectory('/')).toBe('/');
    expect(rootDirectory('')).toBe('/');
    expect(rootDirectory('C:\\workspace\\demo')).toBe('C:/');
    expect(rootDirectory('C:/workspace/demo')).toBe('C:/');
  });

  it('joins server folders with the root separator', () => {
    expect(childDirectory('/workspace', 'demo')).toBe('/workspace/demo');
    expect(childDirectory('/workspace/', 'demo')).toBe('/workspace/demo');
    expect(childDirectory('C:\\workspace', 'demo')).toBe('C:\\workspace\\demo');
  });
});
