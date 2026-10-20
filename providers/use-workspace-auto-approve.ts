import { useEffect, useRef } from 'react';
import type { useWorkspaceConnections } from '@/providers/use-workspace-connections';
export function useWorkspaceAutoApprove(registry: ReturnType<typeof useWorkspaceConnections>) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const pending = new Set<string>();
    for (const [key, runtime] of Object.entries(registry.snapshots)) {
      const [id] = JSON.parse(key) as string[];
      const entry = registry.connections.find((item) => item.id === id);
      if (!entry?.enabled || !entry.preferences.autoApprove || runtime.values.connectionValue.connection.status !== 'connected') continue;
      for (const request of Object.values(runtime.pendingPermissions).flat()) {
        const requestKey = JSON.stringify([id, request.id]);
        pending.add(requestKey);
        if (attempted.current.has(requestKey)) continue;
        attempted.current.add(requestKey);
        void runtime.values.chatValue.replyToPermission(request.id, 'once').catch((error) => console.warn('Automatic approval failed; review the request manually.', error));
      }
    }
    for (const key of attempted.current) if (!pending.has(key)) attempted.current.delete(key);
  }, [registry.connections, registry.snapshots]);
}
