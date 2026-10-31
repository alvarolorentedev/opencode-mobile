// Shared guard for service wrappers: the SDK types every response as optional,
// so a missing payload is treated as a failed request instead of propagating
// `undefined` into provider state.
export function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}
