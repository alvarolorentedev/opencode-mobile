// Splits the server catalog by the device-local hidden set. Hidden rows are
// only server projects whose path matches; a stale hidden path renders nothing.
export function splitHiddenProjects<T extends { path: string }>(projects: readonly T[], hiddenPaths: readonly string[]) {
  const hidden = new Set(hiddenPaths);
  const visible: T[] = [];
  const archived: T[] = [];
  for (const project of projects) (hidden.has(project.path) ? archived : visible).push(project);
  return { visible, hidden: archived };
}
