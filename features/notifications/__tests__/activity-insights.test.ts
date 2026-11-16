import { describe, expect, it } from 'vitest';
import { getSessionActivities, type ActivitySnapshot } from '../model/activity-notification-state';

function user(id = 'prompt', created = 10) {
  return { info: { id, role: 'user', time: { created } }, parts: [] } as any;
}
function tool(tool = 'read', status = 'running', input: any = {}, id = 'tool') {
  return { type: 'tool', id, callID: id, tool, state: { status, input, output: '', title: 'PRIVATE /secret.txt' } } as any;
}
function assistant(parts: any[], parentID = 'prompt', created = 11) {
  return { info: { id: `step-${created}`, role: 'assistant', parentID, time: { created } }, parts } as any;
}
function state(records: any[] = [user(), assistant([])]): ActivitySnapshot {
  return { sessions: [{ id: 'root', directory: '/repo', time: { created: 1, updated: 12 } } as any],
    statuses: { root: { type: 'busy' } }, blocked: new Set(), queued: new Set(), messages: { root: records } };
}
function plan(statuses: (string | undefined)[], status = 'completed') {
  return tool('todowrite', status, { todos: statuses.map((value) => ({ content: 'PRIVATE task description', status: value })) }, 'plan');
}

describe('factual activity insights', () => {
  it('derives only confirmed root-plan progress, not a child plan or a previous turn', () => {
    const snapshot = state([user('old', 1), assistant([plan(['completed', 'completed'])], 'old', 2), user(),
      assistant([plan(['completed', 'pending', 'in_progress'])])]);
    snapshot.sessions.push({ id: 'child', parentID: 'root', directory: '/repo', time: { created: 10, updated: 12 } } as any);
    snapshot.statuses.child = { type: 'busy' };
    snapshot.messages.child = [user('child-prompt', 10), assistant([plan(['completed'])], 'child-prompt')];
    const activity = getSessionActivities(snapshot)[0];
    expect(activity).toMatchObject({ runId: 'prompt', progress: { completed: 1, total: 3 }, agentCount: 2, toolCount: 0 });
    expect(activity).not.toHaveProperty('filesChanged');
    expect(JSON.stringify(activity)).not.toContain('PRIVATE task description');
  });

  it.each(['pending', 'running', 'error'])('omits unconfirmed %s todowrite progress', (status) => {
    expect(getSessionActivities(state([user(), assistant([plan(['completed'], status)])]))[0].progress).toBeUndefined();
  });

  it('does not use a stale successful plan while a replacement is still running', () => {
    const snapshot = state([user(), assistant([plan(['completed'])]), assistant([plan(['pending'], 'running')], 'prompt', 12)]);
    expect(getSessionActivities(snapshot)[0].progress).toBeUndefined();
  });

  it('keeps cancelled/failed tasks unfinished in the denominator and omits unknown/malformed statuses', () => {
    expect(getSessionActivities(state([user(), assistant([plan(['completed', 'failed', 'cancelled', 'pending'])])]))[0].progress)
      .toEqual({ completed: 1, total: 4 });
    for (const statuses of [['completed', 'unknown'], ['completed', undefined], []]) {
      expect(getSessionActivities(state([user(), assistant([plan(statuses)])]))[0].progress).toBeUndefined();
    }
    const malformed = plan(['completed']); malformed.state.input.todos.push({ status: 'completed' });
    expect(getSessionActivities(state([user(), assistant([malformed])]))[0].progress).toBeUndefined();
  });

  it('uses an assistant parent anchor when the prompt falls outside the window', () => {
    const activity = getSessionActivities(state([assistant([plan(['pending', 'completed'])])]))[0];
    expect(activity).toMatchObject({ runId: 'prompt', progress: { completed: 1, total: 2 }, agentCount: 1 });
    expect(activity.toolCount).toBeUndefined(); expect(activity.workPhase).toBeUndefined();
  });

  it('uses an observed root tool phase without claiming a complete count for a partial window', () => {
    const activity = getSessionActivities(state([assistant([plan(['pending', 'completed']), tool('read')])]))[0];
    expect(activity).toMatchObject({ runId: 'prompt', progress: { completed: 1, total: 2 }, workPhase: 'reading', agentCount: 1 });
    expect(activity.toolCount).toBeUndefined();
    // Android continues to receive the original visible tool title.
    expect(activity.tool).toBe('PRIVATE /secret.txt');
  });

  it('reports an actual zero only when the complete current turn is in the window', () => {
    expect(getSessionActivities(state([user(), assistant([plan(['pending', 'completed'])])]))[0])
      .toMatchObject({ toolCount: 0, progress: { completed: 1, total: 2 } });
  });

  it('keeps observed root phases when child history is incomplete and excludes unaligned child phases', () => {
    const snapshot = state([user(), assistant([tool('read')])]);
    snapshot.sessions.push({ id: 'child', parentID: 'root', directory: '/repo', time: { created: 1, updated: 12 } } as any);
    snapshot.statuses.child = { type: 'busy' };
    snapshot.messages.child = [assistant([tool('edit')], 'child-prompt')];
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ workPhase: 'reading', agentCount: 2 });
    expect(getSessionActivities(snapshot)[0].toolCount).toBeUndefined();
    snapshot.messages.root = [assistant([])];
    snapshot.messages.child = [user('child-prompt', 10), assistant([tool('edit')], 'child-prompt')];
    expect(getSessionActivities(snapshot)[0].toolCount).toBeUndefined();
    expect(getSessionActivities(snapshot)[0].workPhase).toBeUndefined();
  });

  it('omits unknown insights and never reuses tools or plans from a previous root turn', () => {
    const snapshot = state([user('old', 1), assistant([tool(), plan(['completed'])], 'old', 2), user()]);
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ toolCount: 0, agentCount: 1 });
    expect(getSessionActivities(snapshot)[0].progress).toBeUndefined();
    expect(getSessionActivities(snapshot)[0].workPhase).toBeUndefined();
    const unknown = getSessionActivities(state([]))[0];
    expect(unknown.toolCount).toBeUndefined(); expect(unknown.progress).toBeUndefined();
    expect(unknown.workPhase).toBeUndefined(); expect(unknown.agentCount).toBe(1);
  });

  it.each([
    ['read', 'reading'], ['read_file', 'reading'], ['edit', 'editing'], ['write', 'editing'], ['apply_patch', 'editing'],
    ['grep', 'searching'], ['glob', 'searching'], ['list', 'searching'], ['bash', 'executing'], ['shell', 'executing'],
    ['task', 'delegating'], [' READ ', 'reading'], ['private_custom_tool', undefined], ['test', undefined],
  ])('whitelists %s as %s without interpreting command text', (name, phase) => {
    const activity = getSessionActivities(state([user(), assistant([tool(name, 'running', { command: 'npm test /PRIVATE' })])]))[0];
    expect(activity.workPhase).toBe(phase); expect(activity.toolCount).toBe(1);
  });

  it('deduplicates part and call IDs, counts pending/running, and ignores settled tools', () => {
    const completed = tool('edit', 'completed', {}, 'call');
    const pending = tool('grep', 'pending', {}, 'pending');
    const duplicateCall = { ...pending, id: 'other-part' };
    const snapshot = state([user(), assistant([tool('edit', 'running', {}, 'call'), pending]),
      assistant([completed, duplicateCall, tool('read', 'error', {}, 'failed')], 'prompt', 12)]);
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ toolCount: 1, workPhase: 'searching' });
  });

  it('counts verified active family members with at least one root agent and treats unanchored child tools as unknown', () => {
    const snapshot = state();
    snapshot.sessions.push({ id: 'child', parentID: 'root', directory: '/repo', time: { created: 1, updated: 12 } } as any);
    snapshot.statuses.child = { type: 'busy' }; snapshot.statuses.root = { type: 'idle' };
    snapshot.messages.child = [user('old-child', 2), assistant([tool()], 'old-child', 3)];
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ active: true, agentCount: 1 });
    expect(getSessionActivities(snapshot)[0].toolCount).toBeUndefined();
    snapshot.messages.child = [user('child-prompt', 10), assistant([tool()], 'child-prompt')];
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ agentCount: 1, toolCount: 1, workPhase: 'reading' });
  });

  it('preserves blocked, retry and terminal classification over work-phase hints', () => {
    const snapshot = state([user(), assistant([tool('edit'), plan(['completed', 'pending'])])]);
    snapshot.blocked.add('root');
    expect(getSessionActivities(snapshot)[0].state).toBe('needsInput');
    snapshot.blocked.clear(); snapshot.statuses.root = { type: 'retry', attempt: 1, next: 20, message: 'private' };
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ state: 'retrying', progress: { completed: 1, total: 2 } });
    snapshot.statuses.root = { type: 'idle' };
    expect(getSessionActivities(snapshot)[0]).toMatchObject({ state: 'finished', progress: { completed: 1, total: 2 } });
    expect(getSessionActivities(snapshot)[0].workPhase).toBeUndefined();
  });
});
