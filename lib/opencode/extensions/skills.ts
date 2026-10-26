import { isInside, joinPath } from './scope';
import type { ExtensionScope, ExtensionSkillDraft } from './types';

export function slugifySkillId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
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

export function trashRoot(root: string) {
  return joinPath(root, '.opencode-mobile-trash');
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
