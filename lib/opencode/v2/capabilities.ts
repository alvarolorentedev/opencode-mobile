import type { ProviderAccountsApi, ProviderOAuthApi } from '../client/types';
import type { ProviderAuthValues } from '../types';
import { findIntegration, type V2Context } from './shared';

export function buildProviderAuth(ctx: V2Context): { accounts: ProviderAccountsApi; providerOAuth: ProviderOAuthApi } {
  const { api, directory } = ctx;
  const location = directory ? { location: { directory } } : {};
  const oauth = createIntegrationOAuth(ctx);
  return {
    accounts: {
      list: async () => (await ctx.listCredentials()).map((credential) => ({ id: credential.id, providerId: credential.integrationID, label: credential.label, method: credential.value?.type === 'oauth' ? 'oauth' : 'key', active: Boolean(credential.active) })),
      add: async (providerId, values, label) => {
        const integration = await findIntegration(api, providerId, location, true);
        if (!integration) throw new Error('This provider is not available on OpenCode 2.');
        const key = typeof values.key === 'string' ? values.key : typeof values.token === 'string' ? values.token : '';
        const answer = Object.fromEntries(Object.entries(values).filter(([name]) => name !== 'key' && name !== 'token').map(([name, value]) => [name, typeof value === 'string' ? value.trim() : value]));
        await api.integration.connect.key({ ...location, integrationID: integration.id, key, ...(label?.trim() ? { label: label.trim() } : {}), ...(Object.keys(answer).length ? { answer } : {}) });
      },
      activate: async (credentialID) => { await api.credential.activate({ ...location, credentialID }); },
      remove: async (credentialID) => { await api.credential.remove({ ...location, credentialID }); },
    },
    providerOAuth: {
      ...oauth,
      start: async (providerId, index, values) => {
        const integration = await findIntegration(api, providerId, location);
        const method = integration?.methods.filter((item) => item.type === 'oauth' || item.type === 'key')[index];
        if (!integration || method?.type !== 'oauth') throw new Error('This provider does not offer OAuth.');
        return oauth.start(providerId, integration.id, method.id, values);
      },
    },
  };
}

export type Authorization = { url: string; instructions?: string; method: 'auto' | 'code' };
export function createIntegrationOAuth({ api, directory }: V2Context) {
  const attempts = new Map<string, { integrationID: string; attemptID: string }>();
  const starts = new Map<string, object>();
  const location = directory ? { location: { directory } } : {};
  return {
    start: async (key: string, integrationID: string, methodID: string, answer?: ProviderAuthValues): Promise<Authorization> => {
      const start = {};
      starts.set(key, start);
      const previous = attempts.get(key);
      attempts.delete(key);
      if (previous) await api.integration.oauth.cancel({ ...location, ...previous });
      const { data } = await api.integration.oauth.connect({ ...location, integrationID, methodID, ...(answer ? { answer } : {}) });
      if (starts.get(key) !== start) {
        await api.integration.oauth.cancel({ ...location, integrationID, attemptID: data.attemptID });
        throw new Error('Sign-in was cancelled.');
      }
      attempts.set(key, { integrationID, attemptID: data.attemptID });
      return { url: data.url, instructions: data.instructions, method: data.mode };
    },
    complete: async (key: string, code: string) => {
      const attempt = attempts.get(key);
      if (!attempt) throw new Error('Start sign-in again to complete it.');
      await api.integration.oauth.complete({ ...location, ...attempt, code });
      if (attempts.get(key) !== attempt) throw new Error('Sign-in was cancelled.');
      attempts.delete(key);
    },
    wait: async (key: string, timeoutMs = 900_000) => {
      const attempt = attempts.get(key);
      if (!attempt) throw new Error('Start sign-in again to complete it.');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (attempts.get(key) !== attempt) throw new Error('Sign-in was cancelled.');
        const { data } = await api.integration.oauth.status({ ...location, ...attempt });
        if (attempts.get(key) !== attempt) throw new Error('Sign-in was cancelled.');
        if (data.status === 'complete') { attempts.delete(key); return; }
        if (data.status === 'failed') throw new Error(data.message || 'Sign-in failed.');
        if (data.status === 'expired') throw new Error('Sign-in expired. Start again.');
        if (Date.now() >= deadline) throw new Error('Sign-in was not completed.');
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    },
    cancel: async (key: string) => {
      starts.delete(key);
      const attempt = attempts.get(key);
      attempts.delete(key);
      if (attempt) await api.integration.oauth.cancel({ ...location, ...attempt });
    },
  };
}
