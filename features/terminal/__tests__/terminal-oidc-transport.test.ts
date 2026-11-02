import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { openTerminalWebSocket } from '@/features/terminal/services/terminal-service';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/shared/protocol/opencode/client', () => ({}));
vi.mock('@/shared/protocol/opencode/contracts/server-adapter', () => ({}));
afterEach(() => vi.unstubAllGlobals());

describe('native OIDC socket redirect policy', () => {
  it('requests redirect rejection only for OIDC sockets', () => {
    const socket = vi.fn(class {}); vi.stubGlobal('WebSocket', socket);
    openTerminalWebSocket('wss://server.test/pty', { 'X-Token': 'synthetic' }, true);
    expect(socket).toHaveBeenLastCalledWith('wss://server.test/pty', undefined, { headers: { 'X-Token': 'synthetic' }, redirect: 'error' });
    openTerminalWebSocket('ws://server.test/pty', { Authorization: 'Basic synthetic' });
    expect(socket).toHaveBeenLastCalledWith('ws://server.test/pty', undefined, { headers: { Authorization: 'Basic synthetic' } });
  });
  it('ships the native policy rather than patching unused prebuilt source', () => {
    const js = readFileSync('node_modules/react-native/Libraries/WebSocket/WebSocket.js', 'utf8');
    const kotlin = readFileSync('node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt', 'utf8');
    expect(js).toContain('{headers, redirect, unstable_devToolsRequestId: devToolsRequestId}');
    expect(kotlin).toContain('okHttpBuilder.followRedirects(false).followSslRedirects(false)');
    expect(readFileSync('app.config.ts', 'utf8')).toContain('buildReactNativeFromSource: true');
  });
});
