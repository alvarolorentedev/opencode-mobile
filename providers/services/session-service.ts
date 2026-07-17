import type { OpencodeClient } from '@opencode-ai/sdk/client';

import type { Project } from '@/lib/opencode/types';
import { requestOpenCodeApi, type ScopedOpencodeClient } from '@/lib/opencode/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function loadWorkspaceCatalog(catalogClient: OpencodeClient) {
  const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
    catalogClient.path.get(),
    catalogClient.project.list().catch(() => undefined),
    catalogClient.project.current().catch(() => undefined),
  ]);

  const discoveredProjects = projectsResponse?.data || [];
  const currentProject = currentProjectResponse?.data;
  const path = requireData(pathResponse.data, 'path request');
  const dedupedProjects = new Map<string, Project>();

  if (currentProject?.worktree) {
    dedupedProjects.set(currentProject.worktree, currentProject);
  }

  discoveredProjects.forEach((project) => {
    dedupedProjects.set(project.worktree, project);
  });

  const nextProjects = [...dedupedProjects.values()].sort(
    (left, right) => (right.time.initialized || right.time.created) - (left.time.initialized || left.time.created),
  );

  return {
    currentProjectPath: currentProject?.worktree,
    serverRootPath: path.directory,
    serverProjects: nextProjects,
  };
}

export async function listSessions(client: OpencodeClient) {
  const [sessionsResponse, statusesResponse] = await Promise.all([client.session.list(), client.session.status()]);

  const nextSessions = [...requireData(sessionsResponse.data, 'session list request')]
    .sort((left, right) => right.time.updated - left.time.updated);
  return { sessions: nextSessions, statuses: requireData(statusesResponse.data, 'session status request') };
}

export async function getSessionMessages(client: OpencodeClient, sessionId: string) {
  const response = await client.session.messages({ path: { id: sessionId } });
  return response.data || [];
}

export async function getSessionDiff(client: OpencodeClient, sessionId: string) {
  const response = await client.session.diff({ path: { id: sessionId } });
  return response.data || [];
}

export async function getSessionTodos(client: OpencodeClient, sessionId: string) {
  const response = await client.session.todo({ path: { id: sessionId } });
  return response.data || [];
}

export async function deleteSession(client: OpencodeClient, sessionId: string) {
  return requestOpenCodeApi<boolean>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function updateSessionTitle(client: OpencodeClient, sessionId: string, title: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH', body: JSON.stringify({ title }),
  });
}

export async function forkSession(client: OpencodeClient, sessionId: string, messageId?: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/fork`, {
    method: 'POST', body: JSON.stringify(messageId ? { messageID: messageId } : {}),
  });
}

export async function shareSession(client: OpencodeClient, sessionId: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/share`, { method: 'POST' });
}

export async function unshareSession(client: OpencodeClient, sessionId: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/share`, { method: 'DELETE' });
}

export async function revertSession(client: OpencodeClient, sessionId: string, messageId: string, partId?: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/revert`, {
    method: 'POST', body: JSON.stringify({ messageID: messageId, partID: partId }),
  });
}

export async function unrevertSession(client: OpencodeClient, sessionId: string) {
  return requestOpenCodeApi<import('@/lib/opencode/types').Session>(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/unrevert`, { method: 'POST' });
}

export async function listCommands(client: OpencodeClient) {
  return (await client.command.list()).data;
}

export async function executeCommand(
  client: OpencodeClient,
  sessionId: string,
  command: string,
  args: string,
  options?: { agent?: string; model?: string; messageId?: string },
) {
  return requestOpenCodeApi(client as ScopedOpencodeClient, `/session/${encodeURIComponent(sessionId)}/command`, {
    method: 'POST',
    body: JSON.stringify({
      command,
      arguments: args,
      agent: options?.agent,
      model: options?.model,
      messageID: options?.messageId,
    }),
  });
}
