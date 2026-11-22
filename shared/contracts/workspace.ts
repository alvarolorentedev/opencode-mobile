

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ProjectWorktree } from '@/shared/protocol/opencode/project';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { MissionConnectionActivity } from '@/shared/contracts/mission-control';

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
};

export function resolveWorkspaceProjectKey(entry: ConnectionRecord | undefined, target: WorkspaceTarget,
  selection: Record<string, { activeProjectPath?: string } | undefined>) {
  const exact = workspaceKey(target);
  if (!entry || entry.projects.includes(target.projectPath)) return exact;
  const alias = entry.projects.find((projectPath) =>
    selection[workspaceKey({ connectionId: entry.id, projectPath })]?.activeProjectPath === target.projectPath);
  return alias === undefined ? exact : workspaceKey({ connectionId: entry.id, projectPath: alias });
}

export type WorkspaceCatalog = {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  refresh: (signal?: AbortSignal) => Promise<void>;
  removeSession: (sessionId: string) => void;
  mission?: MissionConnectionActivity;
};
