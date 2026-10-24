// Worker-to-fake-server mapping shared by the Playwright config and test
// fixtures. The web export no longer bakes a server URL, so every worker can
// use its own V1/V2 pair against one shared build.
export const compatibilityTitles = [
  'sessions archive and restore without deletion',
  'idle chats stay active and archived cards restore and continue the same session',
  'archived cards restore sessions in their own project and keep errors retryable',
  'V1 providers retain API-key login alongside OAuth metadata',
  'settings do not suggest a duplicated /api base when the API prefix is already set',
  'composer exposes direct approvals, agent selection and thinking in the model picker without losing drafts',
  'project files save through a conflict-checked VCS patch',
];

export function usesCompatibility(title) {
  // Playwright tags (for example `@smoke`) are part of the title; ignore them
  // when matching the fixed compatibility contract list.
  const base = title.replace(/\s+@[^\s]+$/, '');
  return compatibilityTitles.includes(base) || base.includes('v1 compatibility');
}

export function getWorkerCount() {
  const configured = Number(process.env.E2E_WORKERS);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return process.env.CI ? 4 : 2;
}

// Map a worker slot to its fake V1/V2 pair. Callers pass Playwright's
// `parallelIndex` (stable 0..workers-1), not `workerIndex`: a restarted worker
// gets a fresh workerIndex and would point at a server that was never started.
export function workerBackend(parallelIndex) {
  const workerCount = getWorkerCount();
  if (!Number.isInteger(parallelIndex) || parallelIndex < 0 || parallelIndex >= workerCount) {
    throw new Error(`E2E parallel index ${parallelIndex} is outside the configured worker count ${workerCount}.`);
  }
  const base = Number(process.env.E2E_FAKE_PORT_BASE || 44096);
  const v2Port = base + parallelIndex * 2;
  const v1Port = v2Port + 1;
  return {
    workerIndex: parallelIndex,
    v2Port,
    v1Port,
    v2: `http://127.0.0.1:${v2Port}`,
    v1: `http://127.0.0.1:${v1Port}`,
  };
}

export function isReservedPort(port) {
  const base = Number(process.env.E2E_FAKE_PORT_BASE || 44096);
  const fakePortCount = getWorkerCount() * 2;
  const webPort = Number(process.env.E2E_WEB_PORT || 19006);
  return port === webPort || (port >= base && port < base + fakePortCount);
}
