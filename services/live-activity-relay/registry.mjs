import { timingSafeEqual, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, renameSync, chmodSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { payload } from './apns.mjs';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function createRegistry({ owners, stateFile, observe, send, labels, now = () => Math.floor(Date.now() / 1000) }) {
  let records = Object.create(null);
  try { records = Object.assign(Object.create(null), JSON.parse(readFileSync(stateFile, 'utf8'))); chmodSync(stateFile, 0o600); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  rmSync(`${stateFile}.tmp`, { force: true }); // Discard an uncommitted write from a crashed single writer.
  function save() {
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(records), { mode: 0o600, flush: true });
    renameSync(`${stateFile}.tmp`, stateFile);
    const directory = openSync(dirname(stateFile), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  function enrollment(owner) {
    const config = owners[owner];
    if (!config) return undefined;
    const scopes = config.subscriptions.map(({ source, sessionID }) => JSON.stringify([source, sessionID])).sort();
    // Versioned identity only: neither bearer credentials nor their verifier
    // are copied into registration storage. Scope changes revoke old tokens too.
    return digest(JSON.stringify([1, owner, config.credentialHash, scopes, config.locale ?? 'en']));
  }
  const bound = (owner, record) => Boolean(record.enrollment && record.enrollment === enrollment(owner));
  const closed = (record) => ({ activityId: record.activityId, generation: record.generation,
    revision: record.revision, enrollment: record.enrollment, closed: true });
  let migrated = false;
  for (const [owner, record] of Object.entries(records)) {
    // Legacy records have no provable enrollment; never adopt them into the
    // current configuration. Reused owner IDs do not confer continuity.
    if (!record.enrollment || (owners[owner] && !bound(owner, record))) {
      delete records[owner];
      migrated = true;
    }
  }
  if (migrated) save();
  const queues = new Map();
  const serial = (owner, fn) => {
    const result = (queues.get(owner) ?? Promise.resolve()).then(fn);
    queues.set(owner, result.catch(() => {}));
    return result;
  };
  function authenticate(bearer) {
    if (typeof bearer !== 'string' || bearer.length > 256) return;
    const actual = Buffer.from(digest(bearer));
    return Object.keys(owners).find((id) => timingSafeEqual(actual, Buffer.from(owners[id].credentialHash)));
  }
  function update(owner, input, remove = false) {
    return serial(owner, () => {
      if (!owners[owner] || !input || !/^[a-zA-Z0-9-]{1,128}$/.test(input.activityId)
        || !/^[a-f0-9]{64}$/.test(input.generation) || !Number.isSafeInteger(input.revision) || input.revision < 1) return 400;
      if (records[owner] && !bound(owner, records[owner])) {
        delete records[owner];
        save();
      }
      const old = records[owner];
      if (!remove && Object.entries(records).some(([id, record]) => id !== owner
        && !record.closed && (record.token === input.token || record.activityId === input.activityId))) return 409;
      if (old && (input.revision < old.revision || (input.revision === old.revision
        && (input.activityId !== old.activityId || input.generation !== old.generation || (!remove && input.token !== old.token))))) return 409;
      if (!remove && (!/^[a-f0-9]{32,512}$/.test(input.token) || !Number.isInteger(input.startedAt)
        || input.startedAt > now() + 10 || input.startedAt < now() - 7 * 3600)) return 400;
      if (!remove && old && !old.closed && old.generation === input.generation
        && (old.startedAt !== input.startedAt || old.activityId !== input.activityId)) return 409;
      if (old && input.generation === old.generation && old.closed) return remove ? 200 : 410;
      if (old && input.revision === old.revision && !remove) return 200;
      if (remove) {
        if (old && old.generation !== input.generation) return 409;
        records[owner] = closed({ ...input, enrollment: enrollment(owner) });
      } else {
        records[owner] = { activityId: input.activityId, generation: input.generation, revision: input.revision,
          enrollment: enrollment(owner), token: input.token, startedAt: input.startedAt, expiresAt: input.startedAt + 7 * 3600,
          timestamp: old?.timestamp ?? 0,
          ...(old?.generation === input.generation ? { terminal: old.terminal } : {}) };
      }
      try { save(); } catch (error) {
        if (old) records[owner] = old; else delete records[owner];
        throw error;
      }
      return 200;
    });
  }
  const tick = () => Promise.all(Object.entries(records).map(async ([owner, record]) => {
    if (!bound(owner, record)) return serial(owner, async () => {
      if (records[owner] !== record) return;
      if (!record.closed && record.token) {
        try { await send(record.token, payload({ phase: 'stopped', count: 0 }, labels.en, now()), now() + 60); }
        catch { /* Revocation removes the routing capability even if APNs is unavailable. */ }
      }
      delete records[owner];
      save();
    });
    if (record.closed) return;
    const time = now();
    if (record.expiresAt <= time) {
      return serial(owner, () => {
        if (records[owner] !== record) return;
        records[owner] = closed(record);
        save();
      });
    }
    if (record.invalid || time <= record.timestamp || time < (record.retryAt ?? 0)) return;
    let snapshot = record.terminal ?? (time >= record.expiresAt - 60 ? { phase: 'stopped', count: 0 } : undefined);
    if (!snapshot) {
      try { snapshot = await observe(owners[owner].subscriptions, record.startedAt); }
      catch { return; } // Unknown is never completion; stale-date expires.
    }
    return serial(owner, async () => {
      // Rotation/removal during a slow authoritative read invalidates that read.
      if (records[owner] !== record || !bound(owner, record) || record.closed || record.timestamp >= time || now() >= record.expiresAt) return;
      const signature = JSON.stringify(snapshot);
      if (!record.terminal && signature === record.lastSnapshot && time - record.lastSentAt < 45) return;
      if (['finished', 'failed', 'stopped'].includes(snapshot.phase)) record.terminal = snapshot;
      record.timestamp = time;
      save(); // Persist ordering and terminal latch before network side effects.
      try {
        const result = await send(record.token, payload(snapshot, labels[owners[owner].locale ?? 'en'], time), record.expiresAt);
        if (result.status === 200) { record.lastSnapshot = signature; record.lastSentAt = time; }
        if (result.invalid) {
          delete record.token;
          record.invalid = true; // A higher registration revision may install a rotated token.
        } else if ((result.status === 200 && record.terminal) || (!result.retryable && result.status !== 200)) {
          records[owner] = closed(record);
        } else if (result.status !== 200) record.retryAt = time + 60;
      } catch { record.retryAt = time + 60; }
      save();
    });
  }));
  return { authenticate, update, tick };
}
