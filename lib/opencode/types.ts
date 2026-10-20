// App-owned presentation models. Transport records come from @opencode/client;
// v1 wire types are confined to the compatibility boundary.
import type { TokenUsageInfo, ModelRef, FileDiffInfo as NativeVcsFileDiff, VcsFileStatus as NativeVcsFileStatus } from '@opencode/client';
export type { Message, Part, ToolPart, TextPartInput, FilePartInput, StepFinishPart } from './message-types';
export type SessionStatus = {
    type: 'idle';
} | {
    type: 'busy';
} | {
    type: 'retry';
    attempt: number;
    message: string;
    next: number;
    action?: {
        reason: string;
        provider: string;
        title: string;
        message: string;
        label: string;
        link?: string;
    };
};
export type Session = {
    id: string;
    title: string;
    directory?: string;
    projectID?: string;
    parentID?: string;
    slug?: string;
    version?: string;
    workspaceID?: string;
    path?: string;
    time: {
        created: number;
        updated: number;
        archived?: number;
        compacting?: number;
    };
    model?: ModelRef;
    agent?: string;
    tokens?: TokenUsageInfo;
    cost?: number;
    share?: {
        url: string;
    };
    metadata?: Record<string, unknown>;
    permission?: PermissionRuleset;
    summary?: {
        additions: number;
        deletions: number;
        files: number;
        diffs?: FileDiff[];
    };
    revert?: {
        messageID: string;
        partID?: string;
        snapshot?: string;
        diff?: string;
    };
};
export type GlobalSession = Session & {
    project?: {
        id: string;
        name?: string;
        worktree?: string;
    } | null;
};
export type Project = {
    id: string;
    worktree: string;
    vcs?: string;
    name?: string;
    icon?: {
        url?: string;
        override?: string;
        color?: string;
    };
    commands?: {
        start?: string;
    };
    time: {
        created: number;
        updated?: number;
        initialized?: number;
    };
    sandboxes?: string[];
};
export type Todo = {
    content: string;
    status: string;
    priority: string;
};
export type PermissionRuleset = {
    permission: string;
    pattern: string;
    action: 'allow' | 'deny' | 'ask';
}[];
export type Agent = {
    name: string;
    description?: string;
    mode: 'primary' | 'subagent' | 'all';
    hidden?: boolean;
    color?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    permission?: PermissionRuleset;
    options?: Record<string, unknown>;
    steps?: number;
};
export type Command = {
    name: string;
    description?: string;
    template?: string;
    agent?: string;
    model?: string;
    subtask?: boolean;
    hints?: string[];
};
export type Model = {
    id: string;
    providerID: string;
    name: string;
    variants: { id: string }[];
    capabilities: {
        reasoning: boolean;
        attachment: boolean;
        toolcall: boolean;
        input: Record<'text' | 'audio' | 'image' | 'video' | 'pdf', boolean>;
    };
    limit: {
        context: number;
        input?: number;
        output: number;
    };
    cost: {
        input: number;
        output: number;
        cache: {
            read: number;
            write: number;
        };
        tiers?: {
            input: number;
            output: number;
            cache: {
                read: number;
                write: number;
            };
            tier: {
                type: 'context';
                size: number;
            };
        }[];
        experimentalOver200K?: {
            input: number;
            output: number;
            cache: {
                read: number;
                write: number;
            };
        };
    };
    status: 'alpha' | 'beta' | 'deprecated' | 'active';
};
export type Provider = {
    id: string;
    name: string;
    models: Record<string, Model>;
    integrationIds?: string[];
};
export type ProviderCatalog = {
    all: Provider[];
    connected: string[];
    default: Record<string, string>;
};
export type McpOAuthConfig = {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
};
export type McpLocalConfig = {
    type: 'local';
    command: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
    timeout?: number;
};
export type McpRemoteConfig = {
    type: 'remote';
    url: string;
    headers?: Record<string, string>;
    oauth?: McpOAuthConfig | false;
    enabled?: boolean;
    timeout?: number;
};
export type McpStatus = {
    status: 'connected' | 'disabled' | 'pending';
} | {
    status: 'failed' | 'needs_auth' | 'needs_client_registration';
    error?: string;
    integrationID?: string;
};
export type Config = {
    model?: string;
    default_agent?: string;
    enabled_providers?: string[];
    disabled_providers?: string[];
    provider?: Record<string, {
        models?: Record<string, {
            disabled?: boolean;
            name?: string;
            options?: Record<string, unknown>;
        }>;
        disabled?: boolean;
        [key: string]: unknown;
    }>;
    agent?: Record<string, {
        disable?: boolean;
        mode?: string;
        [key: string]: unknown;
    } | undefined>;
    permission?: 'allow' | 'deny' | 'ask' | Record<string, 'allow' | 'deny' | 'ask' | Record<string, 'allow' | 'deny' | 'ask' | undefined> | undefined>;
    mcp?: Record<string, McpLocalConfig | McpRemoteConfig | {
        enabled: boolean;
    }>;
    [key: string]: unknown;
};
export type FileContent = {
    type: 'text' | 'binary';
    content: string;
    encoding?: 'base64';
    mimeType?: string;
    diff?: string;
    patch?: unknown;
};
export type FileNode = {
    name: string;
    path: string;
    absolute: string;
    type: 'file' | 'directory';
    ignored: boolean;
};
export type File = {
    path: string;
    added: number;
    removed: number;
    status: 'added' | 'deleted' | 'modified';
};
export type VcsInfo = {
    branch?: string;
    default_branch?: string;
};
export type VcsFileDiff = NativeVcsFileDiff;
export type VcsFileStatus = NativeVcsFileStatus;
export type FileDiff = {
    file?: string;
    patch?: string;
    additions: number;
    deletions: number;
    status?: 'added' | 'deleted' | 'modified';
};
export type VcsApplyError = {
    type: string;
    message: string;
    [key: string]: unknown;
};
export type Worktree = {
    name: string;
    branch: string;
    directory: string;
};
export type WorktreeCreateInput = {
    name?: string;
    startCommand?: string;
};
export type WorktreeRemoveInput = {
    directory: string;
};
export type WorktreeResetInput = {
    directory: string;
};
export type Pty = {
    id: string;
    title: string;
    command: string;
    args: string[];
    cwd: string;
    status: 'running' | 'exited';
    pid: number;
    exitCode?: number;
};
export type PtyShellsResponse = {
    name: string;
    path: string;
    args?: string[];
    acceptable?: boolean;
}[];
export type PtyTicketConnectToken = {
    ticket: string;
};
export type LspStatus = {
    id: string;
    name: string;
    root: string;
    status: string;
};
export type FormatterStatus = {
    name: string;
    extensions: string[];
    enabled: boolean;
};
export type Symbol = {
    name: string;
    kind: number;
    location: {
        uri: string;
        range: {
            start: {
                line: number;
                character: number;
            };
            end: {
                line: number;
                character: number;
            };
        };
    };
};
export type ToolIds = string[];
export type ToolListItem = {
    id: string;
    description: string;
    parameters: unknown;
};
export type ToolList = ToolListItem[];
export type Skills = {
    name: string;
    description: string;
    location: string;
    content?: string;
}[];
// Provider credential input values. V2 forms can carry non-string values
// (numbers, switches, multi-selects) alongside text fields.
export type ProviderAuthValues = Record<string, string | number | boolean | string[]>;
export type ProviderAuthPromptWhen = {
    key: string;
    op: 'eq' | 'neq';
    value: string | number | boolean;
};
// Normalized provider auth prompt. Both the V1 auth metadata and the richer V2
// integration forms (string/select/number/boolean/multiselect/external) map
// into this so the setup UI renders type-specific controls from one model.
export type ProviderAuthPrompt = {
    type: 'text' | 'select' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
    key: string;
    message: string;
    placeholder?: string;
    options?: {
        label: string;
        value: string;
    }[];
    defaultValue?: string | number | boolean | string[];
    required?: boolean;
    min?: number;
    max?: number;
    url?: string;
    when?: ProviderAuthPromptWhen[];
};
export type ProviderAuthMethod = {
    type: 'oauth' | 'api';
    label: string;
    prompts?: ProviderAuthPrompt[];
};
export default {};
