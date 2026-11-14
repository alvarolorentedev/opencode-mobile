import { connect } from 'node:http2';
import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';

const referenceEpoch = 978307200;
export function payload(snapshot, labels, now) {
  if (!Number.isSafeInteger(now) || now < referenceEpoch || now > 4000000000) throw new Error('Invalid timestamp');
  const terminal = ['finished', 'failed', 'stopped'].includes(snapshot.phase);
  const state = {
    body: labels[snapshot.phase], chip: terminal ? labels[snapshot.phase] : labels.working,
    link: 'opencodemobile-activities://', pausedLabel: labels.updatesPaused,
    phase: snapshot.phase, count: snapshot.count, updatedAt: now - referenceEpoch,
    isPaused: terminal || snapshot.phase === 'reconnecting',
    ...(terminal ? { endedAt: now - referenceEpoch } : {}),
    ...(snapshot.phase === 'reconnecting' ? { frozenAt: now - referenceEpoch } : {}),
    updatedLabel: labels.updatedLabel, elapsedLabel: labels.elapsedLabel,
  };
  if (!Object.values(state).every((value) => typeof value !== 'string' || (value.length <= 180 && !/[\u0000-\u001f]/.test(value)))
    || !Number.isInteger(state.count) || state.count < 0 || state.count > 9999 || !state.body) throw new Error('Invalid state');
  const body = JSON.stringify({ aps: { timestamp: now, event: terminal ? 'end' : 'update',
    'content-state': state, ...(terminal ? { 'dismissal-date': now + 300 } : { 'stale-date': now + 60 }) } });
  // Reserve 512 bytes for fixed native attributes, separately from APNs.
  if (Buffer.byteLength(JSON.stringify(state)) + 512 > 4096 || Buffer.byteLength(body) > 4096) throw new Error('Payload budget');
  return body;
}

export function createSender(config, transport = connect) {
  if (!['sandbox', 'production'].includes(config.environment) || !/^[A-Za-z0-9.-]+$/.test(config.bundleId)
    || !/^[A-Z0-9]{10}$/.test(config.teamId) || !/^[A-Z0-9]{10}$/.test(config.keyId)) throw new Error('Invalid APNs configuration');
  const key = createPrivateKey(config.privateKey);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APNs requires P-256');
  let cached;
  function authorization(now) {
    if (cached && now - cached.at < 3000) return cached.jwt;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'ES256', kid: config.keyId })}.${encode({ iss: config.teamId, iat: now })}`;
    cached = { at: now, jwt: `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}` };
    return cached.jwt;
  }
  return async (token, body, expiresAt) => {
    if (!/^[a-f0-9]{32,512}$/.test(token)) throw new Error('Invalid token');
    const now = Math.floor(Date.now() / 1000);
    const host = config.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    return new Promise((resolve, reject) => {
      const session = transport(`https://${host}`);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        session.destroy();
        if (error) reject(new Error('APNs transport failed')); else resolve(result);
      };
      session.on('error', (error) => finish(error));
      session.setTimeout(10000, () => finish(new Error('timeout')));
      const request = session.request({ ':method': 'POST', ':path': `/3/device/${token}`,
        authorization: `bearer ${authorization(now)}`, 'apns-topic': `${config.bundleId}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity', 'apns-priority': '5', 'apns-expiration': String(Math.min(now + 60, expiresAt)),
        'content-type': 'application/json' });
      let status = 0;
      request.on('response', (headers) => { status = Number(headers[':status']); });
      request.on('data', () => {});
      request.on('error', (error) => finish(error));
      request.on('end', () => finish(null, { status, retryable: status === 429 || status >= 500, invalid: status === 410 }));
      request.end(body);
    });
  };
}
