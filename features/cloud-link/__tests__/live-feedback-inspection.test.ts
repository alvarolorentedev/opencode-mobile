import { expect, it, vi } from 'vitest';

vi.mock('expo/fetch', () => ({ fetch: globalThis.fetch }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/shared/network/data-usage', () => ({ recordBytes: vi.fn(), recordRequest: vi.fn() }));
vi.mock('@/shared/platform/tls-trust', () => ({ ensureConnectionTrust: vi.fn() }));
vi.mock('@/shared/observability/client', () => ({ telemetry: { warn: vi.fn() } }));

const serverUrl = process.env.CLOUDLINK_FIXTURE_URL;
const machineHost = process.env.CLOUDLINK_FIXTURE_MACHINE_HOST;
const password = process.env.CLOUDLINK_FIXTURE_DEVICE_KEY;
const sessionID = process.env.CLOUDLINK_FIXTURE_SESSION;
const directory = process.env.CLOUDLINK_FIXTURE_DIRECTORY;
const from = process.env.CLOUDLINK_FIXTURE_MESSAGE;

it.skipIf(!serverUrl)('reads a native feedback session and diff through the scoped connector prefix', async () => {
  if (!serverUrl || !password || !sessionID || !directory || !from) throw new Error('Incomplete feedback fixture environment');
  const endpoint = new URL(serverUrl);
  if (machineHost) {
    expect(machineHost).toMatch(/^m-[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);
    expect(endpoint.origin).toBe(`https://${machineHost}`);
  } else {
    expect(endpoint.protocol).toBe('http:');
    expect(endpoint.hostname).toBe('127.0.0.1');
  }
  expect(endpoint.pathname).toBe('/_cloudlink/feedback/v1/native/one');
  const { buildV2Raw } = await import('@/shared/protocol/opencode/v2/raw');
  const { api } = buildV2Raw({ serverUrl, username: 'fixture-device', password, directory });
  const session = await api.session.get({ sessionID });
  expect(session).toMatchObject({ id: sessionID, location: { directory } });
  const messages = await api.message.list({ sessionID });
  expect(JSON.stringify(messages.data)).toContain('Updated the preview greeting.');
  const diff = await api.session.diff({ sessionID, from });
  expect(diff).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: 'main.js', patch: expect.stringContaining('+document.querySelector("#app").textContent = "review-one-edit";') }),
  ]));
}, 60_000);
