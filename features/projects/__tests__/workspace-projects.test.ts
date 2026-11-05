import { describe, expect, it } from 'vitest';

import { buildWorkspaceProjectGroups } from '@/features/projects/model/workspace-project-groups';

function snapshot({ path, root = '/repo', entries = [], branch = 'main', activePath = path, status = 'connected', projects = [] }: {
  path: string;
  root?: string;
  entries?: { directory: string; name: string; branch?: string }[];
  branch?: string;
  activePath?: string;
  status?: string;
  projects?: { id?: string; label: string; path: string }[];
}) {
  return {
    values: {
      projectsValue: { activeProjectPath: activePath, activeProject: { id: 'project-1', label: 'repo', path }, projects },
      projectFilesValue: {
        worktrees: { entries, project: { id: 'project-1', root, label: 'repo' }, loading: false },
        vcsInfo: { branch },
      },
      connectionValue: { connection: { status } },
    },
  } as never;
}

describe('workspace project groups', () => {
  it('merges the main runtime and a worktree runtime into one project with two checkouts', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/repo"]': snapshot({ path: '/repo' }),
      '["server-1","/repo/wt"]': snapshot({
        path: '/repo/wt',
        entries: [{ directory: '/repo/wt', name: 'wt', branch: 'feature/wt' }],
        branch: 'feature/wt',
      }),
    });
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
      '["server-1","/repo/wt"]': snapshot({
        path: '/repo/wt',
        entries: [{ directory: '/repo/wt', name: 'wt', branch: 'feature/wt' }],
        branch: 'feature/wt',
      }),
    });
    expect(groups[0].projects).toHaveLength(1);
    expect(groups[0].projects[0].path).toBe('/repo');
    expect(groups[0].projects[0].checkouts.map((checkout) => checkout.directory)).toEqual(['/repo', '/repo/wt']);
  });

  it('lists every server project alongside the opened runtime', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/repo"]': snapshot({
        path: '/repo',
        projects: [
          { id: 'project-1', label: 'repo', path: '/repo' },
          { id: 'project-2', label: 'another', path: '/another' },
        ],
      }),
    });
    expect(groups[0].projects.map((project) => project.path)).toEqual(['/another', '/repo']);
    expect(groups[0].projects.find((project) => project.path === '/repo')?.opened).toBe(true);
    expect(groups[0].projects.find((project) => project.path === '/another')?.opened).toBe(false);
    expect(groups[0].projects.find((project) => project.path === '/another')?.checkouts).toEqual([
      { directory: '/another', name: 'Local', branch: undefined, isMain: true },
    ]);
  });

  it('drops retained runtimes the server catalog no longer reports', () => {
    const groups = buildWorkspaceProjectGroups([{ id: 'server-1', name: 'Server', enabled: true } as never], {
      '["server-1","/gone"]': snapshot({
        path: '/gone',
        root: '/gone',
        activePath: '/gone',
        projects: [{ id: 'project-1', label: 'repo', path: '/repo' }],
      }),
    });
    expect(groups[0].projects.map((project) => project.path)).toEqual(['/repo']);
  });

  it('omits disabled and non-connected connections', () => {
    const groups = buildWorkspaceProjectGroups([
      { id: 'connected', name: 'Connected', enabled: true } as never,
      { id: 'disabled', name: 'Disabled', enabled: false } as never,
      { id: 'unavailable', name: 'Unavailable', enabled: true } as never,
    ], {
      '["connected","/repo"]': snapshot({ path: '/repo' }),
      '["disabled","/repo"]': snapshot({ path: '/repo' }),
      '["unavailable","/repo"]': snapshot({ path: '/repo', status: 'error' }),
    });
    expect(groups.map((group) => group.id)).toEqual(['connected']);
  });
});
