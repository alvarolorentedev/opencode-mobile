// Pure directory navigation for the server folder picker. Server paths are
// absolute and may use either separator; no filesystem access happens here.
export function isWindowsDirectory(value: string) {
  return /^[a-z]:[\\/]/i.test(value) || value.includes('\\');
}

export function parentDirectory(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return value.startsWith('/') ? '/' : value;
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : normalized;
  const parent = normalized.slice(0, index);
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}

export function childDirectory(root: string, child: string) {
  const separator = isWindowsDirectory(root) ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const name = child.replace(/^[\\/]+/, '').split('/').join(separator).replace(/\\/g, separator);
  return `${base}${separator}${name}`;
}
