import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, connect, type ServerHttp2Stream } from 'node:http2';
import { createServer as httpServer } from 'node:http';
import { OpenCode } from '@opencode/client';
import { payload, createSender } from '../../../services/live-activity-relay/apns.mjs';
import { createRegistry, digest } from '../../../services/live-activity-relay/registry.mjs';
import { createObserver } from '../../../services/live-activity-relay/observer.mjs';
import { createHandler } from '../../../services/live-activity-relay/server.mjs';

const labels = JSON.parse(readFileSync(new URL('../../../shared/i18n/locales/en/notifications.json', import.meta.url), 'utf8')).activity;
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); vi.restoreAllMocks(); });
const registration = { activityId: 'native-1', generation: 'a'.repeat(64), revision: 1, token: 'b'.repeat(64), startedAt: 1800000000 };
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'activity-relay-')); folders.push(folder);
  const owners = { alice: { credentialHash: digest('alice-secret'), subscriptions: [{ source: 'a', sessionID: 'ses-1' }] },
    bob: { credentialHash: digest('bob-secret'), subscriptions: [{ source: 'b', sessionID: 'ses-2' }] } };
  let time = registration.startedAt;
  const observe = vi.fn().mockResolvedValue({ phase: 'thinking', count: 1 });
  const send = vi.fn().mockResolvedValue({ status: 200 });
  const options = { owners, stateFile: join(folder, 'state.json'), observe, send, labels: { en: labels }, now: () => time };
  return { registry: createRegistry(options), options, observe, send, advance: (seconds = 15) => { time += seconds; } };
}

describe('managed remote ActivityKit relay', () => {
  it('authenticates an enrollment, fixes its scopes, rejects cross-owner collisions and stale rotation/revocation', async () => {
    const { registry, options, send } = fixture();
    expect(registry.authenticate('alice-secret')).toBe('alice');
    expect(registry.authenticate('unknown')).toBeUndefined();
    expect(await registry.update('alice', registration)).toBe(200);
    expect(await registry.update('bob', registration)).toBe(409);
    expect(await registry.update('alice', { ...registration, revision: 2, token: 'c'.repeat(64) })).toBe(200);
    expect(await registry.update('alice', registration)).toBe(409);
    expect(await registry.update('alice', registration, true)).toBe(409);
    await registry.tick();
    expect(send.mock.calls[0][0]).toBe('c'.repeat(64));
    expect(statSync(options.stateFile).mode & 0o777).toBe(0o600);
    expect(await registry.update('alice', { ...registration, revision: 3 }, true)).toBe(200);
    expect(await registry.update('alice', { ...registration, revision: 4 })).toBe(410);
  });

  it('persists terminal ordering across failures and restart, without allowing progress after end', async () => {
    const { registry, options, send, observe, advance } = fixture();
    await registry.update('alice', registration);
    await registry.tick();
    advance();
    observe.mockResolvedValue({ phase: 'finished', count: 0 });
    send.mockResolvedValueOnce({ status: 503, retryable: true });
    await registry.tick();
    observe.mockResolvedValue({ phase: 'thinking', count: 1 });
    advance(60);
    const restored = createRegistry(options);
    await restored.tick();
    advance(); await restored.tick();
    expect(send).toHaveBeenCalledTimes(3);
    const envelopes = send.mock.calls.map((call) => JSON.parse(call[1]).aps);
    expect(envelopes.map((aps) => aps.event)).toEqual(['update', 'end', 'end']);
    expect(envelopes.map((aps) => aps.timestamp)).toEqual([1800000000, 1800000015, 1800000075]);
    expect(readFileSync(options.stateFile, 'utf8')).not.toContain(registration.token);
  });

  it('coalesces progress and discards an observation superseded by token rotation', async () => {
    const { registry, observe, send, advance } = fixture();
    await registry.update('alice', registration);
    await registry.tick(); advance(); await registry.tick();
    expect(send).toHaveBeenCalledTimes(1);
    advance(30); await registry.tick();
    expect(send).toHaveBeenCalledTimes(2);
    advance();
    let resolve!: (value: { phase: string; count: number }) => void;
    observe.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const reading = registry.tick();
    await registry.update('alice', { ...registration, revision: 2, token: 'c'.repeat(64) });
    resolve({ phase: 'finished', count: 0 });
    await reading;
    expect(send).toHaveBeenCalledTimes(2);
    expect(await registry.update('alice', { ...registration, revision: 3, startedAt: registration.startedAt + 1 })).toBe(409);
    await registry.tick();
    expect(send.mock.calls.at(-1)![0]).toBe('c'.repeat(64));
    expect(JSON.parse(send.mock.calls.at(-1)![1]).aps.event).toBe('update');
  });

  it('removes an operator-revoked registration and its token, attempting final delivery', async () => {
    const { registry, options, send } = fixture();
    await registry.update('alice', registration);
    const revoked = createRegistry({ ...options, owners: {} });
    await revoked.tick();
    expect(JSON.parse(send.mock.calls.at(-1)![1]).aps.event).toBe('end');
    expect(readFileSync(options.stateFile, 'utf8')).toBe('{}');
    expect(revoked.authenticate('alice-secret')).toBeUndefined();
  });

  it.each(['credential', 'scopes', 'both'])('revokes persisted same-owner registrations after %s rotation', async (change) => {
    const { registry, options, observe, send } = fixture();
    await registry.update('alice', registration);
    const original = JSON.parse(readFileSync(options.stateFile, 'utf8')).alice;
    expect(original.enrollment).toMatch(/^[a-f0-9]{64}$/);
    const rotatedOwner = {
      ...options.owners.alice,
      ...(change !== 'scopes' ? { credentialHash: digest('replacement-secret') } : {}),
      ...(change !== 'credential' ? { subscriptions: [{ source: 'new-server', sessionID: 'new-session' }] } : {}),
    };
    const restored = createRegistry({ ...options, owners: { ...options.owners, alice: rotatedOwner } });
    expect(JSON.parse(readFileSync(options.stateFile, 'utf8')).alice).toBeUndefined();
    await restored.tick();
    expect(observe).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    if (change !== 'scopes') {
      expect(restored.authenticate('alice-secret')).toBeUndefined();
      expect(restored.authenticate('replacement-secret')).toBe('alice');
    }
    const replacement = { ...registration, activityId: 'native-2', generation: 'd'.repeat(64), token: 'e'.repeat(64) };
    expect(await restored.update('alice', replacement)).toBe(200);
    await restored.tick();
    expect(observe).toHaveBeenCalledWith(rotatedOwner.subscriptions, replacement.startedAt);
    expect(send.mock.calls[0][0]).toBe(replacement.token);
    const persisted = readFileSync(options.stateFile, 'utf8');
    expect(JSON.parse(persisted).alice.enrollment).not.toBe(original.enrollment);
    for (const secret of ['alice-secret', 'replacement-secret', options.owners.alice.credentialHash,
      rotatedOwner.credentialHash, registration.token]) expect(persisted).not.toContain(secret);
  });

  it('drops legacy unbound registrations on startup rather than assigning the current enrollment', async () => {
    const { options, observe, send } = fixture();
    writeFileSync(options.stateFile, JSON.stringify({ alice: { ...registration, expiresAt: registration.startedAt + 3600, timestamp: 0 } }));
    const restored = createRegistry(options);
    expect(readFileSync(options.stateFile, 'utf8')).toBe('{}');
    await restored.tick();
    expect(observe).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await restored.update('alice', registration)).toBe(200);
    expect(JSON.parse(readFileSync(options.stateFile, 'utf8')).alice.enrollment).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an in-flight observation if its enrollment changes before delivery', async () => {
    const { registry, options, observe, send } = fixture();
    await registry.update('alice', registration);
    let resolve!: (value: { phase: string; count: number }) => void;
    observe.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const reading = registry.tick();
    options.owners.alice.credentialHash = digest('rotated-during-read');
    resolve({ phase: 'thinking', count: 1 });
    await reading;
    expect(send).not.toHaveBeenCalled();
    await registry.tick();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1]).aps.event).toBe('end');
    expect(readFileSync(options.stateFile, 'utf8')).toBe('{}');
  });

  it('fails closed on incomplete sources, handles 410 rotation, and ends before the bounded lease', async () => {
    const { registry, send, observe, advance } = fixture();
    await registry.update('alice', registration);
    observe.mockRejectedValueOnce(new Error('private source unavailable'));
    await registry.tick(); expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce({ status: 410, invalid: true });
    await registry.tick(); advance(); await registry.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await registry.update('alice', { ...registration, revision: 2, token: 'c'.repeat(64) })).toBe(200);
    advance(7 * 3600 - 75); await registry.tick();
    expect(JSON.parse(send.mock.calls.at(-1)![1]).aps).toMatchObject({ event: 'end', 'content-state': { phase: 'stopped' } });
  });

  it('sends only complete bounded generic state with distinct Foundation/APNs epochs in every locale', () => {
    for (const locale of ['en', 'ru', 'es', 'hi', 'de', 'fr', 'zh', 'pt', 'ja']) {
      const copy = JSON.parse(readFileSync(new URL(`../../../shared/i18n/locales/${locale}/notifications.json`, import.meta.url), 'utf8')).activity;
      const body = payload({ phase: 'finished', count: 0, title: 'PRIVATE', project: '/private' }, copy, 1800000000);
      const aps = JSON.parse(body).aps;
      expect(aps['content-state'].updatedAt).toBe(821692800);
      expect(aps['content-state'].endedAt).toBe(821692800);
      expect(aps['dismissal-date']).toBe(1800000300);
      expect(aps['content-state'].link).toBe('opencodemobile-activities://');
      expect(body).not.toMatch(/PRIVATE|\/private|sessionID|completedSteps|totalSteps/);
      expect(Buffer.byteLength(body)).toBeLessThan(4096);
    }
    expect(() => payload({ phase: 'thinking', count: 10000 }, labels, 1800000000)).toThrow();
    expect(() => payload({ phase: 'thinking', count: 1 }, { ...labels, thinking: 'x'.repeat(181) }, 1800000000)).toThrow();
  });

  it('uses the installed V2 durable-log and interaction APIs and refuses unsynced logs', async () => {
    let synced = true;
    let terminal = false;
    const paths: string[] = [];
    const observer = createObserver({ a: { url: 'https://source.invalid' } }, (options: any) => OpenCode.make({ ...options,
      fetch: async (input: any) => {
        const url = new URL(String(input)); paths.push(url.pathname);
        if (url.pathname.endsWith('/log')) {
          expect(url.searchParams.get('follow')).toBe('false');
          const event = { type: terminal ? 'session.execution.failed' : 'session.execution.started', created: 1800000001000,
            id: 'event', durable: { seq: 1, aggregateID: 'ses-1', version: 1 }, data: { sessionID: 'ses-1', error: { message: 'PRIVATE' } } };
          return new Response(`data: ${JSON.stringify(event)}\n\n${synced ? 'data: {"type":"log.synced","aggregateID":"ses-1","seq":1}\n\n' : ''}`, { headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } });
      } }));
    expect(await observer([{ source: 'a', sessionID: 'ses-1' }], 1800000000)).toEqual({ phase: 'thinking', count: 1 });
    terminal = true;
    expect(await observer([{ source: 'a', sessionID: 'ses-1' }], 1800000000)).toEqual({ phase: 'failed', count: 0 });
    expect(paths).toContain('/api/experimental/session/ses-1/log');
    expect(paths.some((path) => path.endsWith('/permission'))).toBe(true);
    synced = false;
    await expect(observer([{ source: 'a', sessionID: 'ses-1' }], 1800000000)).rejects.toThrow('Incomplete');
  });

  it('uses HTTP/2, Apple allowlisted host/topic/environment and a verifiable P-256 JWT', async () => {
    const server = createServer();
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    let headers: any;
    let received = '';
    server.on('stream', (stream, incoming) => {
      headers = incoming;
      stream.on('data', (chunk) => { received += chunk; });
      stream.on('end', () => { (stream as ServerHttp2Stream).respond({ ':status': 200 }); stream.end(); });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const sender = createSender({ environment: 'sandbox', bundleId: 'app.test', teamId: 'ABCDEFGHIJ', keyId: '0123456789',
        privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) }, (host: string | URL) => {
        expect(String(host)).toBe('https://api.sandbox.push.apple.com'); return connect(`http://127.0.0.1:${address.port}`);
      });
      const body = payload({ phase: 'thinking', count: 1 }, labels, 1800000000);
      expect(await sender(registration.token, body, 1900000000)).toMatchObject({ status: 200 });
      expect(received).toBe(body);
      expect(headers['apns-topic']).toBe('app.test.push-type.liveactivity');
      expect(headers['apns-push-type']).toBe('liveactivity'); expect(headers['apns-priority']).toBe('5');
      const [header, claims, signature] = headers.authorization.slice(7).split('.');
      expect(JSON.parse(Buffer.from(claims, 'base64url').toString()).iss).toBe('ABCDEFGHIJ');
      expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('aggregates multiple authorized servers atomically and never returns a partial snapshot', async () => {
    let unavailable = false;
    const observer = createObserver({ a: { url: 'https://a.invalid' }, b: { url: 'https://b.invalid' } }, (options: any) => {
      const blocked = options.baseUrl === 'https://a.invalid';
      return {
        session: {
          log: async function* ({ sessionID }: { sessionID: string }) {
            if (!blocked && unavailable) throw new Error('Source unavailable');
            yield { type: 'session.execution.started', created: 1800000001000, durable: { seq: 1 }, data: { sessionID } };
            yield { type: 'log.synced' };
          },
          inbox: { list: async () => [] }, form: { list: async () => [] },
        },
        permission: { list: async () => blocked ? [{ sessionID: 'one' }] : [] },
      } as any;
    });
    const scopes = [{ source: 'a', sessionID: 'one' }, { source: 'b', sessionID: 'two' }];
    expect(await observer(scopes, 1800000000)).toEqual({ phase: 'needsInput', count: 2 });
    unavailable = true;
    await expect(observer(scopes, 1800000000)).rejects.toThrow('Source unavailable');
  });

  it('serves a real authenticated registration route with body/rate limits and no caller-selected scope', async () => {
    const { registry, observe } = fixture();
    const server = httpServer(createHandler(registry));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/v1/activity`;
    const request = (auth: string, body: any = registration) => fetch(url, { method: 'PUT', headers: { authorization: auth }, body: JSON.stringify(body) });
    try {
      expect((await request('alice-secret')).status).toBe(401);
      expect((await request('Bearer alice-secret', { ...registration, subscriptions: [{ source: 'b' }] })).status).toBe(200);
      await registry.tick();
      expect(observe).toHaveBeenCalledWith([{ source: 'a', sessionID: 'ses-1' }], registration.startedAt);
      for (let i = 0; i < 29; i++) await request('Bearer alice-secret');
      expect((await request('Bearer alice-secret')).status).toBe(429);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
