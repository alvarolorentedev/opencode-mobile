import * as Linking from 'expo-linking';

export type SessionDeepLinkTarget = {
  sessionId: string;
  projectPath?: string;
};

export function buildSessionDeepLink(sessionId: string, projectPath?: string) {
  return Linking.createURL(`session/${encodeURIComponent(sessionId)}`, {
    queryParams: projectPath ? { project: projectPath } : undefined,
  });
}

export function parseSessionDeepLink(url: string): SessionDeepLinkTarget | undefined {
  if (!url) {
    return undefined;
  }

  const parsed = Linking.parse(url);
  const segments = (parsed.path ?? '').split('/').filter(Boolean);
  const idParam = parsed.queryParams?.id;
  const projectParam = parsed.queryParams?.project;

  const sessionId = Array.isArray(idParam) ? idParam[0] : idParam || segments[0];
  const projectPath = !Array.isArray(projectParam) && projectParam ? projectParam : undefined;

  if (!sessionId) {
    return undefined;
  }

  return { sessionId, projectPath };
}
