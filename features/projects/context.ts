import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { ProjectsContextValue , ProjectFilesContextValue } from '@/features/projects/model/types';

export const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export const ProjectFilesContext = createContext<ProjectFilesContextValue | null>(null);

export const useProjects = () => useDomainValue(ProjectsContext, 'useProjects');

export const useProjectFiles = () => useDomainValue(ProjectFilesContext, 'useProjectFiles');
