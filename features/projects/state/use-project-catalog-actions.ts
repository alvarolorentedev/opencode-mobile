import { useCallback, useEffect, useRef } from 'react';

import { buildClient, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import type { ProjectCatalogInput } from '@/features/projects/model/action-inputs';
import type { ProjectCatalog } from '@/shared/contracts/domain';
import { fetchProjectCatalog } from '@/features/projects/services/queries/catalog';
import { telemetry } from '@/shared/observability/client';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { isKnownProjectLocation as svcIsKnownProjectLocation, resolveProjectLocation as svcResolveProjectLocation } from '@/shared/protocol/services/session-service';
import { useQueryClient } from '@tanstack/react-query';

export function useProjectCatalogActions({
  client,
  connected,
  catalogClient,
  isCurrentClient,
  isCurrentCatalogClient,
  activeProjectPath,
  setActiveProjectPath,
  activeProjectPathRef,
  clearProjectState,
  connectionScope,
  connectionScopeRef,
  isHydrated,
  setSessions,
  setSessionStatuses,
  scopeGenerationRef,
  serverContract,
  settingsRef,
  hydrateSessionCache,
}: ProjectCatalogInput & { hydrateSessionCache: (connectionScope: string, projectPath: string, applySessions: (sessions: import('@/shared/protocol/opencode/types').Session[]) => void, applyStatuses: (statuses: Record<string, Pick<import('@/shared/protocol/opencode/types').SessionStatus, 'type'>>) => void, isCurrent: () => boolean) => Promise<void> }) {
  const active = useQueryActivity();
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  // Runtime refreshes use the scoped client so `location.get` reports that
  // runtime's directory/worktree. Connect probes still use the catalog client.
  const isCurrent = useCallback((candidate: ScopedOpencodeClient) => (
    isCurrentClient(candidate) || isCurrentCatalogClient(candidate)
  ), [isCurrentCatalogClient, isCurrentClient]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    if (normalizedPath === activeProjectPathRef.current) {
      return;
    }

    scopeGenerationRef.current += 1;
    setActiveProjectPath(normalizedPath);
    clearProjectState();
  }, [activeProjectPathRef, clearProjectState, scopeGenerationRef, setActiveProjectPath]);

  const loadProjectCatalog = useCallback(
    async (silent = false, targetClient: ScopedOpencodeClient = catalogClient): Promise<ProjectCatalog> => {
      const result = await fetchProjectCatalog(cache, identity, targetClient, !silent);
      telemetry.markStartup('workspace-loaded', { kind: silent ? 'refresh' : 'open' });
        if (!isCurrent(targetClient)) {
          return result;
        }

        // The server catalog is the list. The active path is kept when the
        // server still resolves it (a deep link or a worktree) or when it is
        // the server default; otherwise the most recently active server
        // project wins. Nothing is recorded locally.
        let nextProject = activeProjectPathRef.current;
        if (nextProject && nextProject !== result.currentProjectPath
          && !result.serverProjects.some((project) => project.worktree === nextProject)) {
          const known = await svcIsKnownProjectLocation(buildClient({ ...settingsRef.current, directory: nextProject }, targetClient.__opencode.contract));
          if (!isCurrent(targetClient)) {
            return result;
          }
          if (!known) nextProject = undefined;
        }
        if (!nextProject) {
          nextProject = result.currentProjectPath || result.serverProjects[0]?.worktree;
        }
        if (nextProject) {
          if (nextProject !== activeProjectPathRef.current) {
            scopeGenerationRef.current += 1;
            clearProjectState();
            setActiveProjectPath(nextProject);
          }
        } else if (activeProjectPathRef.current) {
          scopeGenerationRef.current += 1;
          clearProjectState();
          setActiveProjectPath(undefined);
        }
        return result;
    },
    [cache, identity, activeProjectPathRef, catalogClient, clearProjectState, isCurrent, scopeGenerationRef, setActiveProjectPath, settingsRef],
  );

  const refreshProjectCatalog = useCallback(
    async (silent = false) => {
      await loadProjectCatalog(silent, client);
    },
    [client, loadProjectCatalog],
  );

  useEffect(() => {
    if (connected && active && isHydrated) void loadProjectCatalog(true, client).catch(() => undefined);
  }, [active, client, connected, isHydrated, loadProjectCatalog]);

  const sessionCacheKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const projectPath = activeProjectPath;
    const scope = connectionScope;
    const cacheKey = projectPath ? `${scope}\u0000${projectPath}` : undefined;
    if (sessionCacheKeyRef.current === cacheKey) {
      return;
    }
    sessionCacheKeyRef.current = cacheKey;
    if (!projectPath) {
      return;
    }
    void hydrateSessionCache(
      scope,
      projectPath,
      (cached) => setSessions(cached),
      (cached) => setSessionStatuses(cached as Record<string, SessionStatus>),
      () => activeProjectPathRef.current === projectPath && connectionScopeRef.current === scope,
    );
  }, [activeProjectPath, activeProjectPathRef, connectionScope, connectionScopeRef, hydrateSessionCache, isHydrated, setSessionStatuses, setSessions]);

  const addProject = useCallback(async (directory: string) => {
    const path = directory.trim();
    if (!path) throw new Error('Enter a directory on the OpenCode server.');
    const connectionAtStart = connectionScopeRef.current;
    const scopedClient = buildClient({ ...settingsRef.current, directory: path }, serverContract);
    const project = await svcResolveProjectLocation(scopedClient).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) {
        throw new Error('OpenCode could not open that directory. Check the server path.');
      }
      throw reason;
    });
    if (connectionScopeRef.current !== connectionAtStart) throw new Error('The connection changed while adding the project.');
    if (!project.worktree) throw new Error('OpenCode did not return a project path.');
    await loadProjectCatalog(true);
    if (connectionScopeRef.current !== connectionAtStart) throw new Error('The connection changed while adding the project.');
    // Select the location the server resolved: the project root for nested
    // input, the worktree directory for a worktree, otherwise the input itself.
    const location = project.directory || path;
    selectProject(location);
    return location;
  }, [connectionScopeRef, loadProjectCatalog, selectProject, serverContract, settingsRef]);

  return { loadProjectCatalog, refreshProjectCatalog, selectProject, addProject };
}
