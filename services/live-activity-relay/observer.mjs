import { OpenCode } from '@opencode/client';

// Authoritative durable event reads on the relay, never a second phone poller.
// Each enrollment allowlists fixed session IDs on operator-owned V2 servers.
export function createObserver(sources, make = OpenCode.make) {
  const clients = new Map();
  for (const [id, source] of Object.entries(sources)) {
    const url = new URL(source.url);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invalid source URL');
    clients.set(id, make({ baseUrl: url.origin, headers: source.headers,
      fetch: (input, init) => fetch(input, { ...init, redirect: 'error',
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) }));
  }
  return async (subscriptions, startedAt) => {
    const states = await Promise.all(subscriptions.map(async ({ source, sessionID }) => {
      const api = clients.get(source);
      if (!api) throw new Error('Unknown source');
      // Finite replay survives relay restarts and missed SSE events.
      // Oversized history fails closed rather than guessing completion.
      let execution;
      let seq = -1;
      let count = 0;
      let synced = false;
      for await (const event of api.session.log({ sessionID, follow: false })) {
        if (++count > 10000) throw new Error('Session log limit');
        if (event.type === 'log.synced') { synced = true; continue; }
        if (event.data?.sessionID !== sessionID || !Number.isSafeInteger(event.durable?.seq)) throw new Error('Invalid session log');
        if (event.durable.seq <= seq) continue;
        seq = event.durable.seq;
        const phase = { 'session.execution.started': 'thinking', 'session.step.started': 'thinking', 'session.retry.scheduled': 'retrying',
          'session.execution.succeeded': 'finished', 'session.execution.failed': 'failed',
          'session.execution.interrupted': 'stopped' }[event.type];
        if (phase) execution = { phase, created: event.created };
      }
      if (!synced) throw new Error('Incomplete session log');
      const [inbox, permissions, forms] = await Promise.all([
        api.session.inbox.list({ sessionID }), api.permission.list({ sessionID }), api.session.form.list({ sessionID }),
      ]);
      if (![inbox, permissions, forms].every(Array.isArray)) throw new Error('Invalid observation');
      if (permissions.length || forms.length) return 'needsInput';
      if (inbox.length) return 'queued';
      if (execution && (['thinking', 'retrying'].includes(execution.phase) || execution.created >= startedAt * 1000)) return execution.phase;
      return 'stopped';
    }));
    const running = states.filter((phase) => !['finished', 'failed', 'stopped'].includes(phase));
    const phase = running.includes('needsInput') ? 'needsInput' : running.includes('retrying') ? 'retrying'
      : running.includes('thinking') ? 'thinking' : running.length ? 'queued'
        : states.includes('failed') ? 'failed' : states.includes('finished') ? 'finished' : 'stopped';
    return { phase, count: running.length };
  };
}
