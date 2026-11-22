import { describe, expect, it } from 'vitest';

import { buildWorkspaceProjectGroups, type ProjectGroupInventory } from '@/features/projects/model/workspace-project-groups';

const online: { connection: { status: string }; contract: 'v2' } = { connection: { status: 'connected' }, contract: 'v2' };
const connected = new Map([['server-1', online]]);

function inventory({ path, root = '/repo', entries = [], branch = 'main', activePath = path, projects = [] }: {
  path: string;
  root?: string;
  entries?: { directory: string; name: string; branch?: string }[];
  branch?: string;
  activePath?: string;
  projects?: { id?: string; label: string; path: string }[];
}): ProjectGroupInventory {
  return {
    activeProjectPath: activePath,
    projects,
    worktrees: { entries, project: { id: 'project-1', root, label: 'repo' }, loading: false },
    branch,
  };
}

describe('workspace project groups', () => {
  it('merges the main runtime and a worktree runtime into one project with two checkouts', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/repo"]': inventory({ path: '/repo' }),
      '["server-1","/repo/wt"]': inventory({
        path: '/repo/wt',
        entries: [{ directory: '/repo/wt', name: 'wt', branch: 'feature/wt' }],
        branch: 'feature/wt',
      }),
    }, connected);
    expect(groups).toHaveLength(1);
    expect(groups[0].projects).toHaveLength(1);
    expect(groups[0].projects[0].path).toBe('/repo');
    expect(groups[0].projects[0].checkouts).toEqual([
      { directory: '/repo', name: 'Local', branch: 'main', isMain: true },
      { directory: '/repo/wt', name: 'wt', branch: 'feature/wt', isMain: false },
    ]);
  });

  it('groups a worktree-only runtime under its owning project root', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/repo/wt"]': inventory({
        path: '/repo/wt',
        entries: [{ directory: '/repo/wt', name: 'wt', branch: 'feature/wt' }],
        branch: 'feature/wt',
      }),
    }, connected);
    expect(groups[0].projects).toHaveLength(1);
    expect(groups[0].projects[0].path).toBe('/repo');
    expect(groups[0].projects[0].checkouts.map((checkout) => checkout.directory)).toEqual(['/repo', '/repo/wt']);
  });

  it('lists every server project alongside the opened runtime', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/repo"]': inventory({
        path: '/repo',
        projects: [
          { id: 'project-1', label: 'repo', path: '/repo' },
          { id: 'project-2', label: 'another', path: '/another' },
        ],
      }),
    }, connected);
    expect(groups[0].projects.map((project) => project.path)).toEqual(['/another', '/repo']);
    expect(groups[0].projects.find((project) => project.path === '/repo')?.opened).toBe(true);
    expect(groups[0].projects.find((project) => project.path === '/another')?.opened).toBe(false);
    expect(groups[0].projects.find((project) => project.path === '/another')?.checkouts).toEqual([
      { directory: '/another', name: 'Local', branch: undefined, isMain: true },
    ]);
  });

  it('drops retained runtimes the server catalog no longer reports', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/gone"]': inventory({
        path: '/gone',
        root: '/gone',
        activePath: '/gone',
        projects: [{ id: 'project-1', label: 'repo', path: '/repo' }],
      }),
    }, connected);
    expect(groups[0].projects.map((project) => project.path)).toEqual(['/repo']);
  });

  it('omits disabled and non-connected connections', () => {
    const groups = buildWorkspaceProjectGroups([
      { id: 'connected', name: 'Connected', enabled: true } as never,
      { id: 'disabled', name: 'Disabled', enabled: false } as never,
      { id: 'unavailable', name: 'Unavailable', enabled: true } as never,
    ], {
      '["connected","/repo"]': inventory({ path: '/repo' }),
      '["disabled","/repo"]': inventory({ path: '/repo' }),
      '["unavailable","/repo"]': inventory({ path: '/repo' }),
    }, new Map([
      ['connected', online],
      ['disabled', online],
      ['unavailable', { ...online, connection: { status: 'error' } }],
    ]));
    expect(groups.map((group) => group.id)).toEqual(['connected']);
  });
});
