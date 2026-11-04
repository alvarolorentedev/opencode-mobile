import type {
  DiagnosticRecord,
  ObservabilityKind,
  ObservabilityLevel,
  ObservabilityStatus,
  SafeAttribute,
  SafeAttributes,
} from '@/shared/observability/types';

// This is an allowlist, not a best-effort blacklist. Instrumentation can only
// contribute metadata keys listed here; unknown keys are dropped before any
// persistence or export. Free text is scrubbed separately because error
// messages and stack traces are the most likely accidental leak path.

const ATTRIBUTE_KEYS = new Set([
  'operation',
  'phase',
  'outcome',
  'status',
  'statusClass',
  'statusCode',
  'method',
  'networkType',
  'generation',
  'retry',
  'attempt',
  'retryable',
  'online',
  'constrained',
  'failureKind',
  'errorName',
  'durationMs',
  'count',
  'bytes',
  'size',
  'bucket',
  'unit',
  'kind',
  'category',
  'screen',
  'route',
  'source',
  'reason',
  'fatal',
  'coldStart',
  'connected',
  'foreground',
  'eventStreamStatus',
  'spanCount',
  'dropped',
  'cacheHit',
  'sessionKind',
  'toolCategory',
  'contract',
  'notificationKind',
  'permissionStatus',
  'queueDepth',
  'compressed',
  'metricType',
  'recordCount',
  'buildVariant',
  'appVersion',
]);

const LEVELS = new Set<ObservabilityLevel>(['debug', 'info', 'warn', 'error']);
const KINDS = new Set<ObservabilityKind>(['log', 'span', 'metric', 'error']);
const STATUSES = new Set<ObservabilityStatus>(['ok', 'error', 'cancelled']);

const MAX_MESSAGE = 600;
const MAX_STACK = 4000;
const MAX_ATTRIBUTE = 120;
const NAME_PATTERN = /^[a-z][a-z0-9._-]{1,80}$/;
const SAFE_LABEL_PATTERN = /^[a-zA-Z0-9._:/-]{0,80}$/;

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s)\]}"']+/gi;
const FILE_URL_PATTERN = /\bfile:\/\/[^\s)\]}"']+/gi;
const UNIX_PATH_PATTERN = /(?:\/(?:Users|home|root|data|storage|var|private|tmp|mnt|opt|sdcard|system|Library)\/[^\s)\]}"']+)/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s)\]}"']+/g;
const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const QUERY_SECRET_PATTERN = /([?&](?:token|key|secret|password|access_token|refresh_token|code|auth|signature)=)[^&\s]+/gi;
const KEY_SECRET_PATTERN = /\b(?:token|secret|password|passwd|api[_-]?key|key|authorization|credential|pairing[_-]?code)\s*[:=]\s*[^\s,;]+/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;
const BASE64_PATTERN = /\b[A-Za-z0-9+/]{60,}={0,2}\b/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function scrubText(value: string, maxLength = MAX_MESSAGE) {
  const scrubbed = value
    .replace(CONTROL_PATTERN, ' ')
    .replace(FILE_URL_PATTERN, '[path]')
    .replace(URL_PATTERN, '[url]')
    .replace(UNIX_PATH_PATTERN, '[path]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(AUTHORIZATION_PATTERN, '$1 [redacted]')
    .replace(QUERY_SECRET_PATTERN, '$1[redacted]')
    .replace(KEY_SECRET_PATTERN, '[redacted]')
    .replace(BASE64_PATTERN, '[redacted]')
    .replace(LONG_TOKEN_PATTERN, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, Math.max(0, maxLength - 1))}…` : scrubbed;
}

export function scrubStack(stack: string | undefined) {
  if (!stack) return undefined;
  const lines = stack.split(/\r?\n/).slice(0, 24).map((line) => scrubText(line, 240)).filter(Boolean);
  const value = lines.join('\n');
  return value.length > MAX_STACK ? `${value.slice(0, MAX_STACK - 1)}…` : value;
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown, maxLength = MAX_ATTRIBUTE) {
  if (typeof value !== 'string') return undefined;
  const scrubbed = scrubText(value, maxLength);
  if (!scrubbed || !SAFE_LABEL_PATTERN.test(scrubbed)) return undefined;
  return scrubbed;
}

function safeAttribute(value: unknown): SafeAttribute | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const scrubbed = scrubText(value, MAX_ATTRIBUTE);
    return scrubbed || undefined;
  }
  return undefined;
}

export function sanitizeAttributes(attrs: SafeAttributes | undefined) {
  if (!attrs) return undefined;
  const result: SafeAttributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!ATTRIBUTE_KEYS.has(key)) continue;
    const safe = safeAttribute(value);
    if (safe !== undefined) result[key] = safe;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function sanitizeName(name: string) {
  return NAME_PATTERN.test(name) ? name : 'unknown';
}

export function sanitizeRecord(record: DiagnosticRecord): DiagnosticRecord {
  const kind = KINDS.has(record.kind) ? record.kind : 'log';
  const level = record.level && LEVELS.has(record.level) ? record.level : undefined;
  const status = record.status && STATUSES.has(record.status) ? record.status : undefined;
  const ts = safeNumber(record.ts) ?? Date.now();
  const durationMs = safeNumber(record.durationMs);
  const value = safeNumber(record.value);
  const unit = safeString(record.unit, 20);
  return {
    v: 1,
    ts: Math.max(0, Math.round(ts)),
    kind,
    name: sanitizeName(record.name),
    ...(level ? { level } : {}),
    ...(record.message ? { message: scrubText(record.message) } : {}),
    ...(record.stack ? { stack: scrubStack(record.stack) } : {}),
    ...(sanitizeAttributes(record.attrs) ? { attrs: sanitizeAttributes(record.attrs) } : {}),
    ...(record.traceId && /^[a-f0-9]{32}$/i.test(record.traceId) ? { traceId: record.traceId } : {}),
    ...(record.spanId && /^[a-f0-9]{16}$/i.test(record.spanId) ? { spanId: record.spanId } : {}),
    ...(record.parentSpanId && /^[a-f0-9]{16}$/i.test(record.parentSpanId) ? { parentSpanId: record.parentSpanId } : {}),
    ...(record.sessionId && safeString(record.sessionId, 32) ? { sessionId: record.sessionId } : {}),
    ...(durationMs !== undefined ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}),
    ...(status ? { status } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(unit ? { unit } : {}),
  };
}

export type SanitizedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
};

export function sanitizeError(error: unknown): SanitizedError {
  let name = 'Error';
  let message = 'Unknown error';
  let stack: string | undefined;
  let code: string | number | undefined;
  if (error instanceof Error) {
    name = safeString(error.name, 40) ?? 'Error';
    message = scrubText(error.message || error.name);
    stack = scrubStack(error.stack);
    const rawCode = (error as Error & { code?: unknown }).code;
    if (typeof rawCode === 'string') code = scrubText(rawCode, 40);
    else if (typeof rawCode === 'number' && Number.isFinite(rawCode)) code = rawCode;
  } else if (typeof error === 'string') {
    message = scrubText(error);
  } else if (error && typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
    name = safeString(record.name, 40) ?? 'Error';
    message = scrubText(typeof record.message === 'string' ? record.message : String(error));
    stack = scrubStack(typeof record.stack === 'string' ? record.stack : undefined);
    if (typeof record.code === 'string') code = scrubText(record.code, 40);
    else if (typeof record.code === 'number' && Number.isFinite(record.code)) code = record.code;
  } else {
    message = scrubText(String(error));
  }
  return {
    name,
    message,
    ...(stack ? { stack } : {}),
    ...(code !== undefined ? { code } : {}),
  };
}

export function sanitizeLevel(value: unknown): ObservabilityLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info';
}
