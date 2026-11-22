import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FAVORITE_SESSIONS_MAX as MAX, type FavoriteSession } from '@/features/sessions/model/types';
import { parseFavoriteSessions, serializeFavoriteSessions } from '@/features/sessions/services/favorites-storage';
import { getConnectionScope } from '@/shared/contracts/connection-scope';

describe('favorite session storage', () => {
  it('validates, scopes, caps, and strips secrets from persisted favorites', async () => {
    const scopeA = getConnectionScope({ serverUrl: 'https://a.example', username: 'alice' });
    const scopeB = getConnectionScope({ serverUrl: 'https://b.example', username: 'alice' });

    // 1. Valid hydration maps to the explicit model and strips unknown/legacy
    // fields such as `projectLabel`.
    {
      const raw = JSON.stringify([
        {
          sessionId: 's1',
          connectionScope: scopeA,
          projectPath: '/work/a',
          projectLabel: 'a',
          title: 'Alpha',
          favoritedAt: 10,
          password: 'leaked',
        },
        { sessionId: 's2', connectionScope: scopeA, projectPath: '/work/b', favoritedAt: 20 },
      ]);
      assert.deepEqual(parseFavoriteSessions(raw), [
        { sessionId: 's1', connectionScope: scopeA, projectPath: '/work/a', title: 'Alpha', favoritedAt: 10 },
        { sessionId: 's2', connectionScope: scopeA, projectPath: '/work/b', favoritedAt: 20 },
      ]);
      assert.equal(JSON.stringify(parseFavoriteSessions(raw)).includes('leaked'), false);
    }

    // 2. Malformed entries are discarded individually; valid ones survive.
    {
      const raw = JSON.stringify([
        { sessionId: 'ok', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
        { sessionId: '', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
        { sessionId: 'no-path', connectionScope: scopeA, projectPath: '', favoritedAt: 1 },
        { sessionId: 'no-time', connectionScope: scopeA, projectPath: '/work/a' },
        { sessionId: 'bad-time', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 'yesterday' },
        { sessionId: 'bad-title', connectionScope: scopeA, projectPath: '/work/a', title: 42, favoritedAt: 1 },
        { sessionId: 'bad-scope', connectionScope: '', projectPath: '/work/a', favoritedAt: 1 },
        'not-an-object',
        null,
      ]);
      assert.deepEqual(parseFavoriteSessions(raw), [
        { sessionId: 'ok', connectionScope: scopeA, projectPath: '/work/a', favoritedAt: 1 },
      ]);
    }

    // 3. Favorites persisted before multi-server support carry no connection scope,
    // so they are dropped instead of being attributed to whichever server happens
    // to be active.
    {
      const legacy = JSON.stringify([
        { sessionId: 'old-1', projectPath: '/work/a', title: 'Legacy', favoritedAt: 1 },
        { sessionId: 'old-2', projectPath: '/work/a', favoritedAt: 2 },
      ]);
      assert.deepEqual(parseFavoriteSessions(legacy), []);
    }

    // 4. Identical project paths and session IDs on two servers stay independent.
    {
      const raw = JSON.stringify([
        { sessionId: 'shared', connectionScope: scopeA, projectPath: '/srv/same', title: 'A copy', favoritedAt: 1 },
        { sessionId: 'shared', connectionScope: scopeB, projectPath: '/srv/same', title: 'B copy', favoritedAt: 2 },
      ]);
      const parsed = parseFavoriteSessions(raw);
      assert.equal(parsed.length, 2);
      assert.deepEqual(parsed.map((favorite: any) => favorite.connectionScope).sort(), [scopeA, scopeB].sort());
      assert.deepEqual(parsed.map((favorite: any) => favorite.title).sort(), ['A copy', 'B copy']);
    }

    // 5. The maximum is enforced on hydration, so a corrupt value cannot hydrate an
    // unbounded list.
    {
      const raw = JSON.stringify(
        Array.from({ length: MAX + 25 }, (_, index) => ({
          sessionId: `s${index}`,
          connectionScope: scopeA,
          projectPath: '/work/a',
          favoritedAt: index,
        })),
      );
      const parsed = parseFavoriteSessions(raw);
      assert.equal(parsed.length, MAX);
      assert.equal(parsed[0].sessionId, 's0');
      assert.equal(parsed[MAX - 1].sessionId, `s${MAX - 1}`);
    }

    // 6. A non-array payload is rejected so the loader removes the key.
    {
      assert.throws(() => parseFavoriteSessions('{"sessionId":"s1"}'));
      assert.throws(() => parseFavoriteSessions('{not json'));
    }

    // 7. Serialized output is capped and only contains the explicit model fields.
    {
      const oversized = Array.from({ length: MAX + 5 }, (_, index) => ({
        sessionId: `s${index}`,
        connectionScope: scopeA,
        projectPath: '/work/a',
        title: `T${index}`,
        projectLabel: 'legacy',
        password: 'leaked',
        favoritedAt: index,
      }));
      const serialized = JSON.parse(serializeFavoriteSessions(oversized));
      assert.equal(serialized.length, MAX);
      assert.deepEqual(Object.keys(serialized[0]).sort(), ['connectionScope', 'favoritedAt', 'projectPath', 'sessionId', 'title']);
      assert.equal(serializeFavoriteSessions(oversized).includes('leaked'), false);

      // Legacy entries cannot be serialized back either.
      assert.deepEqual(JSON.parse(serializeFavoriteSessions([
        { sessionId: 'old', projectPath: '/work/a', favoritedAt: 1 } as FavoriteSession,
      ])), []);
    }
  });
});
