import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useWorkspaceDomainValue } from '@/runtime/core';

export const useChat = (target?: WorkspaceTarget) => useWorkspaceDomainValue((values) => values.chatValue, 'useChat', target);
