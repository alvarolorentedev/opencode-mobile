import { parseDocument, stringify } from 'yaml';
import { permissionRulesetSchema } from '@/shared/protocol/opencode/extensions/contract';

export type PermissionRule = { action: string; resource: string; effect: 'ask' | 'allow' | 'deny' };

export function readPermissionRules(text: string, format: 'json' | 'yaml'): PermissionRule[] | undefined {
  if (!text.trim()) return [];
  try {
    const doc = format === 'yaml' ? parseDocument(text, { schema: 'core', uniqueKeys: true }) : undefined;
    if (doc?.errors.length) return undefined;
    const value: unknown = doc ? doc.toJS({ maxAliasCount: 0 }) : JSON.parse(text);
    const parsed = permissionRulesetSchema.safeParse(value);
    // Unknown rule fields must survive editing through the source editor.
    if (!parsed.success || (value as Record<string, unknown>[]).some((rule) => Object.keys(rule).some((key) => !['action', 'resource', 'effect'].includes(key)))) return undefined;
    return parsed.data;
  } catch { return undefined; }
}

export function writePermissionRules(rules: PermissionRule[], format: 'json' | 'yaml') {
  if (!rules.length) return '';
  return format === 'json' ? JSON.stringify(rules, null, 2) : stringify(rules, { lineWidth: 0 }).trimEnd();
}
