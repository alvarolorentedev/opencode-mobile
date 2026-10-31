import type { ConfigEntry, ConfigTarget, ExtensionScope, ExtensionSource } from '@/shared/protocol/opencode/extensions/types';

const SYSTEM_DIRECTORIES = [
  '/etc/opencode',
  '/library/application support/opencode',
  'c:/programdata/opencode',
];

export function pathKey(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function isWindowsPath(value: string) {
  return /^[a-z]:[\\/]/i.test(value) || value.includes('\\');
}

export function isInside(root: string, candidate: string) {
  const parent = pathKey(root);
  const child = pathKey(candidate);
  return child === parent || child.startsWith(`${parent}/`);
}

export function parentPath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : normalized;
  return normalized.slice(0, index);
}

export function joinPath(root: string, relative: string) {
  const separator = isWindowsPath(root) ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const child = relative.replace(/^[\\/]+/, '').split('/').join(separator).replace(/\\/g, separator);
  return `${base}${separator}${child}`;
}

export function relativePath(root: string, absolute: string) {
  const parent = pathKey(root);
  const child = pathKey(absolute);
  if (child === parent) return '';
  if (!child.startsWith(`${parent}/`)) return absolute;
  return absolute.slice(root.replace(/[\\/]+$/, '').length + 1);
}

export function isSystemConfigPath(value: string) {
  const normalized = pathKey(value);
  return SYSTEM_DIRECTORIES.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`));
}

/**
 * Built-in skills are served by the server from a virtual `/builtin/` path
 * rather than from a config directory.
 */
export function isBuiltinSkillPath(value: string | undefined) {
  if (!value) return false;
  const normalized = pathKey(value);
  return normalized === '/builtin' || normalized.startsWith('/builtin/');
}

function isOpenCodeConfigDirectory(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalized.endsWith('/opencode') && !normalized.endsWith('/.opencode');
}

/**
 * The global config directory is the first user-owned config directory outside
 * the active project. System directories and ancestor `.opencode` folders are
 * deliberately ignored, and an ambiguous result disables global writes instead
 * of guessing at the wrong location.
 */
export function resolveGlobalConfigRoot(entries: ConfigEntry[], projectRoot?: string) {
  const directories = entries
    .filter((entry): entry is { type: 'directory'; path: string } => entry.type === 'directory')
    .map((entry) => entry.path)
    .filter((path) => !projectRoot || !isInside(projectRoot, path))
    .filter((path) => !isSystemConfigPath(path))
    .filter((path) => pathKey(path).split('/').pop() !== '.opencode');

  const named = directories.filter(isOpenCodeConfigDirectory);
  if (named.length === 1) return named[0];
  if (directories.length === 1) return directories[0];
  return undefined;
}

export function configDocuments(entries: ConfigEntry[]) {
  return entries.flatMap((entry) =>
    entry.type === 'document' && entry.path ? [{ path: entry.path, info: entry.info }] : [],
  );
}

/**
 * Select the highest-precedence document that belongs to the requested scope.
 * New files are created next to the active project or in the user global
 * directory; system and ancestor project documents are never selected.
 */
export function selectConfigTarget(entries: ConfigEntry[], scope: ExtensionScope, root: string): Omit<ConfigTarget, 'exists' | 'safety'> {
  const docs = configDocuments(entries).filter((entry) => isInside(root, entry.path));
  const scoped = scope === 'general'
    ? docs.filter((entry) => pathKey(parentPath(entry.path)) === pathKey(root))
    : docs;
  const selected = scoped.at(-1)?.path ?? joinPath(root, 'opencode.jsonc');
  return {
    scope,
    root,
    path: selected,
    relativePath: relativePath(root, selected),
  };
}

export function sourceForPath(path: string | undefined, projectRoot?: string, globalRoot?: string): ExtensionSource {
  if (!path) return 'inherited';
  if (isSystemConfigPath(path) || isBuiltinSkillPath(path)) return 'system';
  if (projectRoot && isInside(projectRoot, path)) return 'project';
  if (globalRoot && isInside(globalRoot, path)) return 'general';
  return 'inherited';
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
