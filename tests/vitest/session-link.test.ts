import { describe, expect, it } from 'vitest';

import { buildSessionLink } from '@/lib/session-link';

describe('session link', () => {
  it('builds the resolver payload with encoded session, project, and scope', () => {
    expect(buildSessionLink({ sessionId: 's 1', projectPath: '/repo one', connectionScope: 'https://host:1/a?b' }))
      .toBe('opencodemobile://session/s%201?project=%2Frepo%20one&connectionScope=https%3A%2F%2Fhost%3A1%2Fa%3Fb');
  });

  it('keeps the link prefix the app and widget click actions rely on', () => {
    expect(buildSessionLink({ sessionId: 's1', projectPath: '/repo', connectionScope: 'scope' }))
      .toBe('opencodemobile://session/s1?project=%2Frepo&connectionScope=scope');
  });
});
