import type { QueryClient } from '@tanstack/react-query';

import { buildClient, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { isKnownProjectLocation, resolveProjectLocation } from '@/shared/protocol/services/session-service';
import { telemetry } from '@/shared/observability/client';

import type { ProjectCatalogInput } from '../model/action-inputs';
import type { ProjectCatalog } from '../model/types';
import { fetchProjectCatalog } from './queries/catalog';

export function createProjectCatalogActions(cache: QueryClient, {
  identity, client, catalogClient, isCurrentClient, isCurrentCatalogClient,
  activeProjectPathRef, setActiveProjectPath, clearProjectState, scopeGenerationRef, serverContract, settingsRef,
}: ProjectCatalogInput) {
  function replacePath(next: string | undefined) {
    if (next === activeProjectPathRef.current) return;
    scopeGenerationRef.current += 1;
    clearProjectState();
    setActiveProjectPath(next);
  }

  async function readCatalog(silent: boolean, targetClient: ScopedOpencodeClient) {
    const result = await fetchProjectCatalog(cache, identity, targetClient, !silent);
    telemetry.markStartup('workspace-loaded', { kind: silent ? 'refresh' : 'open' });
    return result;
  }

  async function loadProjectCatalog(silent = false, targetClient: ScopedOpencodeClient = catalogClient): Promise<ProjectCatalog> {
    const generation = scopeGenerationRef.current;
    const isCurrent = () => generation === scopeGenerationRef.current
      && (isCurrentClient(targetClient) || isCurrentCatalogClient(targetClient));
    const result = await readCatalog(silent, targetClient);
    if (!isCurrent()) return result;

    let nextProject = activeProjectPathRef.current;
    if (nextProject && nextProject !== result.currentProjectPath
      && !result.serverProjects.some((project) => project.worktree === nextProject)) {
      const known = await isKnownProjectLocation(buildClient({ ...settingsRef.current, directory: nextProject }, targetClient.__opencode.contract));
      if (!isCurrent()) return result;
      if (!known) nextProject = undefined;
    }
    const resolved = nextProject || result.currentProjectPath || result.serverProjects[0]?.worktree;
    if (resolved || activeProjectPathRef.current) replacePath(resolved);
    return result;
  }

  async function refreshProjectCatalog(silent = false) {
    await loadProjectCatalog(silent, client);
  }

  async function addProject(directory: string) {
    const path = directory.trim();
    if (!path) throw new Error('Enter a directory on the OpenCode server.');
    const settings = settingsRef.current;
    const generation = scopeGenerationRef.current;
    const isCurrent = () => settingsRef.current === settings && isCurrentCatalogClient(catalogClient) && generation === scopeGenerationRef.current;
    if (!isCurrent()) throw new Error('The connection changed while adding the project.');
    const scopedClient = buildClient({ ...settings, directory: path }, serverContract);
    const project = await resolveProjectLocation(scopedClient).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) {
        throw new Error('OpenCode could not open that directory. Check the server path.');
      }
      throw reason;
    });
    if (!isCurrent()) throw new Error('The connection changed while adding the project.');
    if (!project.worktree) throw new Error('OpenCode did not return a project path.');
    await readCatalog(true, catalogClient);
    if (!isCurrent()) throw new Error('The connection changed while adding the project.');
    const location = project.directory || path;
    const normalized = location.trim();
    if (normalized) replacePath(normalized);
    return location;
  }

  return { loadProjectCatalog, refreshProjectCatalog, addProject };
}
