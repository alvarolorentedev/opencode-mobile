import type { ModelOption, ReasoningLevel } from '@/providers/opencode-provider';

export const STARTER_PROMPTS = [
  'Polish this mobile UI to feel closer to OpenCode web mode.',
  'Review the current workspace and suggest the next highest-impact fix.',
  'Implement the feature request and keep me updated as you work.',
];

export const REASONING_OPTIONS: { id: ReasoningLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'default', label: 'Default' },
  { id: 'high', label: 'High' },
];

export const TRANSCRIPT_PAGE_SIZE = 20;

export function getModelLabel(models: ModelOption[], modelId?: string) {
  const match = models.find((model) => model.id === modelId);
  return match ? match.label : 'Select model';
}

export function getAutoApproveIcon(autoApprove: boolean) {
  return autoApprove ? 'shield-check' : 'shield-key';
}
