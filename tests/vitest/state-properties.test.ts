import * as fc from 'fast-check';
import { expect, it } from 'vitest';

import {
  liveTranscriptRecord, overlayLiveRecords, reduceLiveEvent, userMessageRecord, type LiveTranscriptMessage,
} from '@/features/chat/model/live-transcript';
import { connectionTransition, type ConnectionLifecycle } from '@/features/connections/model/connection-lifecycle';
import { mergeSessionStatuses, RETRY_STATUS_STALE_MS } from '@/features/sessions/model/session-utils';
import { mergeSessionMessageWindow } from '@/shared/presentation/format/window';
import type { OpencodeEvent } from '@/shared/protocol/opencode/events';
import type { SessionStatus } from '@/shared/protocol/opencode/types';

it('keeps the latest connection state when older operations settle', () => {
  fc.assert(fc.property(fc.nat({ max: 10_000 }), fc.string(), fc.nat({ max: 500 }), (operation, message, distance) => {
    const initial: ConnectionLifecycle = { phase: 'idle', operation: 0, contract: 'v2', connection: { status: 'idle', message: '' } };
    const current = connectionTransition(initial, { type: 'start', operation: operation + 1, message });
    const obsolete = connectionTransition(current, {
      type: 'settle', operation: operation - distance, connection: { status: 'error', message: 'outdated' },
    });
    expect(obsolete).toBe(current);
  }));
});

it('merges only listed sessions and preserves a retry up to its deadline', () => {
  fc.assert(fc.property(fc.nat({ max: 10_000 }), fc.integer({ min: -1000, max: 1000 }), fc.boolean(),
    (next, offset, busy) => {
      const deadline = next + 1;
      const retry: SessionStatus = { type: 'retry', attempt: 1, message: 'wait', next: deadline };
      const server: SessionStatus = { type: busy ? 'busy' : 'idle' };
      const statuses = mergeSessionStatuses({ orphan: retry, selected: retry }, { selected: server }, deadline + RETRY_STATUS_STALE_MS + offset);
      expect(Object.keys(statuses)).toEqual(['selected']);
      expect(statuses.selected).toBe(!busy && offset < 0 ? retry : server);
    }));
});

it('fills gaps in an anchored transcript page without changing known order or references', () => {
  const unique = fc.uniqueArray(fc.integer(), { minLength: 3, maxLength: 30 });
  fc.assert(fc.property(unique, (ids) => {
    const full = ids.map((id, index) => userMessageRecord({
      id: String(id), sessionID: 's', createdAt: index, text: String(id), attachments: [],
    }));
    const held = full.filter((_, index) => index === 0 || index % 3 === 0 || index === ids.length - 1);
    const merged = mergeSessionMessageWindow(held, full, { applyUpdates: false });
    expect(merged.map(({ info }) => info.id)).toEqual(ids.map(String));
    for (const row of held) expect(merged[full.indexOf(row)]).toBe(row);
    expect(mergeSessionMessageWindow(merged, full)).toBe(merged);
  }));
});

it('overlays all received deltas without moving the streamed turn or changing neighboring records', () => {
  fc.assert(fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 30 }), (deltas) => {
    const makeUser = (id: string, createdAt: number) => userMessageRecord({
      id, sessionID: 's', text: id, createdAt, attachments: [],
    });
    let message: LiveTranscriptMessage | undefined;
    for (const delta of deltas) {
      const event = { type: 'session.text.delta', created: 2, data: { sessionID: 's', assistantMessageID: 'a', ordinal: 0, delta } };
      const result = reduceLiveEvent(message, event as OpencodeEvent);
      if (result.kind !== 'update') throw new Error('A valid text delta must update the live turn.');
      message = result.message;
    }
    if (!message) throw new Error('At least one delta is required.');
    const before = makeUser('previous', 1);
    const after = makeUser('next', 3);
    const stale = liveTranscriptRecord({ ...message, text: [{ ordinal: 0, text: 'stale' }] });
    const rows = overlayLiveRecords([before, stale, after], [message]);
    expect(rows.map(({ info }) => info.id)).toEqual(['previous', 'a', 'next']);
    expect(rows[0]).toBe(before);
    expect(rows[2]).toBe(after);
    const text = rows[1].parts.find((part) => part.type === 'text');
    expect(text?.text ?? '').toBe(deltas.join(''));
  }));
});
