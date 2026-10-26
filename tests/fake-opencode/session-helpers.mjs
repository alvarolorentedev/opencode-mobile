import { completedTask, permissionRequest, questionForm, toNativeFileDiffs } from './fixtures.mjs';
import { resolveProject } from './state.mjs';
export const FAKE_MODEL = { id: 'openai/gpt-4.1-mini', providerID: 'openai' };
export const ASSISTANT_USAGE = { input: 1200, output: 240, reasoning: 0, cache: { read: 800, write: 100 } };
export const ASSISTANT_COST = 0.0021;
export function createSessionHelpers({ getNow, getState, emitEvent }) {
  const getSession = (id) => getState().sessions.find((session) => session.id === id);
  const getMessages = (id) => getState().messagesBySession[id] || [];
  const send = (type, data) => emitEvent({ type, data });
  function createSession(title = '', directory) {
    const state = getState(), project = resolveProject(state, directory) || state.project;
    const session = { id: `session-${state.nextSessionId++}`, projectID: project.id, location: { directory: directory || project.canonical }, title, model: { ...FAKE_MODEL }, agent: 'build', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: getNow(), updated: getNow() } };
    state.sessions.unshift(session); state.messagesBySession[session.id] = []; state.sessionStatuses[session.id] = { type: 'idle' };
    send('session.created', { sessionID: session.id, projectID: project.id, location: session.location });
    return session;
  }
  function createMessage(sessionID, type, payload, extra = {}) {
    const state = getState();
    const record = { id: `message-${state.nextMessageId++}`, type, time: { created: getNow() }, ...payload, ...extra };
    state.messagesBySession[sessionID] = [...getMessages(sessionID), record];
    const session = getSession(sessionID); if (session) session.time.updated = getNow();
    send('session.message.content.updated', { sessionID, messageID: record.id, content: record.content || [] });
    return record;
  }
  function finish(sessionID, record) {
    record.time.completed = getNow(); record.tokens = structuredClone(ASSISTANT_USAGE); record.cost = ASSISTANT_COST; record.finish = 'stop';
    const session = getSession(sessionID);
    if (session) {
      session.cost += record.cost; session.time.updated = getNow();
      for (const key of ['input', 'output', 'reasoning']) session.tokens[key] += record.tokens[key];
      session.tokens.cache.read += record.tokens.cache.read; session.tokens.cache.write += record.tokens.cache.write;
    }
  }
  function completePrompt(sessionID, promptText = '') {
    const state = getState();
    const user = getMessages(sessionID).filter((message) => message.type === 'user').at(-1);
    const previous = Object.keys(state.diffsByTurn[sessionID] || {}).length;
    const { source, todos, text } = completedTask(previous, promptText);
    const diff = toNativeFileDiffs([source]);
    if (user) { state.diffsByTurn[sessionID] ||= {}; state.diffsByTurn[sessionID][user.id] = diff; }
    state.todosBySession[sessionID] = todos; state.workspaceTaskCompleted = true;
    const assistant = createMessage(sessionID, 'assistant', { agent: 'build', model: getSession(sessionID)?.model || FAKE_MODEL, content: [{ type: 'text', text }, { type: 'tool', id: `todowrite-${getNow()}`, name: 'todowrite', time: { created: getNow(), completed: getNow() }, state: { status: 'completed', input: { todos }, content: [{ type: 'text', text: 'Plan updated' }] } }], snapshot: { start: `before-${user?.id}`, end: `after-${user?.id}`, files: diff.map((item) => item.file) } });
    finish(sessionID, assistant);
    createMessage(sessionID, 'idle', { outcome: 'succeeded' });
    state.sessionStatuses[sessionID] = { type: 'idle' };
    send('session.step.ended', { sessionID, messageID: assistant.id }); send('session.execution.succeeded', { sessionID });
    const session = getSession(sessionID);
    if (session && !session.title.trim()) { session.title = (promptText || 'Untitled chat').trim().split(/\s+/).slice(0, 4).join(' '); send('session.renamed', { sessionID, title: session.title }); }
  }
  function later(delay, action) {
    const state = getState(); const timer = setTimeout(() => { state.completionTimers.delete(timer); action(); }, delay); state.completionTimers.add(timer);
  }
  const scheduleCompletion = (id, text) => later(700, () => completePrompt(id, text));
  function scheduleRetry(sessionID, text) {
    const state = getState(); const error = { type: 'SessionError', message: 'The provider response ended unexpectedly.' };
    const assistant = createMessage(sessionID, 'assistant', { agent: 'build', model: FAKE_MODEL, content: [], error, retry: { attempt: 2, at: getNow() + 5000, error } });
    later(300, () => { state.sessionStatuses[sessionID] = { type: 'retry' }; send('session.execution.failed', { sessionID, error }); send('session.retry.scheduled', { sessionID, assistantMessageID: assistant.id, attempt: 2, at: getNow() + 5000, error }); });
    later(7000, () => { assistant.content.push({ type: 'text', text: `Recovered: ${text || 'task complete'} after the provider retry.` }); delete assistant.error; delete assistant.retry; finish(sessionID, assistant); state.sessionStatuses[sessionID] = { type: 'idle' }; });
  }
  function createPermissionRequest(sessionID) {
    const state = getState(); const request = permissionRequest(`permission-${state.nextPendingId++}`, sessionID);
    state.pendingPermissions = [request]; send('permission.asked', request);
  }
  function createQuestionRequest(sessionID) {
    const state = getState(); const form = questionForm(`question-${state.nextPendingId++}`, sessionID, state.scenario === 'question-multi');
    state.pendingQuestions = [form]; send('form.created', { form });
  }
  function handlePromptSubmission(sessionID, input) {
    const state = getState(); const text = input.text?.trim() || '';
    const agents = input.agents || [];
    const skills = input.skills || [];
    const files = input.files || [];
    createMessage(sessionID, 'user', {
      text: text || (files.length ? '' : 'Triggered from CI flow test.'),
      ...(files.length ? { files } : {}),
      ...(agents.length ? { agents } : {}),
      ...(skills.length ? { skills } : {}),
    }, input.messageID ? { id: input.messageID } : {});
    const context = [
      ...agents.map((agent) => `@${agent.name}`),
      ...skills.map((skill) => `@${skill.name || skill.id}`),
      ...files.filter((file) => file.mention).map((file) => file.mention.text),
    ];
    const promptText = [text, context.length ? `Context: ${context.join(' ')}` : ''].filter(Boolean).join(' ');
    state.sessionStatuses[sessionID] = { type: 'busy' }; send('session.execution.started', { sessionID });
    if (state.scenario === 'inbox') { createMessage(sessionID, 'assistant', { agent: 'build', model: FAKE_MODEL, content: [{ type: 'text', text: `Working on: ${text}` }] }); return; }
    if (state.scenario === 'permission') return createPermissionRequest(sessionID);
    if (state.scenario.startsWith('question')) return createQuestionRequest(sessionID);
    if (state.scenario === 'retry') return scheduleRetry(sessionID, promptText);
    scheduleCompletion(sessionID, promptText);
  }
  function handleShell(sessionID, command) {
    const output = `ran: ${command}`;
    const shell = createMessage(sessionID, 'shell', {
      command,
      status: 'exited',
      exit: 0,
      output: { output, cursor: output.length, size: output.length, truncated: false },
      time: { created: getNow(), completed: getNow() },
    });
    send('session.shell.ended', { sessionID, shellID: shell.id, shell: { command, status: 'exited', exit: 0 } });
    getState().sessionStatuses[sessionID] = { type: 'idle' };
    return shell;
  }
  function handleCommand(sessionID, body) {
    const text = `/${body.command || 'unknown'}${body.arguments?.trim() ? ` ${body.arguments.trim()}` : ''}`;
    createMessage(sessionID, 'user', { text });
    const assistant = createMessage(sessionID, 'assistant', { agent: 'build', model: FAKE_MODEL, content: [{ type: 'text', text: `Command ${text} completed.` }] }); finish(sessionID, assistant);
    getState().sessionStatuses[sessionID] = { type: 'idle' }; send('session.execution.succeeded', { sessionID }); return assistant;
  }
  return { getSession, getMessages, createSession, createMessage, completePrompt, scheduleCompletion, handlePromptSubmission, handleCommand, handleShell, createPermissionRequest, createQuestionRequest };
}
