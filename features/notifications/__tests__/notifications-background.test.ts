import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { pendingNotificationKey } from '@/features/notifications/model/notification-pending';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import * as storageKeys from '@/shared/storage/keys';

vi.mock('expo-constants', () => ({ default: { appOwnership: 'standalone' } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// Drives the real background monitor callback from features/notifications/services/notifications.ts with
// stubbed Expo/AsyncStorage/network modules. The scenario under test:
//
//   Task running on Server A -> user switches to Server B -> monitor runs
//
// A's pending record must remain valid, A's own credentials must be used, and
// another server's password must never be borrowed.
//
// Migrated from the standalone tests/notifications-background.test.mjs Node script.
describe('background notification monitor', () => {
  it('keeps records scoped per connection across credential, concurrency, and failure cases', async () => {
    const g: Record<string, any> = {
      __notificationsTestAsyncStorage: new Map(),
      __notificationsTestScheduled: [],
      __notificationsTestDismissed: [],
      __notificationsTestBuilds: [],
      __notificationsTestResolutions: [],
      __notificationsTestResolver: () => undefined,
      __notificationsTestClientFactory: () => ({ session: {} }),
    };
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: {
        async getItem(key: string) {
          if (g.__notificationsFailRead) throw new Error('temporary read failure');
          return g.__notificationsTestAsyncStorage.get(key) ?? null;
        },
        async setItem(key: string, value: string) {
          if (g.__notificationsFailWrite) {
            g.__notificationsFailWrite = false;
            throw new Error('temporary write failure');
          }
          g.__notificationsTestAsyncStorage.set(key, value);
        },
        async removeItem(key: string) { g.__notificationsTestAsyncStorage.delete(key); },
      },
    }));
    vi.doMock('expo-task-manager', () => ({
      isTaskDefined: () => false,
      defineTask: (_name: string, task: unknown) => { g.__notificationsTestTask = task; },
      isTaskRegisteredAsync: async () => false,
    }));
    vi.doMock('expo-background-task', () => ({
      BackgroundTaskStatus: { Available: 1, Restricted: 2, Denied: 3 },
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      getStatusAsync: async () => 1,
      registerTaskAsync: async () => {},
    }));
    vi.doMock('expo-notifications', () => ({
      AndroidImportance: { DEFAULT: 3, LOW: 2 },
      setNotificationHandler: () => {},
      setNotificationChannelAsync: async () => {},
      async scheduleNotificationAsync(request: unknown) {
        g.__notificationsTestScheduled.push(request);
        return 'notification-id';
      },
      async dismissNotificationAsync(identifier: string) { g.__notificationsTestDismissed.push(identifier); },
      getPermissionsAsync: async () => ({ granted: true, status: 'granted', canAskAgain: true }),
      requestPermissionsAsync: async () => ({ granted: true, status: 'granted', canAskAgain: true }),
    }));
    vi.doMock('@/shared/protocol/opencode/client', () => ({
      buildClient(settings: unknown, contract: unknown) {
        g.__notificationsTestBuilds.push({ settings, contract });
        return g.__notificationsTestClientFactory(settings);
      },
      detectServerContract: async () => ({ contract: 'v1' }),
    }));
    vi.doMock('@/shared/storage/connection-profiles', () => ({
      async resolveConnectionCredentials(identity: unknown) {
        g.__notificationsTestResolutions.push(identity);
        const value = g.__notificationsTestResolver(identity);
        return typeof value === 'string' ? { password: value } : value;
      },
    }));
    vi.doMock('@/shared/i18n/index', () => ({ i18n: { t: (key: string) => key } }));
    vi.doMock('@/shared/platform/activity-notifications', () => ({ isActivityCompletionManaged: () => false }));
    vi.doMock('@/shared/protocol/services/session-service', () => ({
      async listSessions(client: { session: { status: () => Promise<{ data: unknown }>; list: () => Promise<{ data: unknown }> } }) {
        const [statuses, sessions] = await Promise.all([client.session.status(), client.session.list()]);
        return { statuses: statuses.data, sessions: sessions.data };
      },
      async readSessionSettlement(_client: unknown, sessionId: string, knownStatus?: { type: string }) {
        if (knownStatus && knownStatus.type !== 'idle') return { state: knownStatus.type === 'retry' ? 'retrying' : 'running' };
        return g.__notificationsTestSettlement?.(sessionId) ?? { state: 'finished' };
      },
    }));
    const { trackPendingTaskFinishedNotification, clearPendingTaskFinishedNotification, listPendingTaskFinishedNotifications, raisePendingAttention, clearPendingAttention } =
      await import('@/features/notifications/services/notifications');

    const storage = g.__notificationsTestAsyncStorage;
    const runTask = g.__notificationsTestTask;
    assert.equal(typeof runTask, 'function', 'background task should be registered at import time');

    const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
    const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

    function seedPending() {
      storage.set(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify({
        [pendingNotificationKey(scopeA, 'session-a')]: {
          sessionId: 'session-a',
          projectPath: '/repo',
          connectionScope: scopeA,
          settings: { serverUrl: 'https://a.example', username: 'alice' },
          requestedAt: 1,
        },
        [pendingNotificationKey(scopeB, 'session-b')]: {
          sessionId: 'session-b',
          sessionTitle: 'B task',
          projectPath: '/repo',
          connectionScope: scopeB,
          settings: { serverUrl: 'https://b.example', username: 'alice' },
          requestedAt: 2,
        },
      }));
    }

    function readPending() {
      const raw = storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    }

    // The persisted store is the single source of truth; scoped reads filter by
    // connection so callers never need a mirrored in-memory copy.
    {
      g.__notificationsTestAsyncStorage.clear();
      seedPending();
      assert.deepEqual((await listPendingTaskFinishedNotifications(scopeA)).map((pending: any) => pending.sessionId), ['session-a']);
      assert.equal((await listPendingTaskFinishedNotifications()).length, 2);
    }

    // 1. Server A's task is still running, so its record stays valid, A's own
    // credentials are used for its server call, and B's finished task notifies and
    // clears only B's record.
    {
      g.__notificationsTestAsyncStorage.clear();
      g.__notificationsTestScheduled.length = 0;
      g.__notificationsTestBuilds.length = 0;
      g.__notificationsTestResolutions.length = 0;
      seedPending();
      const extra = { ...readPending()[pendingNotificationKey(scopeA, 'session-a')], sessionId: 'session-a2' };
      storage.set(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, JSON.stringify({
        ...readPending(), [pendingNotificationKey(scopeA, extra.sessionId)]: extra,
      }));

      // A resolves from its saved profile; B resolves from the active connection.
      const connect = { controlPlaneUrl: 'https://api.opencodecloud.link', machineId: 'machine-a', machineName: 'A', deviceId: 'alice', expiresAt: '2030-01-01T00:00:00Z' };
      g.__notificationsTestResolver = ({ serverUrl }: any) => (
        serverUrl.includes('a.example') ? { password: 'secret-a', connect } : 'secret-b'
      );
      g.__notificationsTestClientFactory = (settings: any) => ({
        session: {
          status: async () => ({ data: { 'session-a': { type: 'busy' }, 'session-a2': { type: 'busy' }, 'session-b': { type: 'idle' } } }),
          list: async () => ({ data: [{ id: 'session-a', title: 'A task' }, { id: 'session-a2', title: 'A second task' }, { id: 'session-b', title: 'B task' }] }),
        },
      });

      assert.equal(await runTask(), 1);

      const pending = readPending();
      assert.equal(Object.keys(pending).length, 2);
      assert.equal(g.__notificationsTestBuilds.length, 2);
      assert.equal(g.__notificationsTestResolutions.length, 2);
      assert.ok(pending[pendingNotificationKey(scopeA, 'session-a')], 'A stays pending while its task runs');
      assert.equal(Boolean(pending[pendingNotificationKey(scopeB, 'session-b')]), false, 'B clears after notifying');

      assert.equal(g.__notificationsTestScheduled.length, 1);
      assert.equal(g.__notificationsTestScheduled[0].content.body, 'B task');
      assert.equal(g.__notificationsTestScheduled[0].content.sound, false);
      assert.equal(g.__notificationsTestScheduled[0].trigger.channelId, 'task-finished-silent');

      const aBuild = g.__notificationsTestBuilds.find(({ settings }: any) => settings.serverUrl.includes('a.example'));
      assert.equal(aBuild.settings.password, 'secret-a');
      assert.equal(aBuild.settings.directory, '/repo');
      assert.deepEqual(aBuild.settings.connect, connect, 'Background clients preserve Connect expiry and transport guards.');
      const bBuild = g.__notificationsTestBuilds.find(({ settings }: any) => settings.serverUrl.includes('b.example'));
      assert.equal(bBuild.settings.password, 'secret-b');
    }

    // 2. When A's credential cannot be resolved (for example the user switched
    // away from an unsaved connection), the monitor must keep A's record and must
    // not fall back to B's password.
    {
      g.__notificationsTestAsyncStorage.clear();
      g.__notificationsTestScheduled.length = 0;
      g.__notificationsTestBuilds.length = 0;
      g.__notificationsTestResolutions.length = 0;
      seedPending();

      g.__notificationsTestResolver = ({ serverUrl }: any) => (
        serverUrl.includes('a.example') ? undefined : 'secret-b'
      );

      assert.equal(await runTask(), 1);

      const pending = readPending();
      assert.ok(pending[pendingNotificationKey(scopeA, 'session-a')], 'unresolvable A stays pending for a later run');
      assert.equal(Boolean(pending[pendingNotificationKey(scopeB, 'session-b')]), false);
      assert.deepEqual(
        g.__notificationsTestResolutions.map(({ serverUrl }: any) => serverUrl).sort(),
        ['https://a.example', 'https://b.example'],
      );
      assert.equal(
        g.__notificationsTestBuilds.some(({ settings }: any) => settings.serverUrl.includes('a.example')),
        false,
        'A is not queried without A credentials',
      );

      // No password is ever serialized into the pending-notification storage.
      const raw = storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
      assert.equal(raw.includes('secret-a'), false);
      assert.equal(raw.includes('secret-b'), false);
    }

    // 3. A server-reported failure notifies with the failure copy, and a still
    // running task keeps its record.
    {
      g.__notificationsTestAsyncStorage.clear();
      g.__notificationsTestScheduled.length = 0;
      g.__notificationsTestBuilds.length = 0;
      seedPending();
      g.__notificationsTestResolver = () => 'secret-a';
      g.__notificationsTestClientFactory = () => ({
        session: {
          status: async () => ({ data: { 'session-a': { type: 'idle' }, 'session-b': { type: 'idle' } } }),
          list: async () => ({ data: [{ id: 'session-a', title: 'A task' }, { id: 'session-b', title: 'B task' }] }),
        },
      });
      g.__notificationsTestSettlement = (id: string) => (id === 'session-b' ? { state: 'failed' } : { state: 'running' });

      assert.equal(await runTask(), 1);

      assert.equal(g.__notificationsTestScheduled.length, 1);
      assert.equal(g.__notificationsTestScheduled[0].content.title, 'notifications:taskFinished.failedTitle');
      assert.equal(g.__notificationsTestScheduled[0].content.body, 'B task');
      assert.ok(readPending()[pendingNotificationKey(scopeA, 'session-a')], 'a running task keeps its record');
      delete g.__notificationsTestSettlement;
    }

    // Concurrent additions and clears must merge rather than overwrite snapshots.
    storage.clear();
    const record = (id: string, requestedAt = 10) => ({ sessionId: id, projectPath: '/repo', connectionScope: scopeA, settings: { serverUrl: 'https://a.example', username: 'alice' }, requestedAt });
    await Promise.all(['one', 'two', 'three'].map((id) => trackPendingTaskFinishedNotification(record(id))));
    assert.equal(Object.keys(readPending()).length, 3);
    await Promise.all([clearPendingTaskFinishedNotification(scopeA, 'one'), trackPendingTaskFinishedNotification(record('four'))]);
    assert.equal(Object.keys(readPending()).length, 3);
    assert.ok(readPending()[pendingNotificationKey(scopeA, 'four')]);

    // The observer adopts a submitted turn instead of replacing its identity.
    assert.equal((await trackPendingTaskFinishedNotification(record('four', 20), true)).requestedAt, 10);
    assert.equal(await clearPendingTaskFinishedNotification(scopeA, 'four', 20), false);
    assert.equal(await clearPendingTaskFinishedNotification(scopeA, 'four', 10), true);
    assert.equal(await clearPendingTaskFinishedNotification(scopeA, 'four', 10), false);

    const original = storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY);
    g.__notificationsFailRead = true;
    await assert.rejects(trackPendingTaskFinishedNotification(record('five')), /temporary read failure/);
    assert.equal(storage.get(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY), original);
    assert.equal(await runTask(), 2, 'unreadable storage makes monitoring retryable');
    g.__notificationsFailRead = false;
    g.__notificationsFailWrite = true;
    await assert.rejects(trackPendingTaskFinishedNotification(record('five')), /temporary write failure/);
    await trackPendingTaskFinishedNotification(record('five'));
    assert.ok(readPending()[pendingNotificationKey(scopeA, 'five')], 'a rejected mutation must not poison the queue');

    // A background network snapshot cannot clear or notify a newly re-sent task.
    storage.clear(); g.__notificationsTestScheduled.length = 0;
    await trackPendingTaskFinishedNotification(record('resend', 100));
    const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    g.__notificationsTestResolver = () => 'secret-a';
    g.__notificationsTestClientFactory = () => ({ session: {
      status: async () => { entered.resolve(); await gate.promise; return { data: { resend: { type: 'idle' } } }; },
      list: async () => ({ data: [{ id: 'resend', title: 'Old task' }] }),
    } });
    const monitoring = runTask(); await entered.promise;
    await Promise.all([trackPendingTaskFinishedNotification(record('resend', 200)), trackPendingTaskFinishedNotification(record('during-monitor', 201))]);
    gate.resolve(); await monitoring;
    assert.equal(readPending()[pendingNotificationKey(scopeA, 'resend')].requestedAt, 200);
    assert.ok(readPending()[pendingNotificationKey(scopeA, 'during-monitor')]);
    assert.equal(g.__notificationsTestScheduled.length, 0);

    storage.set(storageKeys.PENDING_NOTIFICATION_SESSIONS_STORAGE_KEY, '{');
    await trackPendingTaskFinishedNotification(record('after-corruption'));
    assert.equal(Object.keys(readPending()).length, 1, 'malformed JSON can be replaced safely');

    // Needs-input alerts reuse one identifier per chat and are dismissed when
    // the request is resolved, so repeated approvals cannot stack entries.
    storage.clear(); g.__notificationsTestScheduled.length = 0; g.__notificationsTestDismissed.length = 0;
    await trackPendingTaskFinishedNotification(record('blocked'));
    assert.equal(await raisePendingAttention(scopeA, 'blocked', 'blocked'), true);
    const attention = g.__notificationsTestScheduled.at(-1);
    assert.equal(attention.identifier, `attention:${scopeA}:blocked`);
    assert.equal(attention.content.body, 'notifications:activity.needsInput');
    assert.equal(await raisePendingAttention(scopeA, 'blocked', 'blocked'), false, 'one alert per block episode');
    assert.equal(g.__notificationsTestScheduled.length, 1);
    assert.equal(await clearPendingAttention(scopeA, 'blocked'), true);
    assert.equal(g.__notificationsTestDismissed.at(-1), attention.identifier);
    assert.equal(await raisePendingAttention(scopeA, 'blocked', 'blocked'), true, 'a later episode re-arms');
    assert.equal(g.__notificationsTestScheduled.at(-1).identifier, attention.identifier, 'the same chat reuses one notification');
  });
});
