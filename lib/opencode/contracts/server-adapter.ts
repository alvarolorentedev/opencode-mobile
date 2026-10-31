import type { Config, FileContent, FileDiff, McpLocalConfig, McpRemoteConfig, McpStatus, ProviderAuthValues, ProviderCatalog, Pty, Reference } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { isInside, shellQuote } from '@/lib/opencode/extensions/scope';
import type { ConfigEntry, RawPluginInfo, RawSkillInfo } from '@/lib/opencode/extensions/types';
import { ENTRY_PROBE, EntryOperationError, inspectEntry, mutateEntry, type EntryOperation } from '@/lib/opencode/project-entry-operations';
import type { ShellResult } from '@/lib/opencode/extensions/transaction';
import { projectEntries, projectWorktrees, type ProjectFileEntry, type ProjectWorktree } from '@/lib/opencode/project';
import { knownProjectFileKind, projectFileFromBytes, projectFileFromV1Content, projectFileWithoutContent, type ProjectFile } from '@/lib/opencode/project-file';
import { decodeFile, findIntegration, getProviderAuthMethods, getProviderCatalog, mcpConfigToV2, toAgentView, toConfigView } from '@/lib/opencode/v2/shared';
import { getErrorMessage } from '@/lib/error-message';
import * as v1Mcp from '@/lib/opencode/compat/v1/mcp';
import * as v1Project from '@/lib/opencode/compat/v1/project';
import { setProviderCredentials } from '@/lib/opencode/compat/v1/auth';
import * as v1Terminal from '@/lib/opencode/compat/v1/terminal';
import { loadHealth as loadLegacyHealth } from '@/lib/opencode/compat/v1/diagnostics';

type OptionalDiagnostic<T> =
  | { available: true; data: T }
  | { available: false; error: string };

export type Diagnostics = {
  health: OptionalDiagnostic<{ healthy: boolean; version: string }>;
  mcp: OptionalDiagnostic<Record<string, McpStatus>>;
};

export type ServerAdapter = {
  terminals: {
    list: () => Promise<Pty[]>;
    create: () => Promise<Pty>;
    remove: (ptyID: string) => Promise<unknown>;
    resize: (ptyID: string, size: { cols: number; rows: number }) => Promise<unknown>;
    connectToken: (ptyID: string) => Promise<{ ticket?: string }>;
  };
  mcp: {
    status: () => Promise<Record<string, McpStatus>>;
    add: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<unknown>;
    remove: (name: string) => Promise<unknown>;
    connect: (name: string) => Promise<unknown>;
    disconnect: (name: string) => Promise<unknown>;
    startOAuth: (name: string) => Promise<{ authorizationUrl: string; instructions?: string; method?: 'auto' | 'code' }>;
    completeOAuth: (name: string, code: string) => Promise<unknown>;
  };
  diagnostics: {
    health: () => Promise<Diagnostics['health']>;
  };
  capabilities: {
    configuration: () => Promise<{ config: Config; entries?: ConfigEntry[] }>;
    discovery: () => Promise<{ providers: ProviderCatalog; auth: unknown }>;
    skillDetails: () => Promise<RawSkillInfo[]>;
    providers: () => Promise<ProviderCatalog>;
    agents: () => Promise<unknown>;
    references: () => Promise<Reference[]>;
    modelVariants: (model: { variants?: { id: string }[] }) => { id: string }[];
    setCredentials: (id: string, values: ProviderAuthValues) => Promise<unknown>;
    removeCredentials: (id: string) => Promise<unknown>;
    startAuthorization: (id: string, method: number, values?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    completeAuthorization: (id: string, method: number, code: string) => Promise<unknown>;
  };
  extensions: {
    configEntries: () => Promise<ConfigEntry[]>;
    plugins: () => Promise<RawPluginInfo[]>;
    skills: () => Promise<RawSkillInfo[]>;
    readText: (path: string) => Promise<string | undefined>;
    writeText: (path: string, content: string) => Promise<void>;
    runShell: (root: string, command: string) => Promise<ShellResult>;
  };
  projects: {
    entryOperations: {
      probe: () => Promise<boolean>;
      inspect: (operation: EntryOperation) => Promise<string>;
      mutate: (operation: EntryOperation, expected: string) => Promise<void>;
    };
    findFiles: (query: string, includeDirectories?: boolean) => Promise<string[]>;
    listFiles: (path: string) => Promise<ProjectFileEntry[]>;
    readFile: (path: string) => Promise<FileContent>;
    readProjectFile: (path: string) => Promise<ProjectFile>;
    downloadSource: (path: string) => Promise<{ kind: 'content'; content: FileContent } | { kind: 'url' }>;
    fileStatus: () => Promise<{ path: string; added: number; removed: number; status: 'added' | 'deleted' | 'modified' }[]>;
    vcsInfo: () => Promise<{ branch?: string }>;
    vcsDiff: (mode: 'git' | 'branch', context?: number) => Promise<FileDiff[]>;
    saveFile: (path: string, content: string, patch: string) => Promise<unknown>;
    listWorktrees: (knownProjectId?: string) => Promise<ProjectWorktree[]>;
    createWorktree: (name?: string) => Promise<ProjectWorktree>;
    removeWorktree: (directory: string) => Promise<unknown>;
  };
};

async function optionalDiagnostic<T>(load: () => Promise<T>): Promise<OptionalDiagnostic<T>> {
  try {
    return { available: true, data: await load() };
  } catch (error) {
    return { available: false, error: getErrorMessage(error) };
  }
}

export function createServerAdapter(client: ScopedOpencodeClient): ServerAdapter {
  const location = { location: { directory: client.__opencode.directory } };
  const compatibility = client.compatibility;

  const mcp = {
    status: async (): Promise<Record<string, McpStatus>> => {
      if (compatibility) return v1Mcp.getMcpStatus(compatibility);
      return Object.fromEntries((await client.api!.mcp.list(location)).data.map((server) => [server.name, {
        ...server.status,
        ...(server.integrationID ? { integrationID: server.integrationID } : {}),
      }]));
    },
    add: async (name: string, config: McpLocalConfig | McpRemoteConfig) => {
      if (compatibility) return v1Mcp.addMcpServer(compatibility, name, config);
      await client.api!.mcp.add({ ...location, server: name, config: mcpConfigToV2(config) });
    },
    remove: (name: string) => {
      if (compatibility) throw new Error('MCP runtime removal requires OpenCode 2.');
      return client.api!.mcp.remove({ ...location, server: name });
    },
    connect: (name: string) => compatibility
      ? v1Mcp.connectMcpServer(compatibility, name)
      : client.api!.mcp.connect({ ...location, server: name }),
    disconnect: (name: string) => compatibility
      ? v1Mcp.disconnectMcpServer(compatibility, name)
      : client.api!.mcp.disconnect({ ...location, server: name }),
    startOAuth: (name: string) => {
      if (!compatibility) throw new Error('MCP OAuth is unavailable.');
      return v1Mcp.startMcpOAuth(compatibility, name) as Promise<{ authorizationUrl: string; instructions?: string; method?: 'auto' | 'code' }>;
    },
    completeOAuth: (name: string, code: string) => {
      if (!compatibility) throw new Error('MCP OAuth is unavailable.');
      return v1Mcp.completeMcpOAuth(compatibility, name, code);
    },
  };

  const projectID = async () => (await client.api!.location.get(location)).project.id;
  const requireData = <T,>(value: T | undefined, label: string): T => {
    if (value === undefined) throw new Error(`OpenCode returned no ${label}.`);
    return value;
  };
  const projectDirectory = client.__opencode.directory || '';
  const extensionAdapter = {
    configEntries: async () => {
      if (compatibility) throw new Error('Extensions management requires OpenCode 2.');
      return (await client.api!.config.get(location)) as ConfigEntry[];
    },
    plugins: async () => {
      if (compatibility) throw new Error('Extensions management requires OpenCode 2.');
      return (await client.api!.plugin.list(location)).data as RawPluginInfo[];
    },
    skills: async () => {
      if (compatibility) throw new Error('Extensions management requires OpenCode 2.');
      return (await client.api!.skill.list(location)).data as RawSkillInfo[];
    },
    readText: async (path: string) => {
      if (compatibility) throw new Error('Extensions management requires OpenCode 2.');
      if (isInside(projectDirectory, path)) {
        try {
          const result = await client.api!.file.read({ ...location, path });
          const file = decodeFile(result);
          if (file.type !== 'text') throw new Error('The configuration file is not text.');
          return file.content;
        } catch (error) {
          if (isNotFoundError(error)) return undefined;
          throw error;
        }
      }
      const result = await runShellCommand(client, location, projectDirectory, `cat ${shellQuote(path)}`);
      if (result.status !== 'exited') throw new Error('The server shell did not finish reading the configuration.');
      if (result.exit === 0) return result.output;
      if (result.exit === 1) return undefined;
      throw new Error('The server could not read the configuration file.');
    },
    writeText: async (path: string, content: string) => {
      if (compatibility) throw new Error('Extensions management requires OpenCode 2.');
      await client.api!.file.write({ ...location, path, payload: new TextEncoder().encode(content) });
    },
    runShell: (root: string, command: string) => runShellCommand(client, location, root, command),
  };

  return {
    terminals: {
      list: () => compatibility ? v1Terminal.listTerminals(compatibility) : client.api!.pty.list(location).then((result) => result.data),
      create: () => compatibility ? v1Terminal.createTerminal(compatibility, client.__opencode.directory) : client.api!.pty.create(location).then((result) => result.data),
      remove: (ptyID: string) => compatibility ? v1Terminal.removeTerminal(compatibility, ptyID) : client.api!.pty.remove({ ...location, ptyID }),
      resize: (ptyID: string, size: { cols: number; rows: number }) => compatibility
        ? v1Terminal.resizeTerminal(compatibility, ptyID, size)
        : client.api!.pty.update({ ...location, ptyID, size }),
      connectToken: (ptyID: string) => compatibility
        ? v1Terminal.createTerminalConnectToken(compatibility, ptyID)
        : client.api!.pty.connect.token({ ...location, ptyID }, { headers: { 'x-opencode-ticket': '1' } }).then((result) => result.data as { ticket?: string }),
    },
    mcp,
    extensions: extensionAdapter,
    capabilities: {
      configuration: async () => {
        if (compatibility) return { config: requireData((await compatibility.config.get()).data, 'config') };
        const entries = await extensionAdapter.configEntries();
        return { config: toConfigView(entries), entries };
      },
      discovery: async () => {
        if (compatibility) {
          const catalog = requireData((await compatibility.provider.list()).data, 'provider catalog');
          return { providers: { ...catalog, all: catalog.all.map((provider) => ({ ...provider, models: Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, { ...model, variants: [] }])) })) }, auth: (await compatibility.provider.auth()).data };
        }
        const [providers, integrations] = await Promise.all([client.api!.provider.list(location), client.api!.integration.list(location)]);
        const discovery = { providers, integrations };
        const [catalog, auth] = await Promise.all([getProviderCatalog(client.api!, location, discovery), getProviderAuthMethods(client.api!, location, discovery)]);
        return { providers: catalog, auth };
      },
      skillDetails: () => compatibility ? Promise.resolve([]) : extensionAdapter.skills(),
      providers: async () => {
        if (!compatibility) return getProviderCatalog(client.api!, location);
        const catalog = requireData((await compatibility.provider.list()).data, 'provider catalog');
        return {
          ...catalog,
          all: catalog.all.map((provider) => ({
            ...provider,
            models: Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, { ...model, variants: [] }])),
          })),
        };
      },
      agents: () => compatibility
        ? client.compatibility!.app.agents().then((result) => result.data)
        : client.api!.agent.list(location).then((result) => result.data.map(toAgentView)),
      // Composer context stays V2-only.
      references: () => compatibility
        ? Promise.resolve([])
        : client.api!.reference.list(location).then((result) => result.data.map((reference) => ({
            name: reference.name,
            path: reference.path,
            description: reference.description,
          }))),
      modelVariants: (model: { variants?: { id: string }[] }) => compatibility ? [] : model.variants ?? [],
      setCredentials: async (id: string, values: ProviderAuthValues) => {
        if (compatibility) return setProviderCredentials(compatibility, id, values);
        await client.accounts!.add(id, values);
      },
      removeCredentials: async (id: string) => {
        if (compatibility) return compatibility.auth.remove({ providerID: id });
        let integration = await findIntegration(client.api!, id, location, true);
        if (!integration?.connections.some((item) => item.type === 'credential')) integration = await findIntegration(client.api!, id, location);
        await Promise.all((integration?.connections ?? [])
          .filter((item) => item.type === 'credential')
          .map((item) => client.api!.credential.remove({ credentialID: item.id })));
      },
      startAuthorization: async (id: string, method: number, values?: ProviderAuthValues) => {
        if (client.providerOAuth) return client.providerOAuth.start(id, method, values);
        const auth = requireData((await compatibility!.provider.oauth.authorize({ providerID: id, method, inputs: values as Record<string, string> })).data, 'OAuth authorization');
        return { url: auth.url, instructions: auth.instructions, method: auth.method } as { url: string; instructions?: string; method: 'auto' | 'code' };
      },
      completeAuthorization: async (id: string, method: number, code: string) => {
        if (client.providerOAuth) return client.providerOAuth.complete(id, code);
        await compatibility!.provider.oauth.callback({ providerID: id, method, code });
      },
    },
    projects: {
      entryOperations: {
        probe: async () => {
          if (compatibility || !projectDirectory.startsWith('/')) return false;
          const result = await runShellCommand(client, location, projectDirectory, ENTRY_PROBE);
          return result.status === 'exited' && result.exit === 0;
        },
        inspect: (operation) => {
          if (compatibility) throw new EntryOperationError('unsupported');
          return inspectEntry((root, command) => runShellCommand(client, location, root, command), operation);
        },
        mutate: (operation, expected) => {
          if (compatibility) throw new EntryOperationError('unsupported');
          return mutateEntry((root, command) => runShellCommand(client, location, root, command), operation, expected);
        },
      },
      findFiles: async (query: string, includeDirectories = false) => {
        if (compatibility) return v1Project.findFiles(compatibility, query, includeDirectories);
        return (await client.api!.file.find({ ...location, query, limit: 100, ...(includeDirectories ? {} : { type: 'file' }) })).data.map((entry) => entry.path);
      },
      listFiles: async (path: string) => {
        const data = compatibility
          ? (await compatibility.file.list({ path })).data
          : (await client.api!.file.list({ ...location, path })).data;
        return projectEntries(data ?? [], client.__opencode.directory || '');
      },
      readFile: (path: string) => compatibility
        ? v1Project.readFile(compatibility, path)
        : client.api!.file.read({ ...location, path }).then((result) => decodeFile(result)),
      downloadSource: (path: string) => compatibility
        ? v1Project.readFile(compatibility, path).then((content) => ({ kind: 'content' as const, content }))
        : Promise.resolve({ kind: 'url' as const }),
      readProjectFile: async (path: string) => {
        if (knownProjectFileKind(path) === 'document') {
          return projectFileWithoutContent(path, client.__opencode.contract === 'v2');
        }
        if (compatibility) return projectFileFromV1Content(path, await v1Project.readFile(compatibility, path));
        return projectFileFromBytes(path, await client.api!.file.read({ ...location, path }));
      },
      fileStatus: async () => compatibility
        ? v1Project.getFileStatus(compatibility)
        : (await client.api!.vcs.status(location)).data.map((status) => ({ path: status.file, added: status.additions, removed: status.deletions, status: status.status as 'added' | 'deleted' | 'modified' })),
      vcsInfo: async () => {
        if (compatibility) return v1Project.getVcsInfo(compatibility);
        const { data } = await client.api!.vcs.get(location);
        return { branch: data.branch?.current };
      },
      vcsDiff: (mode: 'git' | 'branch', context?: number) => compatibility
        ? v1Project.getVcsDiff(compatibility, mode, context)
        : client.api!.vcs.diff({ ...location, mode: mode === 'git' ? 'working' : 'branch', ...(context !== undefined ? { context } : {}) }).then((result) => result.data),
      saveFile: async (path: string, content: string, patch: string) => {
        if (compatibility) return v1Project.applyVcsPatch(compatibility, patch);
        await client.api!.file.write({ ...location, path, payload: new TextEncoder().encode(content) });
      },
      listWorktrees: async (knownProjectId?: string) => compatibility
        ? v1Project.listWorktrees(compatibility)
        : projectWorktrees(await client.api!.worktree.list({ projectID: knownProjectId ?? await projectID() })),
      createWorktree: async (name?: string) => {
        const created = compatibility
          ? await v1Project.createWorktree(compatibility, name)
          : await projectID().then((projectID) => client.api!.worktree.create({ projectID, ...(name ? { name } : {}) }));
        return projectWorktrees([created as { directory: string }])[0];
      },
      removeWorktree: (directory: string) => compatibility
        ? v1Project.removeWorktree(compatibility, directory)
        : projectID().then((projectID) => client.api!.worktree.remove({ projectID, directory, force: true })),
    },
    diagnostics: {
      health: () => compatibility ? loadLegacyHealth(compatibility) : optionalDiagnostic(async () => ({ healthy: true, version: (await client.api!.server.info()).version })),

    },
  };
}

function isNotFoundError(error: unknown) {
  const record = error && typeof error === 'object' ? error as { status?: number; message?: string } : {};
  return record.status === 404 || Boolean(record.message && /\b404\b/.test(record.message));
}

async function runShellCommand(
  client: ScopedOpencodeClient,
  location: { location: { directory?: string } },
  root: string,
  command: string,
): Promise<ShellResult> {
  const created = await client.api!.shell.create({ ...location, command, cwd: root, timeout: 15000 });
  const id = created.data.id;
  let info = created.data;
  try {
    for (let attempt = 0; attempt < 200 && info.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      info = (await client.api!.shell.get({ ...location, id })).data;
    }
    const output = (await client.api!.shell.output({ ...location, id, cursor: 0, limit: 2_000_000 })).data;
    if (output.truncated) throw new Error('The shell output was too large to read safely.');
    return { output: output.output, exit: info.exit, status: info.status };
  } finally {
    await client.api!.shell.remove({ ...location, id }).catch(() => undefined);
  }
}
