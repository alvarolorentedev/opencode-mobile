import type { McpLocalConfig, McpRemoteConfig, McpStatus, ProviderAuthMethod, ProviderAuthValues } from '@/shared/protocol/opencode/types';

import type { ExtensionCommandDraft, ExtensionScope, ExtensionSkillDraft, ExtensionSkillRow, ExtensionSnapshot } from '@/shared/protocol/opencode/extensions/types';

export type McpContextValue = {
  mcpStatuses: Record<string, McpStatus>;
  refreshMcpServers: () => Promise<void>;
  addMcpServer: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  connectMcpServer: (name: string) => Promise<void>;
  disconnectMcpServer: (name: string) => Promise<void>;
  mcpOAuth: {
    methods: (name: string) => Promise<ProviderAuthMethod[]>;
    start: (name: string, method: number, values?: ProviderAuthValues) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
    complete: (name: string, code: string) => Promise<void>;
    wait: (name: string) => Promise<void>;
    cancel: (name: string) => Promise<void>;
  };
};

export type ExtensionsContextValue = {
  extensions: {
    snapshot?: ExtensionSnapshot;
    isRefreshing: boolean;
    busy?: string;
    error?: string;
    refresh: () => Promise<void>;
    addMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
    updateMcp: (scope: ExtensionScope, name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
    removeMcp: (scope: ExtensionScope, name: string) => Promise<void>;
    addPlugin: (scope: ExtensionScope, target: string) => Promise<void>;
    removePlugin: (scope: ExtensionScope, target: string) => Promise<void>;
    saveCommand: (scope: ExtensionScope, draft: ExtensionCommandDraft, previousName?: string) => Promise<void>;
    removeCommand: (scope: ExtensionScope, name: string) => Promise<void>;
    createSkill: (scope: ExtensionScope, draft: ExtensionSkillDraft) => Promise<void>;
    updateSkill: (scope: ExtensionScope, row: ExtensionSkillRow, content: string) => Promise<void>;
    removeSkill: (scope: ExtensionScope, row: ExtensionSkillRow) => Promise<void>;
    restoreBackup: (scope: ExtensionScope) => Promise<void>;
  };
};
