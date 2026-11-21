import { useWorkspaceDomainValue } from '@/runtime/core';

export const useCurrentSession = () => useWorkspaceDomainValue((values) => values.currentSessionValue, 'useCurrentSession');
export const useSessionLibrary = () => useWorkspaceDomainValue((values) => values.sessionLibraryValue, 'useSessionLibrary');
export const useApprovals = () => useWorkspaceDomainValue((values) => values.approvalsValue, 'useApprovals');
