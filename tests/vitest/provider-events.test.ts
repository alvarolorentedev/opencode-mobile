import { describe, expect, it, vi } from 'vitest';

import { handleProviderEvent, type ProviderEventActions } from '@/providers/opencode-provider-events';

function createActions() {
  const calls = {
    refreshSessions: vi.fn(async () => undefined),
    refreshMcpServers: vi.fn(async () => undefined),
    refreshProjectCatalog: vi.fn(async () => undefined),
    refreshChatCapabilities: vi.fn(async () => undefined),
    refreshServerFeatures: vi.fn(async () => undefined),
    scheduleSessionRefresh: vi.fn(),
    setMcpAuthPrompt: vi.fn(),
  };
  const actions = {
    refreshSessions: calls.refreshSessions,
    refreshArchivedSessions: async () => undefined,
    scheduleSessionRefresh: calls.scheduleSessionRefresh,
    refreshPendingInteractions: async () => undefined,
    refreshServerFeatures: calls.refreshServerFeatures,
    refreshChatCapabilities: calls.refreshChatCapabilities,
    refreshProjectCatalog: calls.refreshProjectCatalog,
    refreshTerminals: async () => undefined,
    refreshWorktrees: async () => undefined,
    refreshMcpServers: calls.refreshMcpServers,
    refreshDiagnostics: async () => undefined,
    setSessionStatuses: vi.fn(),
    setPromptError: vi.fn(),
    setDiffsBySession: vi.fn(),
    setTodosBySession: vi.fn(),
    setPendingPermissionsBySession: vi.fn(),
    setPendingQuestionsBySession: vi.fn(),
    setMcpAuthPrompt: calls.setMcpAuthPrompt,
    selectedDiffMessageBySessionRef: { current: {} },
  } as unknown as ProviderEventActions;
  return { actions, calls };
}

describe('handleProviderEvent', () => {
  it('surfaces an MCP browser open failure and refreshes MCP servers', () => {
    const { actions, calls } = createActions();
    handleProviderEvent(
      { type: 'compatibility', payload: { id: 'e', type: 'mcp.browser.open.failed', properties: { mcpName: 'remote', url: 'https://example.com/auth' } } } as never,
      actions,
    );
    expect(calls.setMcpAuthPrompt).toHaveBeenCalledWith({ mcpName: 'remote', url: 'https://example.com/auth' });
    expect(calls.refreshMcpServers).toHaveBeenCalled();
  });

  it('refreshes the transcript tail on a part delta', () => {
    const { actions, calls } = createActions();
    handleProviderEvent({ id: 'e', type: 'session.text.delta', data: { sessionID: 's1' } } as never, actions);
    expect(calls.scheduleSessionRefresh).toHaveBeenCalledWith('s1', { messages: true });
  });

  it('refreshes the project catalog when project directories change', () => {
    const { actions, calls } = createActions();
    handleProviderEvent({ id: 'e', type: 'project.updated', data: { projectID: 'p1' } } as never, actions);
    expect(calls.refreshProjectCatalog).toHaveBeenCalledWith(true);
  });

  it('refreshes sessions when a subagent asks for permission', () => {
    const { actions, calls } = createActions();
    handleProviderEvent(
      { id: 'e', type: 'permission.asked', data: { id: 'perm-1', sessionID: 'child', action: 'edit', resources: [] } } as never,
      actions,
    );
    expect(calls.refreshSessions).toHaveBeenCalled();
  });
});

describe('native event status and legacy translation', () => {
  it('preserves native status payloads and translates compatible v1 approvals', async () => {
    const { getEventSessionStatus } = await import('@/lib/opencode/events');
    const { translateCompatibilityEvent } = await import('@/lib/opencode/compat/v1/events');
    const status = { type: 'retry', attempt: 3, next: 100, message: 'Retry', action: { reason: 'r', provider: 'p', title: 't', message: 'm', label: 'l' } } as const;
    expect(getEventSessionStatus({ type: 'session.status', data: { sessionID: 's', status } })).toEqual({ sessionID: 's', status });
    const translated = translateCompatibilityEvent({ directory: '/repo', payload: { type: 'permission.asked', properties: { id: 'r', sessionID: 's', permission: 'edit', patterns: ['src/*'], always: ['src/*'], metadata: {}, tool: { messageID: 'm', callID: 'c' } } } } as never);
    expect(translated).toMatchObject({ type: 'permission.asked', location: { directory: '/repo' }, data: { action: 'edit', resources: ['src/*'], source: { type: 'tool', messageID: 'm', id: 'c' } } });
    expect(translateCompatibilityEvent({ directory: '/repo', payload: { type: 'mcp.browser.open.failed', properties: { mcpName: 'tools', url: 'https://login.test' } } } as never).type).toBe('compatibility');
  });
});
