import { getEventSessionStatus, type OpencodeEvent } from './events';
export function isServerConnectedEvent(event: OpencodeEvent) {
  return (event.type === 'compatibility' ? event.payload.type : event.type) === 'server.connected';
}
// Resource names match the canonical provider query keys. Session content and
// transports keep their independent project-level event reconciliation.
export function serverDataResources(event: OpencodeEvent): string[] {
  const type: string = event.type === 'compatibility' ? event.payload.type : event.type;
  if (type === 'server.connected') return ['capabilities', 'configuration', 'agents', 'skills', 'references', 'commands', 'plugins', 'extension-inspection', 'projects', 'location', 'worktrees', 'file-status', 'vcs', 'directory', 'search', 'preview', 'mcp', 'diagnostics', 'saved-permissions'];
  if (/^(server\.connected|catalog\.|config\.|provider\.|model\.|agent\.|integration\.|credential\.|models-dev\.)/.test(type)) return ['capabilities', 'configuration', 'agents', 'skills', 'references', 'commands', 'extension-inspection'];
  if (/^(skill\.|reference\.|plugin\.|command\.)/.test(type)) return ['skills', 'references', 'commands', 'plugins', 'extension-inspection'];
  if (type.startsWith('worktree.')) return ['worktrees', 'projects', 'location'];
  if (type.startsWith('project.')) return ['projects', 'location', 'worktrees'];
  const idle = getEventSessionStatus(event)?.status.type === 'idle';
  if (/^(filesystem\.|file\.|vcs\.)/.test(type) || idle || type === 'session.idle' || type === 'session.execution.completed') return ['file-status', 'vcs', 'directory', 'search', 'preview'];
  if (type.startsWith('mcp.')) return ['mcp', 'extension-inspection'];
  if (type.startsWith('lsp.')) return ['diagnostics'];
  if (type === 'permission.replied') return ['saved-permissions'];
  return [];
}
