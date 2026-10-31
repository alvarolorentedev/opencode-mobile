

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ProjectWorktree } from '@/shared/protocol/opencode/project';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { createSharedEventStream } from '@/shared/network/shared-event-stream';

export type WorkspaceTarget = { connectionId: string; projectPath: string };

export type SessionTarget = WorkspaceTarget & { sessionId: string };

export type NewWorktreeChatTarget = { connectionId: string; projectRoot: string; name?: string };

export type NewWorktreeChatResult = { session?: Session; checkout?: ProjectWorktree; error?: string };

export const workspaceKey = ({ connectionId, projectPath }: WorkspaceTarget) => JSON.stringify([connectionId, projectPath]);

export const sessionKey = (target: SessionTarget) => JSON.stringify([target.connectionId, target.projectPath, target.sessionId]);

export type ConnectionRecord = {
  id: string;
  revision?: number;
  authRevision?: number;
  name: string;
  settings: OpencodeConnectionSettings;
  enabled: boolean;
  preferences: Partial<ChatPreferences>;
  projects: string[];
  events: ReturnType<typeof createSharedEventStream>;
};

export type WorkspaceCatalog = {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  refresh: () => Promise<void>;
  removeSession: (sessionId: string) => void;
};
