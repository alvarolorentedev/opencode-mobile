import { useCallback, useLayoutEffect, useRef, type SetStateAction } from 'react';
import { useRetainedState } from '@/components/ui/use-retained-state';
import { mergeSharedDraft } from '@/lib/share/parse';
import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';

type Input = { draft: string; attachments: PromptAttachment[] };
type FailedInput = Input & { owner: string; sessionId?: string };

// Local composer edits belong to the user, including edits made during admission.
export function useChatDraft(owner: string, sessionId?: string) {
  const [input, setInput] = useRetainedState<Input>(`composer:${JSON.stringify([owner, sessionId ?? ''])}`, { draft: '', attachments: [] });
  const [failed, setFailed] = useRetainedState<FailedInput | undefined>(`failed-input:${JSON.stringify([owner, sessionId ?? ''])}`, undefined);
  const inputRef = useRef(input);
  const setters = useRef({ setInput, setFailed });
  const revision = useRef(0);
  const context = useRef({ owner, sessionId });
  useLayoutEffect(() => {
    const previous = context.current;
    const held = inputRef.current;
    let next = input;
    if (previous.owner === owner && !previous.sessionId && sessionId && (held.draft || held.attachments.length)) {
      next = input.draft || input.attachments.length ? mergeSharedDraft(input.draft, input.attachments, { text: held.draft, attachments: held.attachments, skipped: [] }) : held;
      setters.current.setInput({ draft: '', attachments: [] });
      setInput(next);
    }
    context.current = { owner, sessionId }; inputRef.current = next; setters.current = { setInput, setFailed };
  }, [owner, sessionId, input, setInput, setFailed]);
  const edit = useCallback((patch: Partial<Input>) => {
    revision.current++;
    inputRef.current = { ...inputRef.current, ...patch };
    setters.current.setInput(inputRef.current);
  }, []);
  const setDraft = useCallback((value: SetStateAction<string>) => edit({ draft: typeof value === 'function' ? value(inputRef.current.draft) : value }), [edit]);
  const setAttachments = useCallback((value: SetStateAction<PromptAttachment[]>) => edit({ attachments: typeof value === 'function' ? value(inputRef.current.attachments) : value }), [edit]);
  const capture = useCallback((draftOverride?: string) => {
    const snapshot = { ...inputRef.current, draft: draftOverride ?? inputRef.current.draft };
    let expectedRevision = revision.current;
    const origin = context.current;
    const belongsHere = (target?: string) => origin.owner === context.current.owner &&
      (origin.sessionId === context.current.sessionId || (!origin.sessionId && context.current.sessionId === target));
    return {
      ...snapshot,
      clear(target: string) {
        if (!belongsHere(target) || expectedRevision !== revision.current) return;
        edit({ draft: '', attachments: [] });
        expectedRevision = revision.current;
      },
      restore(target?: string) {
        if (!belongsHere(target)) return false;
        if (expectedRevision === revision.current) edit(snapshot);
        else setters.current.setFailed({ ...snapshot, owner: origin.owner, sessionId: target ?? origin.sessionId });
        return true;
      },
      belongsHere,
    };
  }, [edit]);
  const recoverFailedInput = useCallback(() => {
    if (!failed || failed.owner !== owner || failed.sessionId !== sessionId) return;
    edit(mergeSharedDraft(inputRef.current.draft, inputRef.current.attachments, { text: failed.draft, attachments: failed.attachments, skipped: [] }));
    setFailed(undefined);
  }, [edit, failed, owner, sessionId, setFailed]);
  return { ...input, inputRef, setDraft, setAttachments, capture, recoverFailedInput,
    dismissFailedInput: () => setFailed(undefined),
    hasFailedInput: !!failed && failed.owner === owner && failed.sessionId === sessionId };
}
