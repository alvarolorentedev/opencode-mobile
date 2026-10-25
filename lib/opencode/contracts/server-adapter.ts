import type { Config, FileContent, FileDiff, McpLocalConfig, McpRemoteConfig, McpStatus, ProviderAuthValues, ProviderCatalog, Pty } from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';
import { projectEntries, projectWorktrees, type ProjectFileEntry, type ProjectWorktree } from '@/lib/opencode/project';
import { knownProjectFileKind, projectFileFromBytes, projectFileFromV1Content, projectFileWithoutContent, type ProjectFile } from '@/lib/opencode/project-file';
import { decodeFile, findIntegration, getProviderAuthMethods, getProviderCatalog, mcpConfigToV2, toAgentView, toConfigView } from '@/lib/opencode/v2/shared';
import { getErrorMessage } from '@/lib/error-message';
import * as v1Mcp from '@/lib/opencode/compat/v1/mcp';
import * as v1Project from '@/lib/opencode/compat/v1/project';
import { setProviderCredentials } from '@/lib/opencode/compat/v1/auth';
import * as v1Terminal from '@/lib/opencode/compat/v1/terminal';
import { loadDiagnostics as loadLegacyDiagnostics } from '@/lib/opencode/compat/v1/diagnostics';

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
    connect: (name: string) => Promise<unknown>;
    disconnect: (name: string) => Promise<unknown>;
    startOAuth: (name: string) => Promise<{ authorizationUrl: string; instructions?: string; method?: 'auto' | 'code' }>;
    completeOAuth: (name: string, code: string) => Promise<unknown>;
  };
  diagnostics: {
    load: () => Promise<Diagnostics>;
  };
  capabilities: {
    config: () => Promise<Config>;
    providers: () => Promise<ProviderCatalog>;
    providerAuth: () => Promise<unknown>;
    agents: () => Promise<unknown>;
    modelVariants: (model: { variants?: { id: string }[] }) => { id: string }[];
    setCredentials: (id: string, values: ProviderAuthValues) => Promise<unknown>;
    removeCredentials: (id: string) => Promise<unknown>;
    startAuthorization: (id: string, method: number, values?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    completeAuthorization: (id: string, method: number, code: string) => Promise<unknown>;
  };
  projects: {
    findFiles: (query: string, includeDirectories?: boolean) => Promise<string[]>;
    listFiles: (path: string) => Promise<ProjectFileEntry[]>;
    readFile: (path: string) => Promise<FileContent>;
    readProjectFile: (path: string) => Promise<ProjectFile>;
    downloadSource: (path: string) => Promise<{ kind: 'content'; content: FileContent } | { kind: 'url' }>;
    fileStatus: () => Promise<{ path: string; added: number; removed: number; status: 'added' | 'deleted' | 'modified' }[]>;
    vcsInfo: () => Promise<{ branch?: string }>;
    vcsDiff: (mode: 'git' | 'branch', context?: number) => Promise<FileDiff[]>;
    saveFile: (path: string, content: string, patch: string) => Promise<unknown>;
    listWorktrees: () => Promise<ProjectWorktree[]>;
    createWorktree: (name?: string) => Promise<unknown>;
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
    capabilities: {
      config: () => compatibility
        ? client.compatibility!.config.get().then((result) => requireData(result.data, 'config'))
        : client.api!.config.get(location).then((result) => toConfigView(result)),
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
      providerAuth: () => compatibility
        ? client.compatibility!.provider.auth().then((result) => result.data)
        : getProviderAuthMethods(client.api!, location),
      agents: () => compatibility
        ? client.compatibility!.app.agents().then((result) => result.data)
        : client.api!.agent.list(location).then((result) => result.data.map(toAgentView)),
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
      listWorktrees: async () => compatibility
        ? v1Project.listWorktrees(compatibility)
        : projectWorktrees(await client.api!.worktree.list({ projectID: await projectID() })),
      createWorktree: (name?: string) => compatibility
        ? v1Project.createWorktree(compatibility, name)
        : projectID().then((projectID) => client.api!.worktree.create({ projectID, ...(name ? { name } : {}) })),
      removeWorktree: (directory: string) => compatibility
        ? v1Project.removeWorktree(compatibility, directory)
        : projectID().then((projectID) => client.api!.worktree.remove({ projectID, directory, force: true })),
    },
    diagnostics: {
      load: async () => {
        if (compatibility) return loadLegacyDiagnostics(compatibility);
        const [health, mcpStatus] = await Promise.all([
          optionalDiagnostic(async () => ({ healthy: true, version: (await client.api!.server.info()).version })),
          optionalDiagnostic<Record<string, McpStatus>>(() => mcp.status()),
        ]);
        return { health, mcp: mcpStatus };
      },
    },
  };
}
