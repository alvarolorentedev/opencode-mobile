import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { mergeSharedDraft } from '@/lib/share/parse';
import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';

type Input = { draft: string; attachments: PromptAttachment[] };
type FailedInput = Input & { owner: string; sessionId?: string };

// Local composer edits belong to the user, including edits made during admission.
export function useChatDraft(owner: string, sessionId?: string) {
  const [input, setInput] = useState<Input>({ draft: '', attachments: [] });
  const [failed, setFailed] = useState<FailedInput>();
  const inputRef = useRef(input);
  const revision = useRef(0);
  const context = useRef({ owner, sessionId });
  useLayoutEffect(() => { context.current = { owner, sessionId }; }, [owner, sessionId]);
  const edit = useCallback((patch: Partial<Input>) => {
    revision.current++;
    inputRef.current = { ...inputRef.current, ...patch };
    setInput(inputRef.current);
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
        else setFailed({ ...snapshot, owner: origin.owner, sessionId: target ?? origin.sessionId });
        return true;
      },
      belongsHere,
    };
  }, [edit]);
  const recoverFailedInput = useCallback(() => {
    if (!failed || failed.owner !== owner || failed.sessionId !== sessionId) return;
    edit(mergeSharedDraft(inputRef.current.draft, inputRef.current.attachments, { text: failed.draft, attachments: failed.attachments, skipped: [] }));
    setFailed(undefined);
  }, [edit, failed, owner, sessionId]);
  return { ...input, inputRef, setDraft, setAttachments, capture, recoverFailedInput,
    dismissFailedInput: () => setFailed(undefined),
    hasFailedInput: !!failed && failed.owner === owner && failed.sessionId === sessionId };
}
