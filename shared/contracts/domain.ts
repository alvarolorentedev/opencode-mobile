import type { Project, SessionStatus } from '@/shared/protocol/opencode/types';

import type { ConnectionFailureKind } from '@/shared/protocol/opencode/client';
import type { ManagedService, ServiceInput, ServiceManagementVersion } from '@/shared/contracts/service-management';

// How a transcript refresh treats the window already held in memory.
// - initial: no usable window; download one newest page.
// - tail: the default; download one newest page and merge it in. On no overlap
//   with the held window, adopt the fetched page rather than paging backward.
// - replace: drop the held window and adopt the fetched page. Reserved for
//   server-side history rewrites (compaction and revert).
export type TranscriptRefreshMode = 'initial' | 'tail' | 'replace';

export type SessionDeepLinkTarget = {
  sessionId: string;
  projectPath?: string;
  connectionScope?: string;
};

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
};

// Opened projects per connection scope, most-recent-first. The picker renders
// this list; the server's project catalog only enriches the entries.
export type ProjectPathsByConnection = Record<string, string[]>;

// Explicit persisted model for a pinned session. `sessionId` and `projectPath`
// are the identifiers required to reopen it; `connectionScope` says which
// server + user owns it, so identical paths or session IDs on another server
// never collide. `title` is retained because it cannot be reconstructed for
// cross-project favorites without a server call. The project label is
// derived from `projectPath` at render time and is never persisted.
export type FavoriteSession = {
  sessionId: string;
  connectionScope: string;
  projectPath: string;
  title?: string;
  favoritedAt: number;
};

export const FAVORITE_SESSIONS_MAX = 50;

// A session outside the active project, surfaced in the Chat Library "Active"
// group. `projectPath` is the server directory used to switch projects; the
// status drives the running indicator and ordering.
export type ActiveSessionItem = {
  connectionScope?: string;
  sessionId: string;
  projectPath: string;
  title?: string;
  status: SessionStatus;
  isCurrent: boolean;
  updatedAt: number;
};

export type ConnectionState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  checkedAt?: number;
  retryableStartup?: boolean;
  kind?: ConnectionFailureKind;
};

// Which diff source the Files Changed surface reads from. `turn` is the
// per-user-message snapshot diff; the VCS scopes come from the project
// working tree and are not tied to the current session.
export type DiffScope = 'turn' | 'uncommitted' | 'branch';

// A selectable user turn that has a recorded snapshot diff.
export type DiffTurn = {
  id: string;
  number: number;
};

export type ProjectCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

// A saved Cloud Link machine the services surface can manage. Services belong
// to one machine, so the selector only appears when more than one exists.
export type ServiceManagementMachine = {
  id: string;
  name: string;
  isActive: boolean;
};

// The machine the services surface currently targets. It can differ from the
// active connection: management uses this machine's own origin and device
// credentials, and links/addresses are built from its `serverUrl`.
export type ServiceManagementTarget = {
  serverUrl: string;
  profileId?: string;
  machineId?: string;
  machineName?: string;
  isActiveConnection: boolean;
};

// Why no usable services surface exists right now.
export type ServiceManagementUnavailableReason = 'no-cloud-link-machine' | 'credentials-expired';

// Remote connector service management. Folded into the connection domain so the
// provider keeps one context entry. `available` is false while resolving,
// without a saved Cloud Link machine, or when its credentials expired.
export type ServiceManagementApi = {
  services: ManagedService[];
  // Connector-reported management revision and port pool; undefined until the
  // first refresh answers. `api < 2` (or an unknown older connector) is legacy
  // path-only mode with an update hint instead of the port picker.
  version?: ServiceManagementVersion;
  available: boolean;
  target?: ServiceManagementTarget;
  machines: ServiceManagementMachine[];
  unavailableReason?: ServiceManagementUnavailableReason;
  loadFailed: boolean;
  isRefreshing: boolean;
  isSaving: boolean;
  refresh: () => Promise<void>;
  save: (id: string, input: ServiceInput) => Promise<ManagedService>;
  remove: (id: string) => Promise<void>;
  // Switch the services target machine (saved Cloud Link profiles).
  selectMachine: (id: string) => void;
  // Reconnect the target machine's Cloud Link access; also makes it the active
  // connection because fresh device credentials come from machine access.
  activateTarget: () => Promise<boolean>;
};
