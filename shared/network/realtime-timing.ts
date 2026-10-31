const E2E_MODE = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_E2E_MODE === '1';
// The server reports keepalive frames through onActivity. Two missed
// keepalives are enough to re-establish a stream that died silently, while a
// short busy window keeps blocking permission/question prompts responsive.
export const SSE_STALENESS_MS = E2E_MODE ? 3000 : 60_000;
export const SSE_BUSY_STALENESS_MS = E2E_MODE ? 3000 : 45_000;
export const SSE_FOREGROUND_CYCLE_MS = E2E_MODE ? 1000 : 15_000;
export const SSE_CONNECT_TIMEOUT_MS = E2E_MODE ? 1500 : 15_000;
export const SSE_STABLE_MS = E2E_MODE ? 1000 : 5000;
export const WATCHDOG_TICK_MS = E2E_MODE ? 1000 : 5000;
