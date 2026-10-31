import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

export type SessionRefreshInput = {

  client: ScopedOpencodeClient;

  isCurrentClient: (candidate: object) => boolean;

  activeProjectPath?: string;

  connectionScope: string;

  setSessions: Dispatch<SetStateAction<Session[]>>;

  sessionsRef: { current: Session[] };

  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;

  locallyCreatedSessionsRef: { current: Map<string, number> };

  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;

  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;

  suppressedPendingRequestIdsRef?: { current: Set<string> };
};
