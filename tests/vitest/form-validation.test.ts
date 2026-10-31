import { describe, expect, it } from 'vitest';
import { providerAuthSchema, initialAuthValues } from '@/features/ai/model/provider-auth-schema';
import { commandSchema, mcpSchema } from '@/features/extensions/model/extension-schemas';
import type { ProviderAuthPrompt } from '@/shared/protocol/opencode/types';

describe('form validation boundaries', () => {
  it('validates only visible authentication prompts and preserves secret bytes', () => {
    const prompts: ProviderAuthPrompt[] = [
      { key: 'mode', type: 'select', message: 'Mode', options: [{ value: 'key', label: 'Key' }] },
      { key: 'secret', type: 'text', message: 'Secret', required: true, when: [{ key: 'mode', op: 'eq', value: 'key' }] },
      { key: 'port', type: 'integer', message: 'Port', min: 1, max: 65535, when: [{ key: 'mode', op: 'eq', value: 'remote' }] },
    ];
    const schema = providerAuthSchema(prompts);
    expect(initialAuthValues({ prompts })).toEqual({ mode: 'key' });
    expect(schema.safeParse({ mode: 'key' }).success).toBe(false);
    expect(schema.parse({ mode: 'key', secret: '  token  ' }).secret).toBe('  token  ');
    expect(schema.safeParse({ mode: 'remote', port: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ mode: 'remote', port: '65536' }).success).toBe(false);
    expect(schema.safeParse({ mode: 'remote', port: '4096' }).success).toBe(true);
  });
  it('rejects malformed MCP commands and blank command templates', () => {
    expect(mcpSchema.safeParse({ name: 'local', type: 'local', target: '{}' }).success).toBe(false);
    expect(mcpSchema.safeParse({ name: 'local', type: 'local', target: '["npx", "server"]' }).success).toBe(true);
    expect(commandSchema.safeParse({ name: 'run', description: '', template: '  ' }).success).toBe(false);
  });
});
