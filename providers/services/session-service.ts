import type { OpencodeClient, SnapshotFileDiff } from '@opencode-ai/sdk/v2/client';

import type { Project } from '@/lib/opencode/types';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function loadWorkspaceCatalog(catalogClient: OpencodeClient) {
  const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
    catalogClient.path.get(),
    catalogClient.project.list(),
    catalogClient.project.current(),
  ]);

  const discoveredProjects = requireData(projectsResponse.data, 'project list request');
  const currentProject = requireData(currentProjectResponse.data, 'current project request');
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
  const response = await client.session.messages({ sessionID: sessionId });
  return requireData(response.data, 'session messages request');
}

export async function getSessionDiff(client: OpencodeClient, sessionId: string) {
  const response = await client.session.diff({ sessionID: sessionId });
  const sessionDiff = requireData(response.data, 'session diff request');
  if (sessionDiff.length > 0) {
    return sessionDiff;
  }

  const [messages, statuses] = await Promise.all([
    getSessionMessages(client, sessionId),
    client.file.status().then((result) => requireData(result.data, 'file status request')),
  ]);
  const files = [...new Set(messages.flatMap(({ parts }) =>
    parts.flatMap((part) => part.type === 'patch' ? part.files : []),
  ))];

  const recovered = await Promise.all(files.map(async (file): Promise<SnapshotFileDiff | undefined> => {
    const status = statuses.find((entry) => file === entry.path || file.endsWith(`/${entry.path}`));
    if (!status) {
      return undefined;
    }

    const content = await client.file.read({ path: status.path }).then((result) => result.data).catch(() => undefined);
    const patch = content?.diff || content?.patch?.hunks.map((hunk) =>
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`,
    ).join('\n');
    if (!patch) {
      return undefined;
    }

    return {
      file: status.path,
      patch,
      additions: status.added,
      deletions: status.removed,
      status: status.status,
    };
  }));

  return recovered.filter((diff): diff is SnapshotFileDiff => Boolean(diff));
}

export async function getSessionTodos(client: OpencodeClient, sessionId: string) {
  const response = await client.session.todo({ sessionID: sessionId });
  return requireData(response.data, 'session todo request');
}

export async function deleteSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.delete({ sessionID: sessionId })).data;
}

export async function updateSessionTitle(client: OpencodeClient, sessionId: string, title: string) {
  return (await client.session.update({ sessionID: sessionId, title })).data;
}

export async function forkSession(client: OpencodeClient, sessionId: string, messageId?: string) {
  return (await client.session.fork({ sessionID: sessionId, messageID: messageId })).data;
}

export async function shareSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.share({ sessionID: sessionId })).data;
}

export async function unshareSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.unshare({ sessionID: sessionId })).data;
}

export async function revertSession(client: OpencodeClient, sessionId: string, messageId: string, partId?: string) {
  return (await client.session.revert({ sessionID: sessionId, messageID: messageId, partID: partId })).data;
}

export async function unrevertSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.unrevert({ sessionID: sessionId })).data;
}

export async function listCommands(client: OpencodeClient) {
  return requireData((await client.command.list()).data, 'command list request');
}

export async function executeCommand(
  client: OpencodeClient,
  sessionId: string,
  command: string,
  args: string,
  options?: { agent?: string; model?: string; messageId?: string },
) {
  return (await client.session.command({
    sessionID: sessionId,
    command,
    arguments: args,
    agent: options?.agent,
    model: options?.model,
    messageID: options?.messageId,
  })).data;
}
