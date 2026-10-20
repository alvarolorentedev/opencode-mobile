import { View, StyleSheet } from 'react-native';
import { WorkspaceScope, useWorkspaces } from '@/providers/workspace-context';
import { TerminalView } from '@/components/terminal/terminal-view';
export function RetainedTerminals({ visible, slim, palette, onError }: { visible: boolean; slim: boolean; palette: { background: string; text: string; tint: string; surface: string }; onError: (message: string) => void }) {
  const registry = useWorkspaces();
  const selected = registry.terminalTarget ?? registry.focus;
  const selectedKey = selected && registry.resolveKey(selected);
  return <>{Object.entries(registry.snapshots).filter(([, runtime]) => runtime.values.terminalValue.terminalRuntime.instances.length > 0).map(([key, runtime]) => {
    const [connectionId, projectPath] = JSON.parse(key) as [string, string];
    const active = visible && key === selectedKey && runtime.values.connectionValue.connection.status === 'connected';
    return <View key={key} pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, { opacity: active ? 1 : 0 }]}>
      <WorkspaceScope target={{ connectionId, projectPath }}><TerminalView visible={active} slim={slim} palette={palette} onError={onError} /></WorkspaceScope>
    </View>;
  })}</>;
}
