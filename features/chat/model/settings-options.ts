import type { ResponseScope } from '@/shared/preferences/opencode-preferences';

export const RESPONSE_SCOPE_OPTIONS: { value: ResponseScope }[] = [
  { value: 'brief' },
  { value: 'balanced' },
  { value: 'detailed' },
];
