import { fetch as expoFetch } from 'expo/fetch';

import { normalizeRelayUrl, parseRelayEnvironments, parseRelayToken, type RelayEnvironment } from '@/features/connections/model/relay';
import type { RelaySession } from '@/shared/storage/relay-session';

export { clearRelaySession, loadRelaySession, saveRelaySession } from '@/shared/storage/relay-session';

const REQUEST_TIMEOUT_MS = 15_000;

export class RelayApiError extends Error {
  constructor(public kind: 'invalid-url' | 'authentication' | 'request' | 'response' | 'cancelled') {
    super(kind);
    this.name = 'RelayApiError';
  }
}

async function requestJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    let response: Response;
    try {
      response = await expoFetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    } catch {
      throw new RelayApiError(signal?.aborted ? 'cancelled' : 'request');
    }
    if (!response.ok) throw new RelayApiError(response.status === 401 || response.status === 403 ? 'authentication' : 'request');
    try { return await response.json(); } catch { throw new RelayApiError('response'); }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loginToRelay(relayUrl: string, username: string, password: string, signal?: AbortSignal): Promise<RelaySession> {
  const base = normalizeRelayUrl(relayUrl);
  if (!base) throw new RelayApiError('invalid-url');
  const trimmedUsername = username.trim();
  if (!trimmedUsername || !password) throw new RelayApiError('authentication');
  const value = await requestJson(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: trimmedUsername, password }),
  }, signal);
  const token = parseRelayToken(value);
  if (!token) throw new RelayApiError('response');
  return { relayUrl: base, username: trimmedUsername, token };
}

export async function listRelayEnvironments(session: RelaySession, signal?: AbortSignal): Promise<RelayEnvironment[]> {
  const base = normalizeRelayUrl(session.relayUrl);
  if (!base || !session.token) throw new RelayApiError('invalid-url');
  const value = await requestJson(`${base}/api/environments`, {
    headers: { authorization: `Bearer ${session.token}` },
  }, signal);
  const environments = parseRelayEnvironments(value);
  if (!environments) throw new RelayApiError('response');
  return environments;
}
