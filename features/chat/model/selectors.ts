

// An error with no session is global; one with a session is only relevant when
// that session is the active/sending session or one of its descendants, so a
// failing subagent surfaces in the parent chat instead of silently hiding.
export function isPromptErrorVisible(
  promptError: { sessionId?: string } | undefined,
  relatedSessionIds: Iterable<string>,
): boolean {
  if (!promptError) {
    return false;
  }
  if (!promptError.sessionId) {
    return true;
  }
  for (const sessionId of relatedSessionIds) {
    if (sessionId === promptError.sessionId) {
      return true;
    }
  }
  return false;
}
