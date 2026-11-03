import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as sdk from '@opencode/client';
import * as query from '@tanstack/react-query';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

// Intentionally separate from Vitest: this requires an installed real V2 server.
const binary = process.env.OPENCODE_BIN || 'opencode';
const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
assert.equal(version.status, 0, `Install OpenCode 2 or set OPENCODE_BIN: ${version.error || version.stderr}`);
assert.match(version.stdout, /v?2\./, 'This fixture requires OpenCode 2');
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mobile-plugin-')));
const directory = path.join(root, 'project');
const otherDirectory = path.join(root, 'other');
const pluginPath = path.join(directory, '.opencode/plugins/fixture.js');
const configHome = path.join(root, 'config');
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let server;
let logs = '';
const cache = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const streamAbort = new AbortController();
try {
  await mkdir(path.dirname(pluginPath), { recursive: true });
  await mkdir(otherDirectory);
  await mkdir(path.join(configHome, 'opencode'), { recursive: true });
  await copyFile(new URL('./fixtures/command-plugin.mjs', import.meta.url), pluginPath);
  await writeFile(path.join(configHome, 'opencode/opencode.json'), JSON.stringify({
    commands: { 'global-config': { template: 'Global $ARGUMENTS' } },
  }));
  await writeFile(path.join(directory, 'opencode.json'), JSON.stringify({
    commands: { 'project-config': { description: 'Project configuration', template: 'Project $ARGUMENTS' } },
  }));
  server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: directory,
    // Isolate storage and omit provider credentials inherited by the developer shell.
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(),
      XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: path.join(root, 'data'),
      XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
      OPENCODE_SERVER_PASSWORD: 'fixture' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-12_000); });
  server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-12_000); });
  server.on('error', (error) => { logs += error.message; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Basic ${Buffer.from('opencode:fixture').toString('base64')}` };
  async function until(read, accepts, label) {
    const deadline = Date.now() + 30_000;
    let last;
    while (Date.now() < deadline) {
      last = await read().catch((error) => error);
      if (accepts(last)) return last;
      assert.equal(server.exitCode, null, `Server exited: ${logs}`);
      await delay(100);
    }
    assert.fail(`${label}: ${JSON.stringify(last)}\n${logs}`);
  }
  await until(() => fetch(`${baseUrl}/api/info`, { headers }), (value) => value.ok, 'Server startup');
  const { buildV2Raw, createSessionAdapter } = await loadTs([
    'shared/protocol/opencode/v2/raw.ts', 'shared/protocol/opencode/contracts/session-adapter.ts',
  ], {
    '@opencode/client': sdk,
    '@/shared/protocol/opencode/compat/v1/session': {},
    '@/shared/protocol/opencode/compat/v1/project': {},
    '@/shared/protocol/opencode/client/fetch': { getRequestHeaders: () => headers, createPrefixFetch: () => fetch },
    '@/shared/i18n/index': { getFormatLocale: () => 'en' },
  }, { Error, process: { env: {} } });
  const clientFor = (directory) => {
    const context = buildV2Raw({ serverUrl: baseUrl, directory });
    return { api: context.api, context, __opencode: { contract: 'v2', directory } };
  };
  const client = clientFor(directory);
  const other = clientFor(otherDirectory);
  const adapter = createSessionAdapter(client);
  const identity = { connectionId: 'real-server', connectionScope: baseUrl, authRevision: 0 };
  const { commandsOptions } = await loadTs('shared/server-data/catalogs.ts', {
    '@tanstack/react-query': query,
    '@/shared/protocol/opencode/client': { withReadSignal: (client) => client },
    '@/shared/protocol/opencode/contracts/server-adapter': {},
    '@/shared/protocol/services/session-service': { listCommands: (client) => createSessionAdapter(client).commands() },
  });
  const options = commandsOptions(identity, client);
  const commands = await until(() => cache.fetchQuery(options),
    (items) => ['mobile-echo', 'Mobile-Echo', 'project-config', 'global-config'].every((name) => items.some?.((c) => c.name === name)), 'Plugin/config activation');
  assert(commands.some((c) => c.name === 'Mobile-Echo'));
  assert(commands.some((c) => c.name === 'project-config'));
  assert(commands.some((c) => c.name === 'global-config'));
  assert.deepEqual(commands.filter((c) => c.name === 'review'), [{ name: 'review', description: 'Plugin override' }]);
  const driver = hookRuntime();
  const { useComposerSuggestions } = await loadTs('features/chat/ui/use-composer-suggestions.ts', { react: driver.react });
  driver.mount(() => useComposerSuggestions({ draft: '/mobile-e', selection: { start: 9, end: 9 },
    enabled: true, commands, agents: [], skills: [], references: [], searchFiles: async () => [] }), {});
  assert.equal(driver.value.groups[0].items[0].insert, '/mobile-echo ');
  assert.equal(driver.value.groups[0].items[0].description, 'Echo from the server plugin');
  driver.unmount();

  const session = await adapter.create('Plugin integration');
  const args = ' "two words"\nnext  ';
  await adapter.executeCommand(session.id, 'mobile-echo', args, {
    agent: 'build',
    attachments: [{ uri: 'data:text/plain;base64,YQ==', filename: 'a.txt' }],
  });
  let current = await client.api.session.get({ sessionID: session.id });
  assert.equal(current.metadata.commandFixture.directory, directory);
  assert.equal(current.metadata.commandFixture.prompt.text, args);
  assert.equal(current.metadata.commandFixture.prompt.files[0].uri, 'data:text/plain;base64,YQ==');
  assert.equal(current.agent, 'build');
  await assert.rejects(adapter.executeCommand(session.id, 'MOBILE-ECHO', ''), /Command not found/);
  await assert.rejects(adapter.executeCommand(session.id, 'mobile-fail', ''), /Fixture command failed/);
  await adapter.executeCommand(session.id, 'Mobile-Echo', 'recovered');
  current = await client.api.session.get({ sessionID: session.id });
  assert.equal(current.metadata.commandFixture.prompt.text, 'recovered');
  assert.equal((await client.api.message.list({ sessionID: session.id })).data.filter((message) => message.type === 'user').length, 0, 'Commands must not become AI prompts');
  await adapter.executeCommand(session.id, 'mobile-hook', 'hook arguments');
  await until(() => client.api.message.list({ sessionID: session.id }),
    (page) => page.data?.some((message) => message.type === 'user' && message.text === 'Server hook: hook arguments'), 'Server prompt hook');
  await client.api.session.interrupt({ sessionID: session.id });

  const otherCommands = await until(() => createSessionAdapter(other).commands(), (items) => items.some?.((c) => c.name === 'global-config'), 'Second project activation');
  assert(!otherCommands.some((c) => c.name === 'mobile-echo' || c.name === 'project-config'));
  // Use the native stream and the production event-to-resource mapping.
  const { serverDataResources } = await loadTs('shared/protocol/opencode/server-data-events.ts');
  const events = [];
  const stream = await client.api.event.subscribe({ signal: streamAbort.signal });
  const consume = (async () => {
    for await (const event of stream) {
      events.push(event);
      if (serverDataResources(event).includes('commands') && (!event.location?.directory || event.location.directory === directory)) {
        await cache.invalidateQueries({ queryKey: options.queryKey });
      }
    }
  })().catch((error) => { if (!streamAbort.signal.aborted) throw error; });
  const updated = (await readFile(pluginPath, 'utf8')).replaceAll('mobile-echo', 'mobile-reloaded');
  await writeFile(pluginPath, updated);
  await until(async () => events, (items) => items.some((e) => e.type === 'command.updated' && e.location?.directory === directory), 'Scoped command.updated');
  const reloaded = await until(() => cache.fetchQuery(options), (items) => items.some?.((c) => c.name === 'mobile-reloaded') && !items.some((c) => c.name === 'mobile-echo'), 'Plugin reload');
  assert(reloaded.some((c) => c.name === 'project-config'));
  // A new connection partition reads the current catalog instead of the cached old one.
  const reconnected = await cache.fetchQuery(commandsOptions({ ...identity, authRevision: 1 }, clientFor(directory)));
  assert(reconnected.some((c) => c.name === 'mobile-reloaded'));
  await adapter.executeCommand(session.id, 'mobile-reloaded', 'after reload');
  await rm(pluginPath);
  await until(() => cache.fetchQuery(options), (items) => !items.some?.((c) => c.name === 'mobile-reloaded' || c.name === 'Mobile-Echo'), 'Plugin removal');
  const removed = await adapter.commands();
  assert(removed.some((c) => c.name === 'review' && c.description !== 'Plugin override'));
  assert(removed.some((c) => c.name === 'project-config'));
  streamAbort.abort();
  await consume;
  console.log(`PASS real ${version.stdout.trim()}: discovery, autocomplete, exact names/arguments, files, server execution/hooks, override, failure/recovery, config scopes, reload/removal events, reconnection`);
} finally {
  streamAbort.abort();
  cache.clear();
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5_000);
    await stopped;
    clearTimeout(force);
  }
  await rm(root, { recursive: true, force: true });
}
