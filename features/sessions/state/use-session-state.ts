import { useRef, useState } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

export function useSessionState() {

  const [sessions, setSessions] = useState<Session[]>([]);

  const sessionsRef = useRef<Session[]>([]);

  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});

  const [currentSessionId, setCurrentSessionId] = useState<string>();

  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<Record<string, PendingPermissionRequest[]>>({});

  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, PendingQuestionRequest[]>>({});

  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);

  const [activeSessionsVisible, setActiveSessionsVisible] = useState(false);

  const currentSessionIdRef = useRef<string | undefined>(undefined);

  const pendingDeepLinkTargetRef = useRef<import('@/shared/contracts/domain').SessionDeepLinkTarget | undefined>(undefined);

  const deepLinkOperationRef = useRef<object | undefined>(undefined);

  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);

  const bootstrapTokenRef = useRef<object | undefined>(undefined);

  const explicitSessionSelectionRef = useRef<string | undefined>(undefined);

  const locallyCreatedSessionsRef = useRef<Map<string, number>>(new Map());

  const suppressedPendingRequestIdsRef = useRef<Set<string>>(new Set());
  return { sessions, setSessions, sessionsRef, sessionStatuses, setSessionStatuses, currentSessionId, setCurrentSessionId, pendingPermissionsBySession, setPendingPermissionsBySession, pendingQuestionsBySession, setPendingQuestionsBySession, isBootstrappingChat, setIsBootstrappingChat, activeSessionsVisible, setActiveSessionsVisible, currentSessionIdRef, pendingDeepLinkTargetRef, deepLinkOperationRef, bootstrapPromiseRef, bootstrapTokenRef, explicitSessionSelectionRef, locallyCreatedSessionsRef, suppressedPendingRequestIdsRef };
}
