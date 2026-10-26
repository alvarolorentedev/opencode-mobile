import type { SessionInfo } from '@opencode/client';

import { compareLabels } from '@/lib/compare-labels';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { toFileDiffs } from '@/lib/opencode/diff';
import type { NativeOpencodeApi } from '@/lib/opencode/client/types';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import { coalesceRead } from '@/lib/opencode/in-flight';
import { toProjectView, toSessionView } from '@/lib/opencode/v2-mappers';
import { toMessageRecord } from '@/lib/opencode/v2/mappers';
import type { Command, FileDiff, Project, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import * as v1 from '@/lib/opencode/compat/v1/session';
import { listWorktrees as listV1Worktrees } from '@/lib/opencode/compat/v1/project';

export type ResolvedProjectLocation = Project & { directory?: string };
export type SessionMessagePage = { records: SessionMessageRecord[]; hasMore: boolean; nextBefore?: string };
export const TRANSCRIPT_PAGE_LIMIT = 20;
export const LATEST_MESSAGE_LIMIT = 3;
// The native message.list query validates `limit` as 1..200 and rejects larger
// pages with a 400, so every transcript read must stay inside that bound.
export const MAX_MESSAGE_PAGE_LIMIT = 200;

export type PromptInput = Parameters<NonNullable<ScopedOpencodeClient['compatibility']>['session']['promptAsync']>[0];

export type SessionAdapter = {
  submitPrompt: (input: PromptInput) => Promise<void>;
  loadProjectCatalog: () => Promise<Awaited<ReturnType<typeof v1.loadProjectCatalog>>>;
  resolveProjectLocation: () => Promise<ResolvedProjectLocation>;
  isKnownProjectLocation: () => Promise<boolean>;
  isAvailableProjectDirectory: (knownProjects: Project[]) => Promise<boolean>;
  activeStatuses: () => Promise<Record<string, SessionStatus> | undefined>;
  list: () => Promise<{ sessions: Session[]; statuses: Record<string, SessionStatus> }>;
  messages: (sessionId: string, options?: { limit?: number; before?: string; fresh?: boolean }) => Promise<SessionMessagePage>;
  diff: (sessionId: string, messageId?: string, messages?: SessionMessageRecord[]) => Promise<FileDiff[]>;
  todos: (sessionId: string) => Promise<Todo[]>;
  create: (title?: string) => Promise<Session>;
  remove: (sessionId: string) => Promise<unknown>;
  updateTitle: (sessionId: string, title: string) => Promise<unknown>;
  fork: (sessionId: string, messageId?: string) => Promise<Session>;
  revert: (sessionId: string, messageId: string, partId?: string) => Promise<unknown>;
  unrevert: (sessionId: string) => Promise<unknown>;
  interrupt: (sessionId: string) => Promise<unknown>;
  commands: () => Promise<Command[]>;
  executeCommand: (sessionId: string, command: string, args: string, options?: { agent?: string; model?: string; variant?: string; messageId?: string }) => Promise<unknown>;
  executeShell: (sessionId: string, command: string) => Promise<unknown>;
};

const MAX_SESSION_PAGES = 10;

async function listV2Sessions(api: NativeOpencodeApi, directory?: string): Promise<SessionInfo[]> {
  const scope = directory ? { directory } : {};
  const records: SessionInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const response = await api.session.list(cursor ? { ...scope, cursor } : scope);
    if (!Array.isArray(response?.data)) throw new Error('MalformedResponse: OpenCode did not return its session list.');
    // Pages can overlap at the cursor; a page that adds nothing also stops a
    // server that ignores the cursor from looping.
    const fresh = response.data.filter((session) => !seen.has(session.id));
    if (fresh.length === 0) break;
    for (const session of fresh) seen.add(session.id);
    records.push(...fresh);
    const next = response.cursor?.next;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return records;
}

export function createSessionAdapter(client: ScopedOpencodeClient): SessionAdapter {
  const compatibility = client.compatibility;
  const directory = client.__opencode.directory;

  const resolveProjectLocation = async (): Promise<ResolvedProjectLocation> => {
    if (compatibility) return v1.resolveProjectLocation(compatibility);
    const location = await client.api!.location.get({ location: { directory } });
    return { id: location.project.id, worktree: location.project.canonical, directory: location.project.directory, time: { created: 0 } };
  };

  const isKnownProjectLocation = async () => {
    if (!directory) return false;
    try {
      const resolved = await resolveProjectLocation();
      if (resolved.directory === directory) return true;
      if (compatibility) {
        const entries = await listV1Worktrees(compatibility);
        return entries.some((entry) => entry.directory === directory);
      }
      return false;
    } catch {
      return false;
    }
  };

  const isAvailableProjectDirectory = async (knownProjects: Project[]) => {
    if (!directory) return false;
    try {
      const resolved = await resolveProjectLocation();
      if (resolved.directory === directory
        || resolved.worktree === directory
        || knownProjects.some((project) => project.id === resolved.id)) {
        return true;
      }
      if (compatibility) {
        const entries = await listV1Worktrees(compatibility);
        return entries.some((entry) => entry.directory === directory);
      }
      return false;
    } catch {
      return false;
    }
  };

  const messages = (sessionId: string, options: { limit?: number; before?: string; fresh?: boolean } = {}) => {
    const before = options.before;
    const limit = Math.min(options.limit ?? TRANSCRIPT_PAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT);
    const read = async (): Promise<SessionMessagePage> => {
      if (compatibility) return v1.getSessionMessages(compatibility, sessionId, { limit, before, fresh: options.fresh });
      const page = await client.api!.message.list(before ? { sessionID: sessionId, limit, cursor: before } : { sessionID: sessionId, limit, order: 'desc' });
      const records = [...page.data].reverse().map((message) => toMessageRecord(message, sessionId)).filter((record): record is SessionMessageRecord => Boolean(record));
      const nextBefore = page.cursor.next && page.cursor.next !== before ? page.cursor.next : undefined;
      return { records, hasMore: Boolean(nextBefore), nextBefore };
    };
    // A rewrite must not reuse a page read before the server-side change (for
    // example a revert or compaction). Ordinary tails still coalesce.
    if (options.fresh) return read();
    return coalesceRead(client, `messages:${sessionId}:${before ?? 'newest'}:${limit}`, read);
  };

  return {
    submitPrompt: async (input) => {
      if (!compatibility) throw new Error('Prompt admission is unavailable.');
      await compatibility.session.promptAsync(input);
    },
    loadProjectCatalog: async () => {
      if (compatibility) return v1.loadProjectCatalog(compatibility);
      const [location, projects] = await Promise.all([
        directory ? client.api!.location.get({ location: { directory } }) : client.api!.location.get(),
        client.api!.project.list(),
      ]);
      if (!location?.project?.id || !location.directory || !Array.isArray(projects)) throw new Error('MalformedResponse: OpenCode did not return its project catalog.');
      const current = projects.find((project) => project.id === location.project.id);
      const serverProjects = projects.map(toProjectView).sort((left, right) => compareLabels(left.worktree, right.worktree));
      return { currentProjectPath: location.directory, serverRootPath: location.directory, serverProjects: current ? serverProjects : [...serverProjects, { id: location.project.id, worktree: location.project.canonical, time: { created: 0 } }] };
    },
    resolveProjectLocation,
    isKnownProjectLocation,
    isAvailableProjectDirectory,
    activeStatuses: async () => {
      if (compatibility) return undefined;
      const active = await client.api!.session.active();
      return active && typeof active === 'object' ? active as unknown as Record<string, SessionStatus> : undefined;
    },
    list: () => coalesceRead(client, 'sessions', async () => {
      if (compatibility) return v1.listSessions(compatibility);
      const [records, active] = await Promise.all([
        listV2Sessions(client.api!, directory),
        client.api!.session.active(),
      ]);
      if (active == null) throw new Error('OpenCode did not return active sessions.');
      const sessions = records.map(toSessionView).filter((session) => !session.time.archived).sort((a, b) => b.time.updated - a.time.updated);
      const statuses: Record<string, SessionStatus> = {};
      for (const session of records) statuses[session.id] = { type: 'idle' };
      for (const id of Object.keys(active)) statuses[id] = { type: 'busy' };
      return { sessions, statuses };
    }),
    messages,
    diff: async (sessionId, messageId, records) => {
      const target = messageId ?? (records ?? (await messages(sessionId)).records).slice().reverse().find((record) => record.info.role === 'user')?.info.id;
      if (!target) return [];
      return coalesceRead(client, `diff:${sessionId}:${target}`, async () =>
        compatibility
          ? v1.getSessionDiff(compatibility, sessionId, target)
          : toFileDiffs(await client.api!.session.diff({ sessionID: sessionId, from: target })));
    },
    todos: (sessionId) => compatibility ? v1.getSessionTodos(compatibility, sessionId) : Promise.resolve([]),
    create: async (title?: string) => {
      if (compatibility) return (await compatibility.session.create(title ? { title } : undefined)).data as Session;
      return toSessionView(await client.api!.session.create({ ...(title ? { title } : {}), ...(directory ? { location: { directory } } : {}) })) as unknown as Session;
    },
    remove: (sessionId) => compatibility ? v1.deleteSession(compatibility, sessionId) : client.api!.session.remove({ sessionID: sessionId }),
    updateTitle: async (sessionId, title) => {
      if (compatibility) return v1.updateSessionTitle(compatibility, sessionId, title);
      await client.api!.session.update({ sessionID: sessionId, title });
      return toSessionView(await client.api!.session.get({ sessionID: sessionId }));
    },
    fork: (sessionId, messageId) => compatibility
      ? v1.forkSession(compatibility, sessionId, messageId) as Promise<Session>
      : client.api!.session.fork({ sessionID: sessionId, ...(messageId ? { before: messageId } : {}) }).then((session) => toSessionView(session) as unknown as Session),
    revert: (sessionId, messageId, partId) => compatibility
      ? v1.revertSession(compatibility, sessionId, messageId, partId)
      : client.api!.session.revert.stage({ sessionID: sessionId, messageID: messageId, ...(partId ? { partID: partId } : {}) }),
    unrevert: (sessionId) => compatibility ? v1.unrevertSession(compatibility, sessionId) : client.api!.session.revert.clear({ sessionID: sessionId }),
    interrupt: (sessionId) => compatibility ? compatibility.session.abort({ sessionID: sessionId }) : client.api!.session.interrupt({ sessionID: sessionId }),
    commands: () => compatibility ? v1.listCommands(compatibility) : client.api!.command.list({ location: { directory } }).then((result) => result.data),
    executeCommand: async (sessionId, command, args, options) => {
      if (compatibility) return v1.executeCommand(compatibility, sessionId, command, args, options);
      if (options?.agent) await client.api!.session.switchAgent({ sessionID: sessionId, agent: options.agent });
      if (options?.model) {
        const [providerID, ...id] = options.model.split('/');
        await client.api!.session.switchModel({ sessionID: sessionId, model: { providerID, id: id.join('/'), ...(options.variant && options.variant !== 'default' ? { variant: options.variant } : {}) } });
      }
      await client.api!.session.command({ sessionID: sessionId, name: command, text: args });
    },
    executeShell: async (sessionId, command) => {
      // Shell execution is a V2-only composer surface; the UI never exposes it
      // on compatibility clients.
      await client.api!.session.shell({ sessionID: sessionId, command });
    },
  };
}
