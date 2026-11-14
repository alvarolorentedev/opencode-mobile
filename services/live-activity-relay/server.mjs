import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSender } from './apns.mjs';
import { createObserver } from './observer.mjs';
import { createRegistry } from './registry.mjs';

export function createHandler(registry) {
  const limits = new Map();
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const finish = (status) => { response.writeHead(status); response.end(); };
    const authorization = request.headers.authorization;
    const owner = registry.authenticate(authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined);
    if (!owner) { request.resume(); finish(401); return; }
    const minute = Math.floor(Date.now() / 60000);
    const limit = limits.get(owner);
    const count = limit?.minute === minute ? limit.count + 1 : 1;
    limits.set(owner, { minute, count });
    if (count > 30) { request.resume(); finish(429); return; }
    if (request.url !== '/v1/activity' || !['PUT', 'DELETE'].includes(request.method)) { request.resume(); finish(404); return; }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 2048) { finish(413); request.destroy(); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { finish(400); return; }
      try { finish(await registry.update(owner, input, request.method === 'DELETE')); }
      catch { finish(503); }
    } catch { if (!response.headersSent) finish(400); }
  };
}

export function start(config) {
  const labels = Object.fromEntries(['en', 'ru', 'es', 'hi', 'de', 'fr', 'zh', 'pt', 'ja'].map((locale) => [locale,
    JSON.parse(readFileSync(new URL(`../../shared/i18n/locales/${locale}/notifications.json`, import.meta.url), 'utf8')).activity]));
  if (!config.owners || Object.keys(config.owners).length > 100 || !Object.keys(config.owners).length) throw new Error('Configure 1–100 owners');
  for (const owner of Object.values(config.owners)) {
    if (!/^[a-f0-9]{64}$/.test(owner.credentialHash) || !labels[owner.locale ?? 'en']
      || !Array.isArray(owner.subscriptions) || !owner.subscriptions.length || owner.subscriptions.length > 32
      || !owner.subscriptions.every((entry) => config.sources[entry.source] && /^[a-zA-Z0-9_-]{1,128}$/.test(entry.sessionID))) throw new Error('Invalid enrollment');
    if (new Set(owner.subscriptions.map((entry) => JSON.stringify([entry.source, entry.sessionID]))).size !== owner.subscriptions.length) throw new Error('Duplicate subscription');
  }
  if (new Set(Object.values(config.owners).map((owner) => owner.credentialHash)).size !== Object.keys(config.owners).length) throw new Error('Duplicate enrollment credential');
  if (Object.values(config.owners).reduce((count, owner) => count + owner.subscriptions.length, 0) > 128) throw new Error('Relay subscription limit');
  const send = createSender({ ...config.apns, privateKey: readFileSync(config.apns.keyFile, 'utf8') });
  const registry = createRegistry({ owners: config.owners, stateFile: config.stateFile,
    observe: createObserver(config.sources), send, labels });
  const server = createServer(createHandler(registry));
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(config.port ?? 8788, '127.0.0.1');
  let stopped = false;
  let timer;
  async function run() {
    try { await registry.tick(); }
    catch { console.error('Live Activity relay persistence failure; stopping.'); server.close(); stopped = true; }
    if (!stopped) timer = setTimeout(run, 15000);
  }
  void run();
  const close = () => { stopped = true; clearTimeout(timer); server.close(); };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return { server, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node services/live-activity-relay/server.mjs /protected/config.json');
  start(JSON.parse(readFileSync(process.argv[2], 'utf8')));
}
