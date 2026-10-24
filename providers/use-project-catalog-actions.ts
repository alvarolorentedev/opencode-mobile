import { useCallback, useEffect, useRef } from 'react';

import { buildClient, type ScopedOpencodeClient } from '@/lib/opencode/client';
import type { Project, SessionStatus } from '@/lib/opencode/types';
import type { ProjectCatalog } from '@/providers/opencode-provider-types';
import { hydrateSessionCache } from '@/providers/session-cache';
import { PROJECTS_MAX } from '@/providers/projects-storage';
import {
  isKnownProjectLocation as svcIsKnownProjectLocation,
  loadProjectCatalog as svcLoadProjectCatalog,
  resolveProjectLocation as svcResolveProjectLocation,
} from '@/providers/services/session-service';
import type { ProjectActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useProjectCatalogActions({
  client,
  catalogClient,
  isCurrentClient,
  isCurrentCatalogClient,
  activeProjectPath,
  setActiveProjectPath,
  activeProjectPathRef,
  clearProjectState,
  projectPathsByConnectionRef,
  setProjectPathsByConnection,
  serverProjectsRef,
  setServerProjects,
  setCurrentProjectPath,
  setServerRootPath,
  connectionScope,
  connectionScopeRef,
  isHydrated,
  setSessions,
  setSessionStatuses,
  setIsRefreshingProjectCatalog,
  scopeGenerationRef,
  serverContract,
  settingsRef,
}: ProjectActionsInput) {
  const writeProjects = useCallback((scope: string, paths: string[]) => {
    const next = { ...projectPathsByConnectionRef.current, [scope]: paths.slice(0, PROJECTS_MAX) };
    projectPathsByConnectionRef.current = next;
    setProjectPathsByConnection(next);
  }, [projectPathsByConnectionRef, setProjectPathsByConnection]);
  // Runtime refreshes use the scoped client so `location.get` reports that
  // runtime's directory/worktree. Connect probes still use the catalog client.
  const isCurrent = useCallback((candidate: ScopedOpencodeClient) => (
    isCurrentClient(candidate) || isCurrentCatalogClient(candidate)
  ), [isCurrentCatalogClient, isCurrentClient]);

  // Opening records a project for the connection so the picker can show it
  // again. Selection is separate: removing a project must not reopen it.
  const openProject = useCallback((path: string) => {
    const scope = connectionScopeRef.current;
    const current = projectPathsByConnectionRef.current[scope] ?? [];
    writeProjects(scope, [path, ...current.filter((item) => item !== path)]);
  }, [connectionScopeRef, projectPathsByConnectionRef, writeProjects]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    openProject(normalizedPath);
    if (normalizedPath === activeProjectPathRef.current) {
      return;
    }

    scopeGenerationRef.current += 1;
    setActiveProjectPath(normalizedPath);
    clearProjectState();
  }, [activeProjectPathRef, clearProjectState, openProject, scopeGenerationRef, setActiveProjectPath]);

  const loadProjectCatalog = useCallback(
    async (silent = false, targetClient: ScopedOpencodeClient = catalogClient): Promise<ProjectCatalog> => {
      if (!silent) {
        setIsRefreshingProjectCatalog(true);
      }

      try {
        const result = await svcLoadProjectCatalog(targetClient);
        if (!isCurrent(targetClient)) {
          return result;
        }
        const nextServerProjects = result.serverProjects as Project[];
        serverProjectsRef.current = nextServerProjects;
        setServerProjects(nextServerProjects);
        setCurrentProjectPath(result.currentProjectPath);
        setServerRootPath(result.serverRootPath);

        const scope = connectionScopeRef.current;
        const opened = projectPathsByConnectionRef.current[scope];
        let nextProject = activeProjectPathRef.current;
        // The opened list is the picker's source of truth. An active path that
        // is not opened on this connection is kept only when the server still
        // resolves it (a deep link or a pre-upgrade selection).
        if (nextProject && !opened?.includes(nextProject)) {
          const listed = result.serverProjects.some((project) => project.worktree === nextProject) || nextProject === result.currentProjectPath;
          const known = listed || await svcIsKnownProjectLocation(buildClient({ ...settingsRef.current, directory: nextProject }, targetClient.__opencode.contract));
          if (!isCurrent(targetClient)) {
            return result;
          }
          if (!known) nextProject = undefined;
        }
        if (!nextProject) {
          nextProject = opened?.[0] ?? (opened === undefined ? result.currentProjectPath || result.serverProjects[0]?.worktree : undefined);
        }
        if (nextProject) {
          if (!opened?.includes(nextProject)) {
            writeProjects(scope, [nextProject, ...(opened ?? [])]);
          }
          if (nextProject !== activeProjectPathRef.current) {
            scopeGenerationRef.current += 1;
            clearProjectState();
            setActiveProjectPath(nextProject);
          }
        } else if (opened === undefined) {
          // Initialize the connection even when the server reports nothing, so
          // a later refresh does not auto-open a project the user closed.
          writeProjects(scope, []);
        } else if (activeProjectPathRef.current) {
          scopeGenerationRef.current += 1;
          clearProjectState();
          setActiveProjectPath(undefined);
        }
        return result;
      } finally {
        if (!silent) {
          setIsRefreshingProjectCatalog(false);
        }
      }
    },
    [activeProjectPathRef, catalogClient, clearProjectState, connectionScopeRef, isCurrent, projectPathsByConnectionRef, scopeGenerationRef, serverProjectsRef, setActiveProjectPath, setCurrentProjectPath, setIsRefreshingProjectCatalog, setServerProjects, setServerRootPath, settingsRef, writeProjects],
  );

  const refreshProjectCatalog = useCallback(
    async (silent = false) => {
      await loadProjectCatalog(silent, client);
    },
    [client, loadProjectCatalog],
  );

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
  }, [activeProjectPath, activeProjectPathRef, connectionScope, connectionScopeRef, isHydrated, setSessionStatuses, setSessions]);

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
