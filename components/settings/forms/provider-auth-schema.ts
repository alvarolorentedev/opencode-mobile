import { z } from 'zod';
import type { ProviderAuthPrompt, ProviderAuthValues } from '@/lib/opencode/types';

export function initialAuthValues(method?: { prompts?: ProviderAuthPrompt[] }): ProviderAuthValues {
  return Object.fromEntries((method?.prompts ?? []).flatMap((prompt) => {
    const value = prompt.defaultValue ?? (prompt.type === 'select' ? prompt.options?.[0]?.value : prompt.type === 'multiselect' ? [] : prompt.type === 'boolean' ? false : undefined);
    return value === undefined ? [] : [[prompt.key, value]];
  }));
}

export function visibleAuthPrompts(prompts: ProviderAuthPrompt[], values: ProviderAuthValues) {
  return prompts.filter((prompt) => (prompt.when ?? []).every((condition) =>
    condition.op === 'eq' ? values[condition.key] === condition.value : values[condition.key] !== condition.value));
}

export function providerAuthSchema(prompts: ProviderAuthPrompt[]) {
  return z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).superRefine((values, context) => {
    for (const prompt of visibleAuthPrompts(prompts, values)) {
      if (prompt.type === 'external') continue;
      const value = values[prompt.key];
      if (prompt.required && (value === undefined || value === '' || Array.isArray(value) && !value.length)) {
        context.addIssue({ code: 'custom', path: [prompt.key], message: 'common:validation.required' });
      } else if ((prompt.type === 'number' || prompt.type === 'integer') && value !== undefined && value !== '') {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || prompt.type === 'integer' && !Number.isInteger(numeric)
          || prompt.min !== undefined && numeric < prompt.min || prompt.max !== undefined && numeric > prompt.max) {
          context.addIssue({ code: 'custom', path: [prompt.key], message: 'common:validation.invalid' });
        }
      }
    }
  });
}
