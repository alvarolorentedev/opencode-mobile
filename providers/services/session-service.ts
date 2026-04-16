import type { Project } from '@/lib/opencode/types';

export async function loadWorkspaceCatalog(catalogClient: any) {
  const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
    catalogClient.path.get(),
    catalogClient.project.list().catch(() => undefined),
    catalogClient.project.current().catch(() => undefined),
  ]);

  const discoveredProjects = projectsResponse?.data || [];
  const currentProject = currentProjectResponse?.data;
  const dedupedProjects = new Map<string, Project>();

  if (currentProject?.worktree) {
    dedupedProjects.set(currentProject.worktree, currentProject);
  }

  discoveredProjects.forEach((project: any) => {
    dedupedProjects.set(project.worktree, project);
  });

  const nextProjects = [...dedupedProjects.values()].sort(
    (left, right) => (right.time.initialized || right.time.created) - (left.time.initialized || left.time.created),
  );

  return {
    currentProjectPath: currentProject?.worktree,
    serverRootPath: pathResponse.data.directory,
    serverProjects: nextProjects,
  };
}

export async function listSessions(client: any) {
  const [sessionsResponse, statusesResponse] = await Promise.all([client.session.list(), client.session.status()]);

  const nextSessions = [...sessionsResponse.data].sort((left: any, right: any) => right.time.updated - left.time.updated);
  return { sessions: nextSessions, statuses: statusesResponse.data };
}

export async function getSessionMessages(client: any, sessionId: string) {
  const response = await client.session.messages({ path: { id: sessionId } });
  return response.data;
}

export async function getSessionDiff(client: any, sessionId: string) {
  const response = await client.session.diff({ path: { id: sessionId } });
  return response.data;
}

export async function getSessionTodos(client: any, sessionId: string) {
  const response = await client.session.todo({ path: { id: sessionId } });
  return response.data;
}
