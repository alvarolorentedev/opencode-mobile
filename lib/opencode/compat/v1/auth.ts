import type { LegacyClient } from './client';
import type { ProviderAuthValues } from '../../types';
export async function setProviderCredentials(client: LegacyClient, providerID: string, values: ProviderAuthValues) {
  const key = typeof values.key === 'string' ? values.key.trim() : '';
  const token = typeof values.token === 'string' ? values.token.trim() : '';
  const metadata = Object.fromEntries(Object.entries(values).filter(([name, value]) => name !== 'key' && name !== 'token' && typeof value === 'string' && value.trim()).map(([name, value]) => [name, (value as string).trim()]));
  await client.auth.set({ providerID, auth: token ? { type: 'wellknown', key, token } : { type: 'api', key, ...(Object.keys(metadata).length ? { metadata } : {}) } });
}
