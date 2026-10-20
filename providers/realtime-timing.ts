const E2E_MODE = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_E2E_MODE === '1';
export const SSE_STALENESS_MS = E2E_MODE ? 3000 : 90_000;
export const SSE_FOREGROUND_CYCLE_MS = E2E_MODE ? 1000 : 15_000;
export const WATCHDOG_TICK_MS = 7000;
