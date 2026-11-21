import { useWorkspaceDomainValue } from '@/runtime/core';

export const useProjects = () => useWorkspaceDomainValue((values) => values.projectsValue, 'useProjects');
export const useProjectFiles = () => useWorkspaceDomainValue((values) => values.projectFilesValue, 'useProjectFiles');
