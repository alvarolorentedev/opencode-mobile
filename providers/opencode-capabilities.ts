import type { ServerContract } from '@/lib/opencode/client';
import type { Config } from '@/lib/opencode/types';

// Which server-owned surfaces the connected contract exposes, plus the
// permission policy that backs the auto-approve toggle.

export type ServerCapabilities = {
  contract: ServerContract;
  share: boolean;
  archive: boolean;
  todos: boolean;
  summarize: boolean;
  fileSave: boolean;
  fileStatus: boolean;
  lsp: boolean;
  formatter: boolean;
  mcpOAuth: boolean;
  configWrite: boolean;
  worktreeReset: boolean;
  savedPermissions: boolean;
};

export function getServerCapabilities(contract: ServerContract): ServerCapabilities {
  const full = contract === 'v1';
  return {
    contract,
    share: full,
    archive: full,
    // V2 has no server-owned todo endpoint, but the plan is derived from the
    // transcript's `todowrite` tool parts, so the surface is available on both.
    todos: true,
    summarize: full,
    fileSave: true,
    fileStatus: true,
    lsp: full,
    formatter: full,
    mcpOAuth: true,
    configWrite: full,
    worktreeReset: full,
    // Server-persisted "always allow" rules are a V2 surface.
    savedPermissions: !full,
  };
}

export function isAutoApproveEnabled(config?: Config) {
  if (config?.permission === 'allow') {
    return true;
  }
  if (!config?.permission || typeof config.permission !== 'object') {
    return false;
  }

  const { bash, doom_loop, edit, external_directory, webfetch } = config.permission;
  return edit === 'allow' && bash === 'allow' && webfetch === 'allow' && doom_loop === 'allow' && external_directory === 'allow';
}

export function mergePermissionConfig(config: Config | undefined, enabled: boolean): Config {
  const currentPermission = config?.permission && typeof config.permission === 'object'
    ? config.permission
    : {};

  return {
    ...(config || {}),
    permission: {
      ...currentPermission,
      edit: enabled ? 'allow' : 'ask',
      bash: enabled ? 'allow' : 'ask',
      webfetch: enabled ? 'allow' : 'ask',
      doom_loop: enabled ? 'allow' : 'ask',
      external_directory: enabled ? 'allow' : 'ask',
    },
  };
}
