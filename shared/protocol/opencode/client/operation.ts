// Maps request URLs to a small, bounded operation vocabulary. Raw URLs, host
// names and path variables never become labels, logs or exported diagnostics.
export function classifyHttpOperation(input: string | URL, method = 'GET') {
  let path = '';
  try {
    path = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost').pathname;
  } catch {
    return 'http.other';
  }
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '');
  if (normalized.endsWith('/event')) return 'event-stream';
  if (normalized.includes('/pty')) return 'terminal';
  if (normalized.includes('/session/') && /\/message/.test(normalized)) return 'transcript';
  if (normalized.includes('/session/') && /\/prompt/.test(normalized)) return 'prompt';
  if (normalized.includes('/session/') && /\/permission/.test(normalized)) return 'permission';
  if (normalized.includes('/session/') && /\/question/.test(normalized)) return 'question';
  if (normalized.includes('/session/') && /\/diff/.test(normalized)) return 'diff';
  if (normalized.includes('/session/') && /\/todo/.test(normalized)) return 'todo';
  if (normalized.includes('/session/')) return 'session';
  if (normalized.includes('/project')) return 'project';
  if (normalized.includes('/provider') || normalized.includes('/config')) return 'config';
  if (normalized.includes('/file')) return 'file';
  if (normalized.includes('/health') || normalized.includes('/info')) return 'probe';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return 'mutation';
  return 'http.other';
}

export function classifyStatus(status: number | undefined) {
  if (status === undefined) return 'network';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500) return '5xx';
  return 'other';
}
