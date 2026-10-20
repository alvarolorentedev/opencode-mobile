function presentationOwner(key: string) {
  try {
    const [kind, ...encoded] = key.split(':');
    const [owner] = JSON.parse(encoded.join(':'));
    return ['composer', 'failed-input', 'scroll'].includes(kind) ? JSON.parse(owner)[0] : owner;
  } catch { return undefined; }
}
export function clearWorkspacePresentation(presentation: Map<string, unknown>, connectionId: string) {
  for (const key of presentation.keys()) if (presentationOwner(key) === connectionId) presentation.delete(key);
}

export function hasWorkspaceDrafts(presentation: Map<string, unknown>, connectionId?: string) {
  return [...presentation.entries()].some(([key, value]) => {
    const composer = key.startsWith('composer:') || key.startsWith('failed-input:');
    if (!composer && !key.startsWith('editor:')) return false;
    if (connectionId && presentationOwner(key) !== connectionId) return false;
    if (!value || typeof value !== 'object') return false;
    if (composer) {
      const draft = value as { draft?: string; attachments?: unknown[] };
      return Boolean(draft.draft || draft.attachments?.length);
    }
    if (key.startsWith('editor:')) {
      const draft = value as { original: string; value: string };
      return draft.original !== draft.value;
    }
    return false;
  });
}
