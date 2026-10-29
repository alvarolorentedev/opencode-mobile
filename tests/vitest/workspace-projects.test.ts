import { describe, expect, it } from 'vitest';

import { buildWorkspaceProjectGroups } from '@/providers/workspace-project-groups';

function snapshot({ path, root = '/repo', entries = [], branch = 'main', activePath = path }: {
  path: string;
  root?: string;
  entries?: { directory: string; name: string; branch?: string }[];
  branch?: string;
  activePath?: string;
}) {
  return {
    values: {
      projectsValue: { activeProjectPath: activePath, activeProject: { id: 'project-1', label: 'repo', path } },
      projectFilesValue: {
        worktrees: { entries, project: { id: 'project-1', root, label: 'repo' }, loading: false },
        vcsInfo: { branch },
      },
      connectionValue: { connection: { status: 'connected' } },
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
});
