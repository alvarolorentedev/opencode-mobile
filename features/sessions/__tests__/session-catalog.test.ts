import { describe, expect, it } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

const client = { __opencode: { contract: 'v2', directory: '/repo' } };

describe('session catalog', () => {
  it('keeps the project list and the connection status map in separate Query entries', async () => {
    const driver = hookRuntime();
    const { useSessionCatalog } = await loadTs('features/sessions/state/use-session-catalog.ts', {
      react: driver.react,
      '@/shared/protocol/opencode/client': { withReadSignal: (value: object) => value },
      '@/shared/protocol/services/session-service': { listSessions: async () => ({ sessions: [], statuses: {} }) },
    }, driver.globals);

    driver.mount(() => useSessionCatalog(client as never), {});
    driver.value.setSessions([{ id: 's1', title: 'one', time: { created: 1, updated: 1 } }]);
    driver.flush();
    expect(driver.value.sessions).toHaveLength(1);
    expect(driver.value.sessionStatuses).toEqual({});
    expect(driver.value.sessionsRef.current).toEqual(driver.value.sessions);

    driver.value.setSessionStatuses({ s1: { type: 'busy' } });
    driver.flush();
    expect(driver.value.sessions).toHaveLength(1);
    expect(driver.value.sessionStatuses).toEqual({ s1: { type: 'busy' } });
    driver.unmount();
  });
});
