import type { PromptContextItem } from '@/shared/protocol/opencode/prompt-inbox';

export type ComposerSuggestionKind = 'command' | 'agent' | 'skill' | 'file' | 'reference';

export type ComposerSuggestion = {
  key: string;
  kind: ComposerSuggestionKind;
  label: string;
  description?: string;
  // Text inserted over the active trigger, including the trailing space that
  // closes the autocomplete.
  insert: string;
  context?: PromptContextItem;
};

export type ComposerSuggestionGroup = {
  kind: ComposerSuggestionKind;
  items: ComposerSuggestion[];
};
