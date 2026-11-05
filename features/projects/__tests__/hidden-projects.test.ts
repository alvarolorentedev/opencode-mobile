import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { splitHiddenProjects } from '@/features/projects/model/hidden-projects';
import { loadTs } from '../../../tests/helpers/runtime.mjs';

const projects = [
  { path: '/repo', label: 'repo' },
  { path: '/other', label: 'other' },
  { path: '/hidden', label: 'hidden' },
];

describe('hidden projects', () => {
  it('splits the server catalog by exact path and ignores stale hidden entries', () => {
    expect(splitHiddenProjects(projects, ['/hidden', '/removed'])).toEqual({
      visible: [projects[0], projects[1]],
      hidden: [projects[2]],
    });
    expect(splitHiddenProjects(projects, ['/removed'])).toEqual({ visible: projects, hidden: [] });
  });

  it('parses and serializes bounded connection-scoped paths', async () => {
    const storage = await loadTs('features/projects/services/hidden-projects-storage.ts', { zod: { z } });
    const many = Array.from({ length: 55 }, (_, index) => `/project-${index}`);
    const parsed = storage.parseHiddenProjects(JSON.stringify({
      ' https://server.test ': [' /repo ', '/repo', '', 42, ...many],
      '': ['/ignored'],
    }));
    expect(Object.keys(parsed)).toEqual(['https://server.test']);
    expect(parsed['https://server.test'][0]).toBe('/repo');
    expect(new Set(parsed['https://server.test']).size).toBe(parsed['https://server.test'].length);
    expect(parsed['https://server.test']).toHaveLength(50);
    expect(JSON.parse(storage.serializeHiddenProjects({ 'https://server.test': [' /repo ', '/repo'], ' ': ['/ignored'] })))
      .toEqual({ 'https://server.test': ['/repo'] });
  });
});
