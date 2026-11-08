import type { Project, Session, SessionStatus } from '@/shared/protocol/opencode/types';

export const MISSION_PATH = '/mission-control';
export const MISSION_LINK = 'opencodemobile://mission-control';
export const MISSION_FILTERS = ['attention', 'running', 'failed', 'completed'] as const;
export type MissionFilter = typeof MISSION_FILTERS[number];
export type MissionCounts = Record<MissionFilter, number>;

export type MissionWidgetSnapshot = {
  counts: MissionCounts;
  checkedAt: number;
  checkedServers: number;
  totalServers: number;
  stale: boolean;
  language?: string;
};

export type MissionRequest = { id: string; sessionID: string };
export type MissionApprovals = { permissions?: MissionRequest[]; questions?: MissionRequest[] };
export type MissionExecution = { type: SessionStatus['type'] | 'succeeded' | 'failed' | 'interrupted'; at: number; observedAt?: number };
export type MissionConnectionActivity = {
  phase: 'checking' | 'ready' | 'partial' | 'offline' | 'unsupported';
  approvals: Record<string, MissionApprovals>;
  execution: Record<string, MissionExecution>;
  supplemental: Session[];
  removed: ReadonlySet<string>;
  archivedProjects?: ReadonlySet<string>;
  revision?: number;
  authorized: boolean;
  projects: Project[];
  catalogAt?: number;
  running?: { ids: ReadonlySet<string>; at: number };
  checkedAt?: number;
  refresh: () => void;
};
