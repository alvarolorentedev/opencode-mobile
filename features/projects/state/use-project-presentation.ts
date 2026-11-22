import { useMemo } from 'react';

import type { ProjectFile } from '@/shared/protocol/opencode/project-file';

import type { ProjectFilesContextValue, ProjectsContextValue } from '../model/types';

type ProjectPresentationInput = Omit<ProjectsContextValue, 'refreshProjectStatus'> &
  Omit<ProjectFilesContextValue, 'projectFile'> & {
    refreshServerFeatures: ProjectsContextValue['refreshProjectStatus'];
    selectedProjectFile?: ProjectFile;
    openProjectFile: ProjectFilesContextValue['projectFile']['open'];
    saveProjectFile: ProjectFilesContextValue['projectFile']['save'];
    closeProjectFile: ProjectFilesContextValue['projectFile']['close'];
    downloadProjectFile: ProjectFilesContextValue['projectFile']['download'];
  };

export function useProjectPresentation({
  projects, activeProjectPath, activeProject, selectProject, addProject, isRefreshingProjectCatalog, refreshProjectCatalog,
  refreshServerFeatures, selectedProjectFile, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile,
  browser, projectFileStatuses, vcsInfo, worktrees, refreshWorktrees, removeWorktree,
}: ProjectPresentationInput) {
  const projectsValue = useMemo<ProjectsContextValue>(() => ({
    projects, activeProjectPath, activeProject, selectProject, addProject, isRefreshingProjectCatalog, refreshProjectCatalog,
    refreshProjectStatus: refreshServerFeatures,
  }), [projects, activeProjectPath, activeProject, selectProject, addProject, isRefreshingProjectCatalog, refreshProjectCatalog, refreshServerFeatures]);

  const projectFile = useMemo(() => ({
    selected: selectedProjectFile, open: openProjectFile, save: saveProjectFile, close: closeProjectFile, download: downloadProjectFile,
  }), [selectedProjectFile, openProjectFile, saveProjectFile, closeProjectFile, downloadProjectFile]);
  const projectFilesValue = useMemo<ProjectFilesContextValue>(() => ({
    browser, projectFileStatuses, projectFile, vcsInfo, worktrees, refreshWorktrees, removeWorktree,
  }), [browser, projectFileStatuses, projectFile, vcsInfo, worktrees, refreshWorktrees, removeWorktree]);
  return { projectsValue, projectFilesValue };
}
