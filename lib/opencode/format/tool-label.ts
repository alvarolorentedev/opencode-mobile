import type { TFunction } from 'i18next';

import { getToolDisplayName } from './tool';

const TOOL_KEYS: Record<string, string> = {
  bash: 'shell',
  fish: 'shell',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  patch: 'patch',
  apply_patch: 'patch',
  edit: 'edit',
  multiedit: 'edit',
  read: 'read',
  search: 'search',
  websearch: 'search',
  list: 'list',
  fetch: 'fetch',
  webfetch: 'fetch',
  glob: 'glob',
  grep: 'grep',
  todowrite: 'plan',
  task: 'task',
  skill: 'skill',
  write: 'write',
};

export function getToolLabel(tool: string, t: TFunction) {
  const key = TOOL_KEYS[tool.trim().toLowerCase()];
  return key ? t(`chat:tools.${key}`) : getToolDisplayName(tool);
}
