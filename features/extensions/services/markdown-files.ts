import type { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';
import { isInside, isSystemConfigPath, isWindowsPath, parentPath, shellQuote, trashRoot } from '@/shared/protocol/opencode/extensions/scope';
import { hasParentSegment, markdownRoots, markdownTrashPath, relativeMarkdownName } from '@/shared/protocol/opencode/extensions/markdown';
import { writeConfigTransaction, type ConfigTransactionResult, type ShellResult } from '@/shared/protocol/opencode/extensions/transaction';
import type { ExtensionMarkdownFile, ExtensionMarkdownTarget, ExtensionSafety, ExtensionScope } from '@/shared/protocol/opencode/extensions/types';

type Extensions = ReturnType<typeof createServerAdapter>['extensions'];

const MAX_FILES = 500;

function io(ext: Extensions) {
  return {
    read: ext.readText,
    write: ext.writeText,
    shell: (root: string, command: string) => ext.runShell(root, command),
  };
}

async function shellTest(ext: Extensions, cwd: string, command: string) {
  try {
    const result = await ext.runShell(cwd, command);
    return result.status === 'exited' && result.exit === 0;
  } catch {
    return false;
  }
}

async function hasSymlinkAncestor(ext: Extensions, cwd: string, scopeRoot: string, target: string) {
  let current = target;
  for (let depth = 0; depth < 24 && current && isInside(scopeRoot, current); depth += 1) {
    if (await shellTest(ext, cwd, `test -L ${shellQuote(current)}`)) return true;
    if (current === scopeRoot) break;
    const parent = parentPath(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return false;
}

async function nearestWritableDirectory(ext: Extensions, cwd: string, target: string) {
  let current = target;
  for (let depth = 0; depth < 24; depth += 1) {
    if (await shellTest(ext, cwd, `test -d ${shellQuote(current)}`)) {
      return (await shellTest(ext, cwd, `test -w ${shellQuote(current)}`))
        && (await shellTest(ext, cwd, `test -x ${shellQuote(current)}`));
    }
    const parent = parentPath(current);
    if (!parent || parent === current) return false;
    current = parent;
  }
  return false;
}

export async function buildMarkdownTarget({
  ext,
  root,
  scope,
  kind,
  projectRoot,
  shellAvailable,
}: {
  ext: Extensions;
  root: string;
  scope: ExtensionScope;
  kind: 'agents' | 'commands';
  projectRoot: string;
  shellAvailable: boolean;
}): Promise<ExtensionMarkdownTarget> {
  const safety: ExtensionSafety = {
    writable: false,
    shellAvailable,
    atomicRename: shellAvailable && !isWindowsPath(projectRoot),
    windows: isWindowsPath(projectRoot),
    system: false,
    symlink: false,
  };
  const exists = await shellTest(ext, projectRoot, `test -d ${shellQuote(root)}`);
  if (!projectRoot) return { scope, kind, root, scopeRoot: projectRoot, exists, safety: { ...safety, reason: 'Select a project before managing extensions.' } };
  if (safety.windows) return { scope, kind, root, scopeRoot: scope === 'project' ? projectRoot : parentPath(root), exists, safety: { ...safety, reason: 'Extension writes are not enabled on Windows servers yet.' } };
  if (!shellAvailable) return { scope, kind, root, scopeRoot: scope === 'project' ? projectRoot : parentPath(root), exists, safety: { ...safety, reason: 'The server does not expose the shell operations needed for a safe write.' } };
  safety.system = isSystemConfigPath(root);
  if (safety.system) return { scope, kind, root, scopeRoot: scope === 'project' ? projectRoot : parentPath(root), exists, safety: { ...safety, reason: 'This is a system-managed configuration directory.' } };
  const scopeRoot = scope === 'project' ? projectRoot : parentPath(root);
  if (await hasSymlinkAncestor(ext, projectRoot, scopeRoot, root)) {
    safety.symlink = true;
    return { scope, kind, root, scopeRoot, exists, safety: { ...safety, reason: 'The Markdown directory or one of its parents is a symlink.' } };
  }
  const writable = await nearestWritableDirectory(ext, projectRoot, root);
  if (!writable) return { scope, kind, root, scopeRoot: scope === 'project' ? projectRoot : parentPath(root), exists, safety: { ...safety, reason: 'The Markdown directory is not writable by the server.' } };
  safety.writable = true;
  return { scope, kind, root, scopeRoot: scope === 'project' ? projectRoot : parentPath(root), exists, safety };
}

export async function discoverMarkdownFiles({
  ext,
  projectRoot,
  globalRoot,
  scope,
  kind,
  targets,
}: {
  ext: Extensions;
  projectRoot: string;
  globalRoot?: string;
  scope: ExtensionScope;
  kind: 'agents' | 'commands';
  targets: ExtensionMarkdownTarget;
}) {
  const root = scope === 'project' ? projectRoot : globalRoot;
  if (!root || targets.safety.system || targets.safety.windows) return [] as ExtensionMarkdownFile[];
  const files: ExtensionMarkdownFile[] = [];
  for (const entry of markdownRoots(root, scope, kind)) {
    if (files.length >= MAX_FILES) break;
    const command = `find ${shellQuote(entry.root)} -name '*.md' -type f`;
    const symlinkCommand = `find ${shellQuote(entry.root)} -name '*.md' -type l`;
    const [regular, links] = await Promise.all([
      ext.runShell(projectRoot, command).catch((): ShellResult => ({ output: '', exit: 1, status: 'exited' })),
      ext.runShell(projectRoot, symlinkCommand).catch((): ShellResult => ({ output: '', exit: 1, status: 'exited' })),
    ]);
    const paths = new Map<string, boolean>();
    for (const line of regular.output.split(/\r?\n/)) {
      const path = line.trim();
      if (path && isInside(entry.root, path)) paths.set(path, false);
    }
    for (const line of links.output.split(/\r?\n/)) {
      const path = line.trim();
      if (path && isInside(entry.root, path)) paths.set(path, true);
    }
    for (const [path, symlink] of paths) {
      if (files.length >= MAX_FILES) break;
      const name = relativeMarkdownName(entry, path);
      if (!name) continue;
      let content: string | undefined;
      let error: string | undefined;
      if (symlink) {
        content = undefined;
        error = 'The file is a symbolic link.';
      } else {
        try {
          content = await ext.readText(path);
          if (content === undefined) error = 'The file could not be read.';
        } catch (failure) {
          error = failure instanceof Error ? failure.message : 'The file could not be read.';
        }
      }
      files.push({ kind, scope, root: entry.root, name, path, content, symlink, error });
    }
  }
  return files;
}

export async function assertMarkdownWritable({
  ext,
  projectRoot,
  root,
  path,
  create,
}: {
  ext: Extensions;
  projectRoot: string;
  root: string;
  path: string;
  create: boolean;
}) {
  if (hasParentSegment(path) || !isInside(root, path)) throw new Error('The Markdown file is outside the selected scope.');
  const scopeRoot = parentPath(root);
  if (await hasSymlinkAncestor(ext, projectRoot, scopeRoot, path)) throw new Error('The Markdown file or one of its parents is a symbolic link.');
  if (!create) {
    if (!(await shellTest(ext, projectRoot, `test -f ${shellQuote(path)}`))) throw new Error('The Markdown file no longer exists.');
    if (!(await shellTest(ext, projectRoot, `test -w ${shellQuote(path)}`))) throw new Error('The Markdown file is not writable by the server.');
  }
  const parent = parentPath(path);
  if (!(await nearestWritableDirectory(ext, projectRoot, parent))) throw new Error('The Markdown directory is not writable by the server.');
}

export async function writeMarkdownFile({
  ext,
  projectRoot,
  root,
  path,
  content,
  expected,
  validate,
}: {
  ext: Extensions;
  projectRoot: string;
  root: string;
  path: string;
  content: string;
  expected?: string | null;
  validate?: (content: string) => void;
}): Promise<ConfigTransactionResult> {
  await assertMarkdownWritable({ ext, projectRoot, root, path, create: expected === null });
  return writeConfigTransaction({ io: io(ext), root: projectRoot, target: path, content, expected, validate });
}

export async function trashMarkdownFile({
  ext,
  projectRoot,
  root,
  path,
  kind,
  name,
}: {
  ext: Extensions;
  projectRoot: string;
  root: string;
  path: string;
  kind: 'agents' | 'commands';
  name: string;
}) {
  await assertMarkdownWritable({ ext, projectRoot, root, path, create: false });
  const destination = markdownTrashPath(root, kind, name, Date.now());
  const trash = trashRoot(root);
  const made = await ext.runShell(projectRoot, `mkdir -p ${shellQuote(trash)}`);
  if (made.status !== 'exited' || made.exit !== 0) throw new Error('The extension trash directory could not be created.');
  const moved = await ext.runShell(projectRoot, `mv ${shellQuote(path)} ${shellQuote(destination)}`);
  if (moved.status !== 'exited' || moved.exit !== 0) throw new Error('The Markdown file could not be moved to the extension trash.');
  return destination;
}

export function restoreTrash(ext: Extensions, projectRoot: string, destination: string, path: string) {
  return ext.runShell(projectRoot, `mv ${shellQuote(destination)} ${shellQuote(path)}`);
}

export function markdownRootFor(kind: 'agents' | 'commands') {
  return kind;
}
