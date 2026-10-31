import type { Model } from '@/shared/protocol/opencode/types';

// Model/provider/agent catalog shapes and the pure selection rules that keep the
// stored choice valid against the current server catalog.

export type ModelOption = {
  id: string;
  label: string;
  providerID: string;
  providerLabel: string;
  modelID: string;
  variants: { id: string }[];
  supportsReasoning: boolean;
  supportsAttachments: boolean;
  inputModalities: ('text' | 'audio' | 'image' | 'video' | 'pdf')[];
  supportsToolCalls: boolean;
  status?: 'alpha' | 'beta' | 'deprecated' | 'active';
  contextLimit?: number;
  outputLimit?: number;
  pricing?: Model['cost'];
};

export type AgentOption = {
  id: string;
  label: string;
  description?: string;
};
