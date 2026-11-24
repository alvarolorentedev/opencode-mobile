import { View, StyleSheet } from 'react-native';

import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { Palette } from '@/shared/ui/theme/theme';

import { TerminalView } from '@/features/terminal/ui/terminal-view';
import { useRetainedTerminalScopes } from '@/features/terminal/context';

export function RetainedTerminals({ target, connected, visible, palette, dismissKeyboard = false, onCopied, onError }: {
  target: WorkspaceTarget;
  connected: boolean;
  visible: boolean;
  palette: Palette;
  dismissKeyboard?: boolean;
  onCopied?: () => void;
  onError: (message: string) => void;
}) {
  const { scopes, selectedKey } = useRetainedTerminalScopes(target);
  return <>{scopes.map((scope) => {
    const active = visible && connected && scope.key === selectedKey;
    return <View key={scope.key} pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, { opacity: active ? 1 : 0 }]}>
      <TerminalView target={scope.target} visible={active} palette={palette} dismissKeyboard={active && dismissKeyboard} onCopied={onCopied} onError={onError} />
    </View>;
  })}</>;
}
