import { useMemo } from 'react';

import type { ActiveSessionItem, CurrentSessionContextValue } from '@/features/sessions/model/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';
import type { Session } from '@/shared/protocol/opencode/types';

import { getSessionPreviewById } from '../model/selectors';

type SessionPresentationInput = Omit<CurrentSessionContextValue, 'activeSessions' | 'activeSession'>
  & {
    sessions: Session[];
    activeSessions: ActiveSessionItem[];
    refreshActiveSessions: () => Promise<void>;
    setActiveSessionsVisible: (visible: boolean) => void;
    messagesBySession: Record<string, SessionMessageRecord[]>;
  };

export function useSessionPresentation({
  activeSessions, refreshActiveSessions, setActiveSessionsVisible, sessions, currentSessionId,
  ensureActiveSession, openDeepLinkSession, openSession, createSession, messagesBySession,
}: SessionPresentationInput) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);
  const activeSessionsValue = useMemo(
    () => ({ list: activeSessions, refresh: refreshActiveSessions, setVisible: setActiveSessionsVisible }),
    [activeSessions, refreshActiveSessions, setActiveSessionsVisible],
  );
  const currentSessionValue = useMemo(
    () => ({ activeSessions: activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession }),
    [activeSessionsValue, ensureActiveSession, openDeepLinkSession, openSession, createSession],
  );
  const sessionLibraryValue = useMemo(() => ({ sessions, sessionPreviewById }), [sessions, sessionPreviewById]);

  return { activeSession, currentSessionValue, sessionLibraryValue };
}
