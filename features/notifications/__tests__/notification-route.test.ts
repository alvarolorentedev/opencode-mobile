import { describe, expect, it } from 'vitest';
import { parseNotificationRoute } from '@/shared/contracts/notification-route';

describe('notification route payload', () => {
  it('accepts the non-secret session, project, and scope fields', () => {
    expect(parseNotificationRoute({ sessionId: 's1', projectPath: '/repo', connectionScope: 'scope' }))
      .toEqual({ sessionId: 's1', projectPath: '/repo', connectionScope: 'scope' });
  });

  it('rejects payloads without a session id and drops empty fields', () => {
    expect(parseNotificationRoute(undefined)).toBeUndefined();
    expect(parseNotificationRoute({ projectPath: '/repo' })).toBeUndefined();
    expect(parseNotificationRoute({ sessionId: '  ' })).toBeUndefined();
    expect(parseNotificationRoute({ sessionId: 's1', projectPath: '', connectionScope: '  ' })).toEqual({ sessionId: 's1' });
  });
});
