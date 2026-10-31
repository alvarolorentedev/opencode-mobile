import type { TokenUsageInfo } from '@opencode/client';
// Details used by the transcript renderer and usage ledger, independent of wire format.
export type MessageError = {
    name: string;
    data?: {
        message?: string;
        [key: string]: unknown;
    };
    message?: string;
};
type MessageBase = {
    id: string;
    sessionID: string;
    time: {
        created: number;
        completed?: number;
    };
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    metadata?: Record<string, unknown>;
};
export type Message = (MessageBase & {
    role: 'user';
    summary?: {
        title?: string;
        body?: string;
        diffs: import('@/shared/protocol/opencode/types').FileDiff[];
    };
}) | (MessageBase & {
    role: 'assistant';
    parentID?: string;
    providerID: string;
    modelID: string;
    cost?: number;
    tokens?: TokenUsageInfo;
    finish?: string;
    error?: MessageError;
    mode?: string;
    path?: {
        cwd: string;
        root: string;
    };
});
type PartBase = {
    id: string;
    sessionID: string;
    messageID: string;
};
export type FilePartInput = {
    type: 'file';
    mime: string;
    filename?: string;
    url: string;
};
export type TextPartInput = {
    type: 'text';
    text: string;
};
export type ToolPart = PartBase & {
    type: 'tool';
    callID: string;
    tool: string;
    metadata?: Record<string, unknown>;
    state: {
        status: 'pending';
        input: Record<string, unknown>;
        raw?: string;
    } | {
        status: 'running';
        input: Record<string, unknown>;
        title?: string;
        metadata?: Record<string, unknown>;
        time?: {
            start: number;
        };
    } | {
        status: 'completed';
        input: Record<string, unknown>;
        output: string;
        title?: string;
        metadata?: Record<string, unknown>;
        attachments?: (PartBase & FilePartInput)[];
        time?: {
            start: number;
            end: number;
            compacted?: number;
        };
    } | {
        status: 'error';
        input: Record<string, unknown>;
        error: string;
        metadata?: Record<string, unknown>;
        time?: {
            start: number;
            end: number;
        };
    };
};
export type StepFinishPart = PartBase & {
    type: 'step-finish';
    reason: string;
    snapshot?: string;
    cost: number;
    tokens: TokenUsageInfo;
};
export type Part = ToolPart | StepFinishPart | (PartBase & TextPartInput & {
    synthetic?: boolean;
    ignored?: boolean;
    time?: {
        start: number;
        end?: number;
    };
}) | (PartBase & FilePartInput & {
    source?: unknown;
}) | (PartBase & {
    type: 'reasoning';
    text: string;
    metadata?: Record<string, unknown>;
    time?: {
        start: number;
        end?: number;
    };
}) | (PartBase & {
    type: 'patch';
    hash?: string;
    files: string[];
}) | (PartBase & {
    type: 'subtask';
    prompt?: string;
    description: string;
    agent?: string;
}) | (PartBase & {
    type: 'step-start';
    snapshot?: string;
}) | (PartBase & {
    type: 'snapshot';
    snapshot: string;
}) | (PartBase & {
    type: 'agent';
    name: string;
}) | (PartBase & {
    type: 'retry';
    attempt: number;
    error: MessageError;
    time?: {
        created: number;
    };
}) | (PartBase & {
    type: 'compaction';
    auto: boolean;
});
