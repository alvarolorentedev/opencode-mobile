#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const children = [];
function stop() { for (const child of children) child.kill('SIGTERM'); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
process.on('exit', stop);
function start(entry, args = [], env = {}) {
  const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(); process.exit(1); });
  child.on('exit', (code, signal) => { if (!signal && code) { stop(); process.exit(code); } });
  return child;
}
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function wait(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* The owned fixture is still starting. */ }
    await sleep(100);
  }
  throw new Error(`Preview did not start: ${url}`);
}
try {
  await access('dist-e2e/index.html');
  const directory = '/workspace/demo-project';
  const connections = [];
  for (const name of ['MacBook Pro', 'Build server']) {
    const port = await freePort();
    start('tests/fake-opencode/server.mjs', [], { FAKE_OPENCODE_PORT: String(port), FAKE_OPENCODE_SCENARIO: name === 'Build server' ? 'permission' : 'happy-path' });
    const serverUrl = `http://127.0.0.1:${port}`;
    await wait(`${serverUrl}/api/info`);
    const response = await fetch(`${serverUrl}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Chat on ${name}`, location: { directory } }) });
    if (!response.ok) throw new Error(`Could not seed ${name}.`);
    const { data: session } = await response.json();
    if (name === 'Build server') await fetch(`${serverUrl}/api/session/${session.id}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await fetch(`${serverUrl}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Review on ${name}`, location: { directory: '/workspace/secondary-project' } }) });
    connections.push({ id: Buffer.from(`${serverUrl}\n`).toString('base64url'), name,
      settings: { serverUrl, username: '', directory: '' }, enabled: true, preferences: { autoApprove: false }, projects: [directory, '/workspace/secondary-project'] });
  }
  const stored = {
    'opencode-mobile.onboarding-version': { version: 1 },
    'opencode-mobile.connection-profiles': connections.map(({ name, settings }, index) => ({ id: `preview-${index}`, name, serverUrl: settings.serverUrl, username: '' })),
    'opencode-mobile.workspaces': { version: 1, connections, focus: { connectionId: connections[0].id, projectPath: directory } },
  };
  const signature = connections.map((entry) => entry.id).join(':');
  await writeFile('dist-e2e/demo.html', `<!doctype html><meta name="viewport" content="width=device-width"><title>Multi-server preview</title><p>Opening the two-server demo…</p><script>
    if (new URLSearchParams(location.search).has('reset') || localStorage.getItem('workspace-preview') !== ${JSON.stringify(signature)}) {
      for (const key of Object.keys(localStorage)) if (key.startsWith('opencode-mobile.')) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(${JSON.stringify(stored)})) localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('workspace-preview', ${JSON.stringify(signature)});
    }
    location.replace('/');
  </script>`);
  await writeFile('dist-e2e/preview-serve.json', JSON.stringify({ cleanUrls: false }));
  const port = await freePort();
  start('node_modules/serve/build/main.js', ['-s', 'dist-e2e', '-l', String(port), '--no-clipboard', '--config', 'preview-serve.json']);
  await wait(`http://localhost:${port}`);
  console.log(`\nHuman validation: http://localhost:${port}/demo.html\nReset local demo state: http://localhost:${port}/demo.html?reset=1\nCtrl+C stops the preview and both fake V2 servers.\n`);
} catch (error) { console.error(error.message); stop(); process.exit(1); }
