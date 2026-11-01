import { isMap, parseDocument, stringify } from 'yaml';

import { agentDefinitionSchema, commandDefinitionSchema, legacyPermissionSchema, modelSelectionSchema, permissionRulesetSchema } from '@/shared/protocol/opencode/extensions/contract';
import { assertDefinitionName, isInside, joinPath } from '@/shared/protocol/opencode/extensions/scope';
import type { ExtensionAgentDraft, ExtensionAgentMode, ExtensionCommandDraft, ExtensionScope } from '@/shared/protocol/opencode/extensions/types';

const AGENT_FIELDS = ['description', 'mode', 'model', 'request', 'hidden', 'color', 'steps', 'disabled', 'permissions', 'permission'];

export type MarkdownRoot = {
  scope: ExtensionScope;
  kind: 'agents' | 'commands';
  root: string;
  recursive: boolean;
  legacy: boolean;
};

export function canonicalMarkdownRoot(root: string, scope: ExtensionScope, kind: 'agents' | 'commands') {
  return scope === 'project'
    ? joinPath(root, `.opencode/${kind}`)
    : joinPath(root, kind);
}

export function markdownRoots(root: string, scope: ExtensionScope, kind: 'agents' | 'commands'): MarkdownRoot[] {
  if (kind === 'commands') {
    return [
      { scope, kind, root: canonicalMarkdownRoot(root, scope, kind), recursive: true, legacy: false },
      { scope, kind, root: joinPath(root, scope === 'project' ? '.opencode/command' : 'command'), recursive: true, legacy: true },
    ];
  }
  return [
    { scope, kind, root: canonicalMarkdownRoot(root, scope, kind), recursive: true, legacy: false },
    { scope, kind, root: joinPath(root, scope === 'project' ? '.opencode/agent' : 'agent'), recursive: true, legacy: true },
    { scope, kind, root: joinPath(root, scope === 'project' ? '.opencode/modes' : 'modes'), recursive: false, legacy: true },
    { scope, kind, root: joinPath(root, scope === 'project' ? '.opencode/mode' : 'mode'), recursive: false, legacy: true },
  ];
}

export function markdownFile(root: string, scope: ExtensionScope, kind: 'agents' | 'commands', name: string) {
  const safe = assertMarkdownName(name, kind);
  return joinPath(canonicalMarkdownRoot(root, scope, kind), `${safe}.md`);
}

export function assertMarkdownName(name: string, kind: 'agents' | 'commands') {
  const label = kind === 'agents' ? 'Agent names' : 'Command names';
  const safe = assertDefinitionName(name, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(safe)) {
    throw new Error(`${label} may only contain letters, numbers, dots, dashes, underscores, and slashes.`);
  }
  return safe;
}

export function isEditableMarkdownPath(path: string | undefined, root: string, scope: ExtensionScope, kind: 'agents' | 'commands') {
  return Boolean(path && !hasParentSegment(path) && path.endsWith('.md') && markdownRoots(root, scope, kind).some((entry) => isInside(entry.root, path)));
}

export function hasParentSegment(path: string) {
  return path.replace(/\\/g, '/').split('/').some((segment) => segment === '..');
}

export function markdownTrashPath(root: string, kind: 'agents' | 'commands', name: string, stamp: number) {
  return joinPath(joinPath(root, '.opencode-mobile-trash'), `${stamp}-${kind}-${name.replace(/[^A-Za-z0-9._-]+/g, '-')}`);
}

export function relativeMarkdownName(root: MarkdownRoot, path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parent = root.root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized.startsWith(`${parent}/`)) return undefined;
  const relative = normalized.slice(parent.length + 1).replace(/\.md$/, '');
  if (!root.recursive && relative.includes('/')) return undefined;
  try {
    return assertMarkdownName(relative, root.kind);
  } catch {
    return undefined;
  }
}

export type ParsedAgentMarkdown = ParsedMarkdown & {
  description?: string;
  mode?: ExtensionAgentMode;
  model?: string;
  modelComplex: boolean;
  permissionsKey?: 'permission' | 'permissions';
  permissions?: unknown;
  permissionsText: string;
  advancedFrontmatter: string;
  instructions: string;
};

export type ParsedCommandMarkdown = ParsedMarkdown & {
  description?: string;
  instructions: string;
};

export type ParsedMarkdown = {
  frontmatter: string;
  body: string;
  lineEnding: string;
  hasFrontmatter: boolean;
  doc?: ReturnType<typeof parseDocument>;
  data?: Record<string, unknown>;
  error?: string;
};

export function splitMarkdown(text: string): ParsedMarkdown {
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const match = text.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(text)) {
      return { frontmatter: '', body: text, lineEnding, hasFrontmatter: true, error: 'The frontmatter is missing a closing delimiter.' };
    }
    return { frontmatter: '', body: text, lineEnding, hasFrontmatter: false };
  }
  const frontmatter = match[1];
  const body = text.slice(match[0].length);
  const parsed = parseFrontmatter(frontmatter);
  return { frontmatter, body, lineEnding, hasFrontmatter: true, ...parsed };
}

function parseFrontmatter(frontmatter: string): Pick<ParsedMarkdown, 'doc' | 'data' | 'error'> {
  const attempt = (value: string) => {
    const doc = parseDocument(value, { schema: 'core', uniqueKeys: true });
    if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message || 'Invalid YAML frontmatter.');
    if (doc.contents !== null && !isMap(doc.contents)) throw new Error('Frontmatter must be a YAML mapping.');
    const data = (doc.toJS({ maxAliasCount: 0 }) ?? {}) as Record<string, unknown>;
    return { doc, data };
  };
  try {
    return attempt(frontmatter);
  } catch {
    try {
      return attempt(sanitizeFrontmatter(frontmatter));
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid YAML frontmatter.' };
    }
  }
}

// Mirrors OpenCode's ConfigMarkdown.sanitize retry for unquoted colons in
// legacy frontmatter values.
function sanitizeFrontmatter(frontmatter: string) {
  return frontmatter.split(/\r?\n/).flatMap((line) => {
    if (line.trim().startsWith('#') || line.trim() === '' || /^\s+/.test(line)) return [line];
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!entry) return [line];
    const value = entry[2].trim();
    if (value === '' || value === '>' || value === '|' || value.startsWith('"') || value.startsWith("'")) return [line];
    if (!value.includes(':')) return [line];
    return [`${entry[1]}: |-`, `  ${value}`];
  }).join('\n');
}

export function parseAgentMarkdown(text: string): ParsedAgentMarkdown {
  const parsed = splitMarkdown(text);
  if (parsed.error) return { ...parsed, error: parsed.error, description: undefined, mode: undefined, model: undefined, modelComplex: false, permissionsKey: undefined, permissions: undefined, permissionsText: '', advancedFrontmatter: '', instructions: '' };
  const data = parsed.data ?? {};
  const description = scalar(data.description);
  const mode = data.mode === 'primary' || data.mode === 'subagent' || data.mode === 'all' ? data.mode : undefined;
  const modelComplex = data.model !== undefined && typeof data.model !== 'string';
  const model = typeof data.model === 'string' ? data.model : undefined;
  const permissionsKey = data.permissions !== undefined ? 'permissions' : data.permission !== undefined ? 'permission' : undefined;
  const permissions = permissionsKey ? data[permissionsKey] : undefined;
  const permissionsText = permissions === undefined ? '' : stringify(permissions, { lineWidth: 0 }).trimEnd();
  const advancedFrontmatter = advancedFor(parsed, AGENT_FIELDS, modelComplex);
  return {
    ...parsed,
    description,
    mode,
    model,
    modelComplex,
    permissionsKey,
    permissions,
    permissionsText,
    advancedFrontmatter,
    instructions: parsed.body.trim(),
  };
}

export function parseCommandMarkdown(text: string): ParsedCommandMarkdown {
  const parsed = splitMarkdown(text);
  if (parsed.error) return { ...parsed, error: parsed.error, description: undefined, instructions: '' };
  const data = parsed.data ?? {};
  return {
    ...parsed,
    description: scalar(data.description),
    instructions: parsed.body.trim(),
  };
}

function scalar(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function advancedFor(parsed: ParsedMarkdown, managed: string[], preserveModel: boolean) {
  if (!parsed.hasFrontmatter || !parsed.frontmatter) return '';
  const build = (value: string) => {
    const doc = parseDocument(value, { schema: 'core', uniqueKeys: true });
    if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message || 'Invalid YAML frontmatter.');
    for (const key of managed) {
      if (key === 'model' && preserveModel) continue;
      doc.delete(key);
    }
    if (doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0)) return '';
    return doc.toString({ lineWidth: 0 }).trimEnd();
  };
  try {
    return build(parsed.frontmatter);
  } catch {
    try {
      return build(sanitizeFrontmatter(parsed.frontmatter));
    } catch {
      return '';
    }
  }
}

function deleteKey(doc: ReturnType<typeof parseDocument>, key: string) {
  // Deleting from an empty document throws in the yaml library; a missing key
  // on an empty document is already the desired end state.
  if (doc.contents !== null) doc.delete(key);
}

function documentFor(frontmatter: string | undefined) {
  if (!frontmatter?.trim()) return parseDocument('', { schema: 'core' });
  const attempt = (value: string) => {
    const doc = parseDocument(value, { schema: 'core', uniqueKeys: true });
    if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message || 'Invalid YAML frontmatter.');
    if (doc.contents !== null && !isMap(doc.contents)) throw new Error('Frontmatter must be a YAML mapping.');
    return doc;
  };
  try {
    return attempt(frontmatter);
  } catch {
    return attempt(sanitizeFrontmatter(frontmatter));
  }
}

function render(doc: ReturnType<typeof parseDocument>, body: string, lineEnding: string) {
  // An empty document stringifies to "null"; it must not produce a
  // frontmatter block, or the file fails validation on the next read.
  const frontmatter = doc.contents === null ? '' : doc.toString({ lineWidth: 0 }).trimEnd();
  const content = body.trim();
  const parts = frontmatter ? ['---', frontmatter, '---', '', content] : [content];
  return `${parts.join(lineEnding)}${lineEnding}`;
}

export function buildAgentMarkdown(draft: ExtensionAgentDraft) {
  return updateAgentMarkdown(undefined, draft);
}

export function updateAgentMarkdown(text: string | undefined, draft: ExtensionAgentDraft) {
  const source = text === undefined ? undefined : parseAgentMarkdown(text);
  if (source?.error) throw new Error(source.error);
  const body = draft.instructions.trim();
  if (!body) throw new Error('Enter the agent instructions.');
  assertMarkdownName(draft.id, 'agents');
  if (!['primary', 'subagent', 'all'].includes(draft.mode)) throw new Error('Choose a valid agent mode.');
  const model = draft.model?.trim();
  if (model) {
    const result = modelSelectionSchema.safeParse(model);
    if (!result.success) throw new Error('Use a model such as provider/model or provider/model#variant.');
  }
  const advanced = draft.advancedFrontmatter?.trim() ?? '';
  if (/^---(?:\r?\n|$)/m.test(advanced)) throw new Error('Advanced frontmatter must not contain document delimiters.');
  // Compare normalized YAML so equivalent formatting (quotes, flow style)
  // does not count as an edit that would drop the stored blocks below.
  const normalizeBlock = (value: string) => {
    try {
      return documentFor(value).toString({ lineWidth: 0 }).trim();
    } catch {
      return value.trim();
    }
  };
  const unchangedAdvanced = source && normalizeBlock(advanced) === normalizeBlock(source.advancedFrontmatter ?? '');
  // Rewriting permissions can be skipped only when the document below was
  // built from the original frontmatter (which already carries them).
  // When the doc is rebuilt from the advanced block alone, the draft
  // permissions must be written even if their text did not change.
  const sourceFrontmatter = unchangedAdvanced ? source?.frontmatter : undefined;
  const doc = sourceFrontmatter ? documentFor(sourceFrontmatter) : documentFor(advanced || undefined);
  if (draft.description?.trim()) doc.set('description', draft.description.trim());
  else deleteKey(doc, 'description');
  doc.set('mode', draft.mode);
  if (model) doc.set('model', model);
  else if (!source?.modelComplex) deleteKey(doc, 'model');
  const permissionsText = draft.permissions?.trim() ?? '';
  if (/^---(?:\r?\n|$)/m.test(permissionsText)) throw new Error('Permissions must not contain document delimiters.');
  const permissionsUnchanged = Boolean(sourceFrontmatter) && normalizeBlock(permissionsText) === normalizeBlock(source?.permissionsText ?? '');
  if (!permissionsUnchanged) {
    const key = source?.permissionsKey === 'permission' ? 'permission' : 'permissions';
    deleteKey(doc, 'permission');
    deleteKey(doc, 'permissions');
    if (permissionsText) {
      const permissionDoc = parseDocument(permissionsText, { schema: 'core', uniqueKeys: true });
      if (permissionDoc.errors.length > 0) throw new Error(permissionDoc.errors[0]?.message || 'Invalid permissions YAML.');
      if (permissionDoc.contents === null) throw new Error('Permissions cannot be empty.');
      const value = permissionDoc.toJS({ maxAliasCount: 0 });
      if (key === 'permission') {
        const result = legacyPermissionSchema.safeParse(value);
        if (!result.success) throw new Error('Legacy permissions must map permission keys to allow, ask, or deny.');
      } else {
        const result = permissionRulesetSchema.safeParse(value);
        if (!result.success) throw new Error('Permissions must be an array of action/resource/effect rules.');
      }
      doc.set(key, value);
    }
  }
  const validation = agentDefinitionSchema.safeParse(doc.toJS({ maxAliasCount: 0 }) ?? {});
  if (!validation.success) throw new Error(validation.error.issues[0]?.message || 'Invalid agent definition.');
  return render(doc, body, source?.lineEnding ?? '\n');
}

export function buildCommandMarkdown(draft: ExtensionCommandDraft) {
  return updateCommandMarkdown(undefined, draft);
}

export function updateCommandMarkdown(text: string | undefined, draft: ExtensionCommandDraft) {
  const source = text === undefined ? undefined : parseCommandMarkdown(text);
  if (source?.error) throw new Error(source.error);
  const template = draft.template.trim();
  if (!template) throw new Error('Enter a command template.');
  assertMarkdownName(draft.name, 'commands');
  const doc = source?.frontmatter ? documentFor(source.frontmatter) : parseDocument('', { schema: 'core' });
  if (draft.description?.trim()) doc.set('description', draft.description.trim());
  else deleteKey(doc, 'description');
  const validation = commandDefinitionSchema.safeParse({ ...(doc.toJS({ maxAliasCount: 0 }) ?? {}), template });
  if (!validation.success) throw new Error(validation.error.issues[0]?.message || 'Invalid command definition.');
  return render(doc, template, source?.lineEnding ?? '\n');
}
