import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { createServerAdapter } from '@/shared/protocol/opencode/contracts/server-adapter';
import { readAgents, readCommands, removeAgent as removeAgentText, removeCommand as removeCommandText, setAgent as setAgentText, setCommand } from '@/shared/protocol/opencode/extensions/jsonc';
import { shellQuote } from '@/shared/protocol/opencode/extensions/scope';
import { buildAgentMarkdown, buildCommandMarkdown, markdownFile, markdownRoots, parseAgentMarkdown, parseCommandMarkdown, updateAgentMarkdown, updateCommandMarkdown } from '@/shared/protocol/opencode/extensions/markdown';
import { restoreConfigBackup } from '@/shared/protocol/opencode/extensions/transaction';
import { mutateConfig, scopeSnapshot } from '@/features/extensions/services/extensions-service';
import { restoreTrash, trashMarkdownFile, writeMarkdownFile } from '@/features/extensions/services/markdown-files';
import type { ExtensionAgentDraft, ExtensionAgentRow, ExtensionCommandDraft, ExtensionCommandRow, ExtensionScope, ExtensionSnapshot } from '@/shared/protocol/opencode/extensions/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function txIo(ext: ReturnType<typeof createServerAdapter>['extensions']) {
  return {
    read: ext.readText,
    write: ext.writeText,
    shell: (root: string, command: string) => ext.runShell(root, command),
  };
}

function scopedRows<T extends { key: string }>(snapshot: ExtensionSnapshot, scope: ExtensionScope, group: 'commands' | 'agents') {
  const current = scopeSnapshot(snapshot, scope);
  return [...current.items[group], ...current.shared[group]] as unknown as T[];
}

function assertNameAvailable(snapshot: ExtensionSnapshot, scope: ExtensionScope, group: 'commands' | 'agents', name: string, excludeKey?: string, existingName?: string) {
  const match = scopedRows<{ key: string; name?: string; id?: string }>(snapshot, scope, group)
    .find((row) => row.key !== excludeKey && row.name !== existingName && row.id !== existingName && (row.name === name || row.id === name));
  if (match) throw new Error(group === 'commands'
    ? `A command named "${name}" already exists in this or another scope.`
    : `An agent named "${name}" already exists in this or another scope.`);
}

function commandRoot(snapshot: ExtensionSnapshot, scope: ExtensionScope) {
  const target = scopeSnapshot(snapshot, scope).markdown.commands;
  if (!target.safety.writable) throw new Error(target.safety.reason || 'Markdown commands are read-only.');
  return target;
}

function agentRoot(snapshot: ExtensionSnapshot, scope: ExtensionScope) {
  const target = scopeSnapshot(snapshot, scope).markdown.agents;
  if (!target.safety.writable) throw new Error(target.safety.reason || 'Markdown agents are read-only.');
  return target;
}

function editableRoot(scopeRoot: string, scope: ExtensionScope, kind: 'agents' | 'commands', path: string | undefined, fallback: string) {
  if (!path) return fallback;
  return markdownRoots(scopeRoot, scope, kind).find((entry) => path === entry.root || path.startsWith(`${entry.root}/`))?.root ?? fallback;
}

async function removeFile(client: ScopedOpencodeClient, root: string, path: string) {
  const result = await createServerAdapter(client).extensions.runShell(root, `rm -f ${shellQuote(path)}`).catch(() => undefined);
  if (result && (result.status !== 'exited' || result.exit !== 0)) throw new Error('The new Markdown file could not be removed.');
}

async function waitForCommand(client: ScopedOpencodeClient, name: string, present: boolean, description?: string) {
  const ext = createServerAdapter(client).extensions;
  for (const delay of [0, 150, 300, 600, 1000, 1500, 2500]) {
    if (delay) await sleep(delay);
    const commands = await ext.commands();
    const command = commands.find((item) => item.name === name);
    if (!present) {
      if (!command) return;
      continue;
    }
    if (command && (description === undefined || command.description === description)) return;
  }
  throw new Error(present ? 'The server did not load the command.' : 'The server did not remove the command.');
}

async function waitForAgent(client: ScopedOpencodeClient, id: string, present: boolean, expected?: { system?: string; description?: string; mode?: string; model?: string }) {
  const ext = createServerAdapter(client).extensions;
  for (const delay of [0, 150, 300, 600, 1000, 1500, 2500]) {
    if (delay) await sleep(delay);
    const agents = await ext.agents();
    const agent = agents.find((item) => item.id === id);
    if (!present) {
      if (!agent) return;
      continue;
    }
    if (!agent) continue;
    if (expected?.system !== undefined && agent.system !== expected.system) continue;
    if (expected?.description !== undefined && agent.description !== expected.description) continue;
    if (expected?.mode !== undefined && agent.mode !== expected.mode) continue;
    if (expected?.model !== undefined) {
      const model = agent.model ? `${agent.model.providerID}/${agent.model.id}${agent.model.variant ? `#${agent.model.variant}` : ''}` : undefined;
      if (model !== expected.model) continue;
    }
    return;
  }
  throw new Error(present ? 'The server did not load the agent.' : 'The server did not remove the agent.');
}

function remainingCommand(snapshot: ExtensionSnapshot, scope: ExtensionScope, name: string, excludeKey: string) {
  const rows = scopedRows<{ key: string; name?: string; description?: string }>(snapshot, scope, 'commands')
    .filter((row) => row.key !== excludeKey && row.name === name);
  return { present: rows.length > 0, description: rows.length === 1 ? rows[0].description : undefined };
}

function remainingAgent(snapshot: ExtensionSnapshot, scope: ExtensionScope, id: string, excludeKey: string) {
  return scopedRows<{ key: string; id?: string }>(snapshot, scope, 'agents')
    .filter((row) => row.key !== excludeKey && row.id === id);
}

export async function saveCommand(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, draft: ExtensionCommandDraft, previousRow?: ExtensionCommandRow) {
  const previous = previousRow ? scopeSnapshot(snapshot, scope).items.commands.find((row) => row.key === previousRow.key) : undefined;
  if (previousRow && !previous) throw new Error('This command is shared or not defined in the selected scope.');
  assertNameAvailable(snapshot, scope, 'commands', draft.name.trim(), previous?.key, previous?.name);
  const format = previous?.origin === 'config' ? 'jsonc' : previous?.origin === 'file' ? 'markdown' : draft.format ?? 'markdown';
  if (format === 'jsonc') {
    await mutateConfig(client, snapshot, scope, (text) => {
      const next = previous && previous.name !== draft.name ? removeCommandText(text, previous.name) : text;
      return setCommand(next, draft);
    }, (next) => Boolean(readCommands(next)[draft.name.trim()]), async () => {
      await waitForCommand(client, draft.name.trim(), true, draft.description?.trim() || undefined);
    });
    return;
  }
  const ext = createServerAdapter(client).extensions;
  const markdown = commandRoot(snapshot, scope);
  const root = markdown.root;
  const name = draft.name.trim();
  const path = previous && previous.path && previous.name === name ? previous.path : markdownFile(markdown.scopeRoot, scope, 'commands', name);
  const validate = (content: string) => {
    const parsed = parseCommandMarkdown(content);
    if (parsed.error) throw new Error(parsed.error);
  };
  if (!previous) {
    const content = buildCommandMarkdown(draft);
    await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root, path, content, expected: null, validate });
    try {
      await waitForCommand(client, name, true, draft.description?.trim() || undefined);
    } catch (error) {
      await removeFile(client, root, path).catch(() => undefined);
      throw error;
    }
    return;
  }
  if (!previous.path || previous.content === undefined) throw new Error('This command file is no longer available.');
  const content = updateCommandMarkdown(previous.content, draft);
  const writeRoot = editableRoot(markdown.scopeRoot, scope, 'commands', previous.path, markdown.root);
  if (previous.path === path) {
    const result = await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: writeRoot, path, content, expected: previous.content, validate });
    try {
      await waitForCommand(client, name, true, draft.description?.trim() || undefined);
    } catch (error) {
      if (result.backupPath) await restoreConfigBackup({ io: txIo(ext), root: markdown.scopeRoot, target: path, backup: result.backupPath }).catch(() => undefined);
      throw error;
    }
    return;
  }
  await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root, path, content, expected: null, validate });
  let destination: string | undefined;
  try {
    await waitForCommand(client, name, true, draft.description?.trim() || undefined);
    destination = await trashMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: markdown.scopeRoot, path: previous.path, kind: 'commands', name: previous.name });
    const remaining = remainingCommand(snapshot, scope, previous.name, previous.key);
    if (remaining.present) await waitForCommand(client, previous.name, true, remaining.description);
    else await waitForCommand(client, previous.name, false);
  } catch (error) {
    if (destination) await restoreTrash(ext, markdown.scopeRoot, destination, previous.path).catch(() => undefined);
    await removeFile(client, root, path).catch(() => undefined);
    throw error;
  }
}

export async function removeCommand(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, target: ExtensionCommandRow) {
  const row = scopeSnapshot(snapshot, scope).items.commands.find((item) => item.key === target.key);
  if (!row) throw new Error('This command is shared or not defined in the selected scope.');
  const name = row.name;
  if (row.origin === 'config') {
    await mutateConfig(client, snapshot, scope, (text) => removeCommandText(text, name), (next) => !readCommands(next)[name], async () => {
      const remaining = remainingCommand(snapshot, scope, name, row.key);
      if (remaining.present) await waitForCommand(client, name, true, remaining.description);
      else await waitForCommand(client, name, false);
    });
    return;
  }
  if (row.origin !== 'file' || !row.path) throw new Error('This command is read-only.');
  const ext = createServerAdapter(client).extensions;
  const markdown = commandRoot(snapshot, scope);
  const current = await ext.readText(row.path);
  if (current !== row.content) throw new Error('The command changed on the server. Refresh before removing it.');
  const destination = await trashMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: markdown.scopeRoot, path: row.path, kind: 'commands', name: row.name });
  try {
    const remaining = remainingCommand(snapshot, scope, name, row.key);
    if (remaining.present) await waitForCommand(client, name, true, remaining.description);
    else await waitForCommand(client, name, false);
  } catch (error) {
    await restoreTrash(ext, markdown.scopeRoot, destination, row.path).catch(() => undefined);
    throw error;
  }
}

export async function saveAgent(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, draft: ExtensionAgentDraft, previousRow?: ExtensionAgentRow) {
  const previous = previousRow ? scopeSnapshot(snapshot, scope).items.agents.find((row) => row.key === previousRow.key) : undefined;
  if (previousRow && !previous) throw new Error('This agent is shared or not defined in the selected scope.');
  assertNameAvailable(snapshot, scope, 'agents', draft.id.trim(), previous?.key, previous?.id);
  const format = previous?.origin === 'config' ? 'jsonc' : previous?.origin === 'file' ? 'markdown' : draft.format ?? 'markdown';
  if (format === 'jsonc') {
    await mutateConfig(client, snapshot, scope, (text) => {
      const next = previous && previous.id !== draft.id ? removeAgentText(text, previous.id) : text;
      return setAgentText(next, draft);
    }, (next) => Boolean(readAgents(next)[draft.id.trim()]), async () => {
      await waitForAgent(client, draft.id.trim(), true, { system: draft.instructions.trim(), description: draft.description?.trim() || undefined, mode: draft.mode, model: draft.model?.trim() || undefined });
    });
    return;
  }
  const ext = createServerAdapter(client).extensions;
  const markdown = agentRoot(snapshot, scope);
  const root = markdown.root;
  const id = draft.id.trim();
  const path = previous && previous.path && previous.id === id ? previous.path : markdownFile(markdown.scopeRoot, scope, 'agents', id);
  const validate = (content: string) => {
    const parsed = parseAgentMarkdown(content);
    if (parsed.error) throw new Error(parsed.error);
  };
  if (!previous) {
    const content = buildAgentMarkdown(draft);
    await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root, path, content, expected: null, validate });
    try {
      await waitForAgent(client, id, true, { system: draft.instructions.trim(), description: draft.description?.trim() || undefined, mode: draft.mode, model: draft.model?.trim() || undefined });
    } catch (error) {
      await removeFile(client, root, path).catch(() => undefined);
      throw error;
    }
    return;
  }
  if (!previous.path || previous.content === undefined) throw new Error('This agent file is no longer available.');
  const content = updateAgentMarkdown(previous.content, draft);
  const writeRoot = editableRoot(markdown.scopeRoot, scope, 'agents', previous.path, markdown.root);
  if (previous.path === path) {
    const result = await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: writeRoot, path, content, expected: previous.content, validate });
    try {
      await waitForAgent(client, id, true, { system: draft.instructions.trim(), description: draft.description?.trim() || undefined, mode: draft.mode, model: draft.model?.trim() || undefined });
    } catch (error) {
      if (result.backupPath) await restoreConfigBackup({ io: txIo(ext), root: markdown.scopeRoot, target: path, backup: result.backupPath }).catch(() => undefined);
      throw error;
    }
    return;
  }
  await writeMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root, path, content, expected: null, validate });
  let destination: string | undefined;
  try {
    await waitForAgent(client, id, true, { system: draft.instructions.trim(), description: draft.description?.trim() || undefined, mode: draft.mode, model: draft.model?.trim() || undefined });
    destination = await trashMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: markdown.scopeRoot, path: previous.path, kind: 'agents', name: previous.id });
    const remaining = remainingAgent(snapshot, scope, previous.id, previous.key);
    if (remaining.length > 0) {
      const fallback = remaining[0] as { origin?: string; description?: string; instructions?: string; mode?: string; model?: string };
      await waitForAgent(client, previous.id, true, { system: fallback.instructions, description: fallback.description, mode: fallback.mode, model: fallback.model });
    } else {
      await waitForAgent(client, previous.id, false);
    }
  } catch (error) {
    if (destination) await restoreTrash(ext, markdown.scopeRoot, destination, previous.path).catch(() => undefined);
    await removeFile(client, root, path).catch(() => undefined);
    throw error;
  }
}

export async function removeAgent(client: ScopedOpencodeClient, snapshot: ExtensionSnapshot, scope: ExtensionScope, row: ExtensionAgentRow) {
  const found = scopeSnapshot(snapshot, scope).items.agents.find((item) => item.key === row.key);
  if (!found) throw new Error('This agent is shared or not defined in the selected scope.');
  if (found.origin === 'config') {
    await mutateConfig(client, snapshot, scope, (text) => removeAgentText(text, row.id), (next) => !readAgents(next)[row.id], async () => {
      const remaining = remainingAgent(snapshot, scope, row.id, found.key);
      if (remaining.length === 0) await waitForAgent(client, row.id, false);
    });
    return;
  }
  if (found.origin !== 'file' || !found.path) throw new Error('This agent is read-only.');
  const ext = createServerAdapter(client).extensions;
  const markdown = agentRoot(snapshot, scope);
  const current = await ext.readText(found.path);
  if (current !== found.content) throw new Error('The agent changed on the server. Refresh before removing it.');
  const destination = await trashMarkdownFile({ ext, projectRoot: markdown.scopeRoot, root: markdown.scopeRoot, path: found.path, kind: 'agents', name: found.id });
  try {
    const remaining = remainingAgent(snapshot, scope, row.id, found.key);
    if (remaining.length === 0) await waitForAgent(client, row.id, false);
  } catch (error) {
    await restoreTrash(ext, markdown.scopeRoot, destination, found.path).catch(() => undefined);
    throw error;
  }
}
