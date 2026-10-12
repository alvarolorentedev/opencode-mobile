export function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record._tag === 'string') return record._tag;
  }
  return 'OpenCode request failed.';
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(extractErrorMessage(error));
}
