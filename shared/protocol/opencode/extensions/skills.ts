import { isInside, joinPath, trashRoot } from '@/shared/protocol/opencode/extensions/scope';
import type { ExtensionScope, ExtensionSkillDraft } from '@/shared/protocol/opencode/extensions/types';
import { isMap } from 'yaml';
import { splitMarkdown } from '@/shared/protocol/opencode/extensions/markdown';

export function parseSkillDocument(text: string) {
  const parsed = splitMarkdown(text);
  if (parsed.error) throw new Error(parsed.error);
  const data = parsed.data ?? {};
  if (data.name !== undefined && typeof data.name !== 'string') throw new Error('common:validation.invalid');
  if (data.description !== undefined && typeof data.description !== 'string') throw new Error('common:validation.invalid');
  const metadata = data.metadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('common:validation.invalid');
  const autoinvoke = (metadata as Record<string, unknown> | undefined)?.['opencode/autoinvoke'];
  if (autoinvoke !== undefined && typeof autoinvoke !== 'boolean') throw new Error('common:validation.invalid');
  return { ...parsed, name: typeof data.name === 'string' ? data.name : '', description: typeof data.description === 'string' ? data.description : '', instructions: parsed.body.trim(), autoinvoke: autoinvoke !== false };
}

export function updateSkillDocument(text: string, draft: ExtensionSkillDraft) {
  assertSkillId(draft.id);
  const parsed = parseSkillDocument(text);
  const doc = parsed.doc;
  if (!doc) return skillDocument(draft).text;
  if (!draft.instructions.trim()) throw new Error('Enter the skill instructions.');
  if (draft.name !== parsed.name) doc.set('name', draft.name.trim() || draft.id);
  if ((draft.description ?? '') !== parsed.description) {
    if (draft.description?.trim()) doc.set('description', draft.description.trim());
    else doc.delete('description');
  }
  if ((draft.autoinvoke !== false) !== parsed.autoinvoke) {
    if (!doc.has('metadata')) doc.set('metadata', {});
    if (!isMap(doc.get('metadata'))) throw new Error('common:validation.invalid');
    doc.setIn(['metadata', 'opencode/autoinvoke'], draft.autoinvoke !== false);
  }
  const result = `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${draft.instructions.trim()}\n`;
  return parsed.lineEnding === '\r\n' ? result.replace(/\r?\n/g, '\r\n') : result;
}

export function assertSkillId(value: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error('Skill IDs must use lowercase letters, numbers, and single dashes.');
  }
  return value;
}

export function skillsRoot(root: string, scope: ExtensionScope) {
  return scope === 'project' ? joinPath(root, '.opencode/skills') : joinPath(root, 'skills');
}

export function skillDirectory(root: string, scope: ExtensionScope, id: string) {
  assertSkillId(id);
  return joinPath(skillsRoot(root, scope), id);
}

export function skillFile(root: string, scope: ExtensionScope, id: string) {
  return joinPath(skillDirectory(root, scope, id), 'SKILL.md');
}

export function skillTrashPath(root: string, id: string, stamp: number) {
  return joinPath(trashRoot(root), `${stamp}-${assertSkillId(id)}`);
}

export function isEditableSkillPath(path: string | undefined, root: string, scope: ExtensionScope) {
  return Boolean(path && isInside(skillsRoot(root, scope), path));
}

function frontmatterValue(value: string) {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim());
}

export function skillDocument(draft: ExtensionSkillDraft) {
  const id = assertSkillId(draft.id.trim());
  const name = draft.name.trim() || id;
  const description = draft.description?.trim();
  const body = draft.instructions.trim();
  if (!body) throw new Error('Enter the skill instructions.');
  const lines = [
    '---',
    `name: ${frontmatterValue(name)}`,
    ...(description ? [`description: ${frontmatterValue(description)}`] : []),
    ...(draft.autoinvoke === false ? ['metadata:', '  opencode/autoinvoke: false'] : []),
    '---',
    '',
    body,
    '',
  ];
  return { id, text: lines.join('\n') };
}

