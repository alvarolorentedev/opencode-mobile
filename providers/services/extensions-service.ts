import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { createServerAdapter } from '@/lib/opencode/contracts/server-adapter';
import { addPlugin as addPluginText, createConfigText, parseConfigText, pluginTarget, readCommands, readMcpServers, readPlugins, removeCommand as removeCommandText, removeMcpServer as removeMcpServerText, removePlugin as removePluginText, setCommand, setMcpServer } from '@/lib/opencode/extensions/jsonc';
import { isInside, isSystemConfigPath, isWindowsPath, parentPath, pathKey, resolveGlobalConfigRoot, selectConfigTarget, shellQuote } from '@/lib/opencode/extensions/scope';
import { assertSkillId, isEditableSkillPath, skillDocument, skillFile, skillTrashPath, trashRoot } from '@/lib/opencode/extensions/skills';
import { buildExtensionRows, splitRows } from '@/lib/opencode/extensions/snapshot';
import { configBackupPath, restoreConfigBackup, writeConfigTransaction, type TransactionIo } from '@/lib/opencode/extensions/transaction';
import type {
  ConfigTarget,
  ExtensionCommandDraft,
  ExtensionCommandRow,
  ExtensionMcpRow,
  ExtensionPluginRow,
  ExtensionSafety,
  ExtensionScope,
  ExtensionScopeSnapshot,
  ExtensionSkillDraft,
  ExtensionSkillRow,
  ExtensionSnapshot,
} from '@/lib/opencode/extensions/types';
import type { McpLocalConfig, McpRemoteConfig } from '@/lib/opencode/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function txIo(ext: ReturnType<typeof createServerAdapter>['extensions']): TransactionIo {
  return {
    read: ext.readText,
    write: ext.writeText,
    shell: (root: string, command: string) => ext.runShell(root, command),
  };
}

async function shellTest(ext: ReturnType<typeof createServerAdapter>['extensions'], root: string, command: string) {
  try {
    const result = await ext.runShell(root, command);
    return result.status === 'exited' && result.exit === 0;
  } catch {
    return false;
  }
}

async function probeShell(ext: ReturnType<typeof createServerAdapter>['extensions'], root: string) {
  if (!root || isWindowsPath(root)) return false;
  return shellTest(ext, root, 'true');
}

async function buildTarget({
  ext,
  base,
  projectRoot,
  shellAvailable,
  windows,
}: {
  ext: ReturnType<typeof createServerAdapter>['extensions'];
  base: Omit<ConfigTarget, 'exists' | 'safety'> | undefined;
  projectRoot: string;
  shellAvailable: boolean;
  windows: boolean;
}): Promise<{ target?: ConfigTarget; safety: ExtensionSafety }> {
  const safety: ExtensionSafety = {
    writable: false,
    shellAvailable,
    atomicRename: shellAvailable && !windows,
    windows,
    system: false,
    symlink: false,
  };
  if (!base) return { safety: { ...safety, reason: 'No writable configuration directory was found.' } };
  if (!projectRoot) return { safety: { ...safety, reason: 'Select a project before managing extensions.' } };
  if (windows) return { safety: { ...safety, reason: 'Extension writes are not enabled on Windows servers yet.' } };
  if (!shellAvailable) return { safety: { ...safety, reason: 'The server does not expose the shell operations needed for a safe atomic write.' } };

  safety.system = isSystemConfigPath(base.path);
  if (safety.system) return { safety: { ...safety, reason: 'This is a system-managed configuration file.' } };

  const backup = configBackupPath(base.path);
  if (await shellTest(ext, projectRoot, `test -e ${shellQuote(backup)}`)) safety.backupPath = backup;
  const exists = await shellTest(ext, projectRoot, `test -e ${shellQuote(base.path)}`);
  const target: ConfigTarget = { ...base, exists, safety };

  if (await shellTest(ext, projectRoot, `test -L ${shellQuote(base.path)}`)) {
    safety.symlink = true;
    safety.reason = 'The configuration file is a symlink. Edit the link target directly instead.';
    return { target, safety };
  }
  if (exists && !(await shellTest(ext, projectRoot, `test -r ${shellQuote(base.path)}`))) {
    safety.reason = 'The configuration file is not readable by the server.';
    return { target, safety };
  }
  const writablePath = exists ? base.path : parentPath(base.path);
  if (!(await shellTest(ext, projectRoot, `test -w ${shellQuote(writablePath)}`))) {
    safety.reason = 'The configuration file is not writable by the server.';
    return { target, safety };
  }

  let text: string | undefined;
  try {
    text = await ext.readText(base.path);
  } catch {
    return { target, safety: { ...safety, reason: 'The configuration file is not readable.' } };
  }
  if (exists && text === undefined) {
    return { target, safety: { ...safety, reason: 'The configuration file is not readable.' } };
  }
  if (exists) {
    try {
      parseConfigText(text ?? '');
    } catch (error) {
      safety.reason = error instanceof Error ? error.message : 'The configuration file contains invalid JSONC.';
      return { target, safety };
    }
  }

  safety.writable = true;
  return { target, safety };
}

export type ExtensionSources = { entries: import('@/lib/opencode/extensions/types').ConfigEntry[]; plugins: import('@/lib/opencode/extensions/types').RawPluginInfo[]; skills: import('@/lib/opencode/extensions/types').RawSkillInfo[]; commands: import('@/lib/opencode/types').Command[]; mcpStatuses: Record<string, import('@/lib/opencode/types').McpStatus> };
export async function inspectExtensions(client: ScopedOpencodeClient, entries: ExtensionSources['entries']) {
  if (client.__opencode.contract !== 'v2') throw new Error('Extensions management requires OpenCode 2.');
  const ext = createServerAdapter(client).extensions;
  const projectRoot = client.__opencode.directory || '';
  const globalRoot = resolveGlobalConfigRoot(entries, projectRoot || undefined);
  const projectBase = projectRoot ? selectConfigTarget(entries, 'project', projectRoot) : undefined;
  const generalBase = globalRoot ? selectConfigTarget(entries, 'general', globalRoot) : undefined;
  const shellAvailable = await probeShell(ext, projectRoot);
  const windows = isWindowsPath(projectRoot);
  const [projectTarget, generalTarget] = await Promise.all([
    buildTarget({ ext, base: projectBase, projectRoot, shellAvailable, windows }),
    buildTarget({ ext, base: generalBase, projectRoot, shellAvailable, windows }),
  ]);

  return { generalTarget, projectTarget, globalRoot, projectRoot, loadedAt: Date.now() };
}
export function extensionSnapshot(sources: ExtensionSources, inspection: Awaited<ReturnType<typeof inspectExtensions>>): ExtensionSnapshot {
  const { entries, plugins, skills, commands, mcpStatuses } = sources;
  const { generalTarget, projectTarget, globalRoot, projectRoot, loadedAt } = inspection;
  const rows = buildExtensionRows({
    entries,
    projectRoot: projectRoot || undefined,
    globalRoot,
    mcpStatuses,
    plugins,
    skills,
    commands,
    generalWritable: generalTarget.safety.writable,
    projectWritable: projectTarget.safety.writable,
  });
  const generalRows = splitRows(rows, 'general');
  const projectRows = splitRows(rows, 'project');
  const general: ExtensionScopeSnapshot = {
    target: generalTarget.target,
    safety: generalTarget.safety,
    items: generalRows.items,
    shared: generalRows.shared,
  };
  const project: ExtensionScopeSnapshot = {
    target: projectTarget.target,
    safety: projectTarget.safety,
    items: projectRows.items,
    shared: projectRows.shared,
  };
  return { general, project, loadedAt };
}

function scopeSnapshot(snapshot: ExtensionSnapshot, scope: ExtensionScope) {
  return scope === 'general' ? snapshot.general : snapshot.project;
}

function targetFor(snapshot: ExtensionSnapshot, scope: ExtensionScope) {
  const snapshotForScope = scopeSnapshot(snapshot, scope);
  if (!snapshotForScope.target || !snapshotForScope.safety.writable) {
    throw new Error(snapshotForScope.safety.reason || 'This configuration is read-only.');
  }
  return snapshotForScope.target;
}

function findRow<T extends { source: string }>(rows: T[], source: ExtensionScope | 'runtime' | 'any', predicate: (row: T) => boolean) {
  return rows.find((row) => predicate(row) && (source === 'any' || row.source === source || (source === 'project' && row.source === 'runtime')));
}

function findAnyRow<T extends { source: string }>(snapshot: ExtensionSnapshot, scope: ExtensionScope, group: keyof ExtensionScopeSnapshot['items'], predicate: (row: T) => boolean) {
  const snapshotForScope = scopeSnapshot(snapshot, scope);
  return findRow(snapshotForScope.items[group] as unknown as T[], 'any', predicate)
    ?? findRow(snapshotForScope.shared[group] as unknown as T[], 'any', predicate);
}

async function waitForConfig(client: ScopedOpencodeClient, targetPath: string, verify?: (config: Record<string, unknown>) => boolean) {
  const ext = createServerAdapter(client).extensions;
  for (const delay of [0, 150, 300, 600, 1000, 1500, 2500]) {
    if (delay) await sleep(delay);
    const entries = await ext.configEntries();
    const document = entries.find((entry) => entry.type === 'document' && entry.path && pathKey(entry.path) === pathKey(targetPath));
    if (document?.type === 'document' && (!verify || verify(document.info as Record<string, unknown>))) return;
  }
  throw new Error('The server did not load the saved configuration file.');
}

async function rollback(client: ScopedOpencodeClient, target: ConfigTarget, backupPath?: string) {
  const ext = createServerAdapter(client).extensions;
  if (backupPath) {
    await restoreConfigBackup({ io: txIo(ext), root: target.root, target: target.path, backup: backupPath });
    return;
  }
  const result = await ext.runShell(target.root, `rm -f ${shellQuote(target.path)}`);
  if (result.status !== 'exited' || result.exit !== 0) {
    throw new Error(`The configuration could not be rolled back. Check ${target.path}.`);
  }
}

async function mutateConfig(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, mutate: (text: string) => string, verify?: (config: Record<string, unknown>) => boolean) {
  const target = targetFor(snapshot, scope);
  const ext = createServerAdapter(client).extensions;
  const current = await ext.readText(target.path);
  const next = mutate(current ?? createConfigText());
  const result = await writeConfigTransaction({ io: txIo(ext), root: target.root, target: target.path, content: next });
  try {
    await waitForConfig(client, target.path, verify);
  } catch (error) {
    await rollback(client, target, result.backupPath).catch(() => undefined);
    throw error;
  }
}

export async function addMcpServer(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) {
  const existing = findAnyRow<ExtensionMcpRow>(snapshot, scope, 'mcp', (row) => row.name === name.trim());
  if (existing) throw new Error(`MCP server "${name.trim()}" already exists in ${existing.source === 'general' ? 'General' : existing.source === 'project' ? 'this project' : 'another scope'}.`);
  await mutateConfig(client, snapshot, scope, (text) => setMcpServer(text, name.trim(), config), (next) => Boolean(readMcpServers(next)[name.trim()]));
}

export async function updateMcpServer(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) {
  await mutateConfig(client, snapshot, scope, (text) => setMcpServer(text, name.trim(), config, 'edit'), (next) => Boolean(readMcpServers(next)[name.trim()]));
}

export async function removeMcpServer(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, name: string) {
  const row = findRow(scopeSnapshot(snapshot, scope).items.mcp, scope, (item) => item.name === name);
  if (!row) throw new Error('This MCP server is shared or not defined in the selected scope.');
  if (row.removeMode === 'runtime') {
    await createServerAdapter(client).mcp.remove(name);
    return;
  }
  await mutateConfig(client, snapshot, scope, (text) => removeMcpServerText(text, name), (next) => !readMcpServers(next)[name]);
}

export async function addPlugin(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, target: string) {
  const trimmed = target.trim();
  const existing = findAnyRow<ExtensionPluginRow>(snapshot, scope, 'plugins', (row) => row.target === trimmed || row.label === trimmed);
  if (existing) throw new Error(`Plugin "${trimmed}" is already configured in ${existing.source === 'general' ? 'General' : existing.source === 'project' ? 'this project' : 'another scope'}.`);
  await mutateConfig(client, snapshot, scope, (text) => addPluginText(text, trimmed), (next) => readPlugins(next).some((entry) => pluginTarget(entry) === trimmed));
}

export async function removePlugin(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, target: string) {
  const row = findRow(scopeSnapshot(snapshot, scope).items.plugins, scope, (item) => item.target === target || item.label === target);
  if (!row?.target) throw new Error('This plugin is shared or not defined in the selected scope.');
  await mutateConfig(client, snapshot, scope, (text) => removePluginText(text, row.target!), (next) => !readPlugins(next).some((entry) => pluginTarget(entry) === row.target));
}

export async function saveCommand(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, draft: ExtensionCommandDraft, previousName?: string) {
  const existing = findAnyRow<ExtensionCommandRow>(snapshot, scope, 'commands', (item) => item.name === (previousName ?? draft.name));
  if (existing && existing.source !== scope) throw new Error('A command with this name is shared or file-based.');
  if (!existing && findAnyRow<ExtensionCommandRow>(snapshot, scope, 'commands', (item) => item.name === draft.name && item.source !== scope)) {
    throw new Error('A command with this name is already defined by a file or another scope.');
  }
  await mutateConfig(client, snapshot, scope, (text) => {
    const next = previousName && previousName !== draft.name ? removeCommandText(text, previousName) : text;
    return setCommand(next, draft);
  }, (next) => Boolean(readCommands(next)[draft.name.trim()]));
}

export async function removeCommand(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, name: string) {
  const row = findRow(scopeSnapshot(snapshot, scope).items.commands, scope, (item) => item.name === name);
  if (!row) throw new Error('This command is shared or not defined in the selected scope.');
  await mutateConfig(client, snapshot, scope, (text) => removeCommandText(text, name), (next) => !readCommands(next)[name]);
}

async function waitForSkill(client: ScopedOpencodeClient, id: string, present: boolean) {
  const ext = createServerAdapter(client).extensions;
  for (const delay of [0, 150, 300, 600, 1000, 1500, 2500]) {
    if (delay) await sleep(delay);
    const skills = await ext.skills();
    if (skills.some((skill) => skill.id === id) === present) return;
  }
  throw new Error(present ? 'The server did not load the skill.' : 'The server did not remove the skill.');
}

export async function createSkill(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, draft: ExtensionSkillDraft) {
  const target = targetFor(snapshot, scope);
  const id = assertSkillId(draft.id.trim());
  if (findAnyRow<ExtensionSkillRow>(snapshot, scope, 'skills', (skill) => skill.id === id)) {
    throw new Error('A skill with this ID already exists.');
  }
  const ext = createServerAdapter(client).extensions;
  const path = skillFile(target.root, scope, id);
  const content = skillDocument({ ...draft, id }).text;
  await ext.writeText(path, content);
  if ((await ext.readText(path)) !== content) {
    throw new Error('The skill file did not verify.');
  }
  try {
    await waitForSkill(client, id, true);
  } catch (error) {
    await ext.runShell(target.root, `rm -f ${shellQuote(path)}`).catch(() => undefined);
    throw error;
  }
}

export async function updateSkill(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, row: ExtensionSkillRow, content: string) {
  const target = targetFor(snapshot, scope);
  if (!row.path || !isEditableSkillPath(row.path, target.root, scope)) throw new Error('This skill is read-only.');
  const ext = createServerAdapter(client).extensions;
  const previous = await ext.readText(row.path);
  await ext.writeText(row.path, content);
  if ((await ext.readText(row.path)) !== content) {
    if (previous !== undefined) await ext.writeText(row.path, previous).catch(() => undefined);
    throw new Error('The skill file did not verify.');
  }
  try {
    await waitForSkill(client, row.id, true);
  } catch (error) {
    if (previous !== undefined) await ext.writeText(row.path, previous).catch(() => undefined);
    throw error;
  }
}

export async function removeSkill(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, row: ExtensionSkillRow) {
  const target = targetFor(snapshot, scope);
  if (!row.path || !isEditableSkillPath(row.path, target.root, scope)) throw new Error('This skill is read-only.');
  const ext = createServerAdapter(client).extensions;
  const source = row.path.endsWith('/SKILL.md') || row.path.endsWith('\\SKILL.md') ? parentPath(row.path) : row.path;
  if (!isInside(target.root, source)) throw new Error('The skill is outside the selected scope.');
  const destination = skillTrashPath(target.root, row.id, Date.now());
  await ext.runShell(target.root, `mkdir -p ${shellQuote(trashRoot(target.root))}`);
  const moved = await ext.runShell(target.root, `mv ${shellQuote(source)} ${shellQuote(destination)}`);
  if (moved.status !== 'exited' || moved.exit !== 0) throw new Error('The skill could not be moved to the extension trash.');
  try {
    await waitForSkill(client, row.id, false);
  } catch (error) {
    await ext.runShell(target.root, `mv ${shellQuote(destination)} ${shellQuote(source)}`).catch(() => undefined);
    throw error;
  }
}

export async function restoreConfig(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope) {
  const target = scopeSnapshot(snapshot, scope).target;
  if (!target?.safety.backupPath) throw new Error('No configuration backup is available.');
  const ext = createServerAdapter(client).extensions;
  await restoreConfigBackup({ io: txIo(ext), root: target.root, target: target.path, backup: target.safety.backupPath });
  await waitForConfig(client, target.path);
}

