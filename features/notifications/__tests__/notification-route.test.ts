import { describe, expect, it } from 'vitest';
import { notificationResponseKey, parseNotificationRoute } from '@/shared/contracts/notification-route';

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

  it('treats a reused identifier with a newer delivery as a new response', () => {
    expect(notificationResponseKey('attention:s1', 10)).toBe('attention:s1:10');
    expect(notificationResponseKey('attention:s1', 10)).toBe(notificationResponseKey('attention:s1', 10));
    expect(notificationResponseKey('attention:s1', 11)).not.toBe(notificationResponseKey('attention:s1', 10));
    expect(notificationResponseKey(undefined, 10)).toBeUndefined();
  });
});
