import { createHash } from 'node:crypto';
import { filesForDirectory } from './workspace.mjs';

// Parse the fixed program's shell-quoted positional arguments without eval.
function shellWords(command) {
  const words = [];
  let word = '', quoted = false, started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "'") { quoted = !quoted; started = true; }
    else if (char === '\\' && !quoted) { word += command[++i]; started = true; }
    else if (/\s/.test(char) && !quoted) { if (started) words.push(word); word = ''; started = false; }
    else { word += char; started = true; }
  }
  if (started) words.push(word);
  return words;
}

export function runProjectFileShell(state, command) {
  if (command.startsWith("sh -c 'command -v ")) return { output: '', status: 'exited', exit: 0 };
  if (!command.startsWith('sh -c ')) return undefined;
  const words = shellWords(command);
  if (words[3] !== 'opencode-files') return undefined;
  const [sourceRoot, sourcePath, type, targetRoot, targetPath, kind, expected] = words.slice(4);
  const fail = (code) => ({ output: `OCF:${code}`, status: 'exited', exit: 1 });
  const ok = (output) => ({ output, status: 'exited', exit: 0 });
  const valid = (path) => path && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..') && !/[\x00-\x1f\\]/.test(path);
  if (!valid(sourcePath) || !valid(targetPath)) return fail('unsafe');
  const source = filesForDirectory(state, sourceRoot), target = filesForDirectory(state, targetRoot);
  if (!source || !target) return fail('missing');
  const sourceAbsolute = `${sourceRoot}/${sourcePath}`, targetAbsolute = `${targetRoot}/${targetPath}`;
  if (sourceAbsolute === targetAbsolute || targetAbsolute.startsWith(`${sourceAbsolute}/`)) return fail('unsafe');
  state.emptyDirectories ||= {};
  const sourceEmpty = state.emptyDirectories[sourceRoot] ||= new Set();
  const targetEmpty = state.emptyDirectories[targetRoot] ||= new Set();
  const children = Object.keys(source).filter((path) => path === sourcePath || path.startsWith(`${sourcePath}/`));
  if (!children.length && !sourceEmpty.has(sourcePath)) return fail('missing');
  if ((type === 'file') !== Object.hasOwn(source, sourcePath)) return fail('changed');
  const parent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
  if (parent && !Object.keys(target).some((path) => path.startsWith(`${parent}/`)) && !targetEmpty.has(parent)) return fail('missing');
  if (Object.keys(target).some((path) => path.startsWith(`${targetPath}/`)) || targetEmpty.has(targetPath)) return fail('collision');
  const exists = Object.hasOwn(target, targetPath);
  if (exists && type !== 'file') return fail('collision');
  const token = exists ? `file:${createHash('sha256').update(target[targetPath]).digest('hex')}` : 'missing';
  if (expected === undefined) return ok(token);
  if (token !== expected) return fail('changed');
  for (const path of children) target[targetPath + path.slice(sourcePath.length)] = source[path];
  for (const path of [...sourceEmpty]) if (path === sourcePath || path.startsWith(`${sourcePath}/`)) targetEmpty.add(targetPath + path.slice(sourcePath.length));
  if (kind === 'move') {
    for (const path of children) delete source[path];
    for (const path of [...sourceEmpty]) if (path === sourcePath || path.startsWith(`${sourcePath}/`)) sourceEmpty.delete(path);
  }
  state.fileOperationStatuses ||= {};
  for (const [root, path, status] of [[targetRoot, targetPath, exists ? 'modified' : 'added'], ...(kind === 'move' ? [[sourceRoot, sourcePath, 'deleted']] : [])]) {
    (state.fileOperationStatuses[root] ||= {})[path] = { file: path, additions: 0, deletions: 0, status };
  }
  return ok('ok');
}
