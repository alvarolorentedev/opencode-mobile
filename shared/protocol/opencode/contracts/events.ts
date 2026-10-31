import type { OpenCodeEvent } from '@opencode/client';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { SessionStatus } from '@/shared/protocol/opencode/types';
import { compatibilityStatus, translateCompatibilityEvent, type CompatibilityEvent } from '@/shared/protocol/opencode/compat/v1/events';
import { extractErrorMessage, numberField, stringField } from '@/shared/protocol/opencode/v2/fields';
// Providers need the native event payload, not transport metadata. Legacy events
// with matching semantics can therefore translate without inventing SDK records.
export type NativeProtocolEvent<E = OpenCodeEvent> = E extends OpenCodeEvent ? Omit<E, 'id' | 'created' | 'durable' | 'metadata'> : never;
export type OpencodeEvent = NativeProtocolEvent | CompatibilityEvent;
export async function* subscribeEvents(client: ScopedOpencodeClient, signal: AbortSignal, onActivity?: () => void): AsyncGenerator<OpencodeEvent> {
  if (client.compatibility) {
    const subscription = await client.compatibility.global.event({ signal, sseMaxRetryAttempts: 1 });
    for await (const event of subscription.stream) yield translateCompatibilityEvent(event);
    return;
  }
  yield* await client.api!.event.subscribe({ signal, onActivity });
}
export function getEventSessionStatus(event: OpencodeEvent): { sessionID: string; status: SessionStatus } | undefined {
  if (event.type === 'compatibility') return compatibilityStatus(event);
  const data = 'data' in event ? event.data as Record<string, unknown> : {};
  const sessionID = stringField(data.sessionID);
  if (!sessionID) return;
  if (event.type === 'session.status') return { sessionID, status: event.data.status };
  if (event.type === 'session.idle') return { sessionID, status: { type: 'idle' } };
  if (event.type === 'session.execution.started') return { sessionID, status: { type: 'busy' } };
  if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) return { sessionID, status: { type: 'idle' } };
  if (event.type === 'session.retry.scheduled') return { sessionID, status: { type: 'retry', attempt: numberField(data.attempt), message: extractErrorMessage(data.error), next: numberField(data.at) } };
}
