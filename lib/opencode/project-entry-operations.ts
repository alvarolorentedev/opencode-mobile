import { projectPath } from './project';
import { shellQuote } from './extensions/scope';
import type { ShellResult } from './extensions/transaction';

export type EntrySource = { root: string; path: string; type: 'file' | 'directory' };
export type EntryOperation = { kind: 'copy' | 'move'; source: EntrySource; destination: { root: string; path: string } };
export type EntryErrorCode = 'unsupported' | 'unsafe' | 'missing' | 'collision' | 'changed' | 'failed' | 'uncertain' | 'cleanup';
export class EntryOperationError extends Error {
  constructor(readonly code: EntryErrorCode) { super(code); }
}
export type EntryShell = (root: string, command: string) => Promise<ShellResult>;
export const ENTRY_PROBE = "sh -c 'command -v cp mv rm find cksum ls mktemp ln diff mkdir >/dev/null'";

// Only positional arguments contain user paths; the program itself is fixed.
const checks = `
set -eu
set -f
fail() { printf 'OCF:%s' "$1"; exit 1; }
safe() {
  base=$1; relative=$2
  [ -d "$base" ] || fail missing
  base=$(CDPATH= cd "$base" && pwd -P) || fail unsafe
  cursor=\${base%/}
  oldifs=$IFS; IFS=/
  for part in $relative; do
    cursor=$cursor/$part
    [ ! -L "$cursor" ] || fail unsafe
  done
  IFS=$oldifs
  printf '%s' "$cursor"
}
src=$(safe "$1" "$2") || { printf '%s' "$src"; exit 1; }
dst=$(safe "$4" "$5") || { printf '%s' "$dst"; exit 1; }
[ "$src" != "$dst" ] || fail unsafe
case "$dst/" in "$src/"*) fail unsafe ;; esac
[ -e "$src" ] || fail missing
if [ "$3" = directory ]; then [ -d "$src" ] || fail changed
else [ -f "$src" ] || fail changed; fi
parent=\${dst%/*}
[ -d "$parent" ] || fail missing
invalid=$(find "$src" ! -type f ! -type d -print) || fail failed
[ -z "$invalid" ] || fail unsafe
fingerprint() {
  [ ! -L "$dst" ] || fail unsafe
  if [ -e "$dst" ]; then
    [ "$3" = file ] && [ -f "$dst" ] || fail collision
    printf 'file:'
    ls -din "$dst" || fail failed
    cksum < "$dst" || fail failed
  else printf missing; fi
}
`;

const mutation = `
verified=$(safe "$1" "$2") || { printf '%s' "$verified"; exit 1; }
[ "$verified" = "$src" ] || fail changed
verified=$(safe "$4" "$5") || { printf '%s' "$verified"; exit 1; }
[ "$verified" = "$dst" ] || fail changed
actual=$(fingerprint "$@") || { printf '%s' "$actual"; exit 1; }
[ "$actual" = "$7" ] || fail changed
stage=$(mktemp -d "$parent/.opencode-mobile-files.XXXXXX") || fail failed
trap 'rm -rf "$stage"' 0
payload="$stage/\${dst##*/}"
cp -pR "$src" "$payload" || fail failed
diff -r "$src" "$payload" >/dev/null || fail changed
actual=$(fingerprint "$@") || { printf '%s' "$actual"; exit 1; }
[ "$actual" = "$7" ] || fail changed
if [ "$3" = directory ]; then
  # Reserve the name atomically: mv alone could silently merge into a new folder.
  mkdir "$dst" || fail changed
  cp -pR "$payload/." "$dst/" || fail cleanup
elif [ "$7" = missing ]; then
  ln "$payload" "$dst" || fail changed
else
  mv -f "$payload" "$parent/" || fail failed
fi
if [ "$6" = move ]; then
  diff -r "$src" "$dst" >/dev/null || fail cleanup
  rm -r "$src" || fail cleanup
fi
printf ok
`;

export function validateEntryOperation(operation: EntryOperation) {
  for (const { root, path } of [operation.source, operation.destination]) {
    if (!root.startsWith('/') || /[\x00-\x1f]/.test(root)) throw new EntryOperationError('unsafe');
    try { if (projectPath(path, root) !== path) throw new Error(); }
    catch { throw new EntryOperationError('unsafe'); }
  }
}

export function entryCommand(operation: EntryOperation, expected?: string) {
  validateEntryOperation(operation);
  const { source, destination, kind } = operation;
  const args = [source.root, source.path, source.type, destination.root, destination.path, kind];
  if (expected !== undefined) args.push(expected);
  return `sh -c ${shellQuote(checks + (expected === undefined ? 'fingerprint "$@"' : mutation))} opencode-files ${args.map(shellQuote).join(' ')}`;
}

export async function inspectEntry(shell: EntryShell, operation: EntryOperation) {
  return checked(await shell(operation.destination.root, entryCommand(operation)));
}
export async function mutateEntry(shell: EntryShell, operation: EntryOperation, expected: string) {
  try {
    if (checked(await shell(operation.destination.root, entryCommand(operation, expected))) !== 'ok') throw new EntryOperationError('uncertain');
  } catch (error) {
    if (error instanceof EntryOperationError) throw error;
    throw new EntryOperationError('uncertain');
  }
}
function checked(result: ShellResult) {
  if (result.status !== 'exited') throw new EntryOperationError('uncertain');
  if (result.exit !== 0) {
    const code = result.output.match(/OCF:(unsafe|missing|collision|changed|failed|cleanup)/)?.[1];
    throw new EntryOperationError((code as EntryErrorCode) || 'failed');
  }
  return result.output.trim();
}
