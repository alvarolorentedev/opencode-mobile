import type { OpencodeEvent } from './events';
// Resource names match the canonical provider query keys. Session content and
// transports keep their independent project-level event reconciliation.
export function serverDataResources(event: OpencodeEvent): string[] {
  const type: string = event.type === 'compatibility' ? event.payload.type : event.type;
  if (/^(server\.connected|catalog\.|config\.|provider\.|model\.|agent\.|integration\.|credential\.|models-dev\.)/.test(type)) return ['capabilities', 'configuration', 'agents', 'skills', 'references', 'commands', 'extension-inspection'];
  if (/^(skill\.|reference\.|plugin\.|command\.)/.test(type)) return ['skills', 'references', 'commands', 'plugins', 'extension-inspection'];
  if (type.startsWith('worktree.')) return ['worktrees', 'catalog'];
  if (type.startsWith('project.')) return ['catalog', 'worktrees'];
  if (/^(filesystem\.|file\.|vcs\.)/.test(type) || type === 'session.idle' || type === 'session.execution.completed') return ['file-status', 'vcs', 'directory', 'search', 'preview'];
  if (type.startsWith('mcp.')) return ['mcp', 'extension-inspection'];
  if (type.startsWith('lsp.')) return ['diagnostics'];
  if (type === 'permission.replied') return ['saved-permissions'];
  return [];
}
