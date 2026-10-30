import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Fonts } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';
import { useProjectCheckouts } from '@/providers/use-project-checkouts';

// Read-only workspace line under the session title. Workspace changes belong to
// Projects and New chat; the chat header must not expose another selector.
export function ChatWorkspaceContext({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { activeProject, activeCheckout, multiple } = useProjectCheckouts();
  if (!activeProject) return null;
  const checkoutLabel = activeCheckout?.isMain ? t('project:worktrees.local') : activeCheckout?.name;
  const location = multiple && checkoutLabel ? `${activeProject.label} / ${checkoutLabel}` : activeProject.label;
  const context = activeCheckout?.branch ? `${location} · ${activeCheckout.branch}` : location;
  return (
    <Text
      testID="chat-workspace-context"
      maxFontSizeMultiplier={1.5}
      numberOfLines={1}
      ellipsizeMode="tail"
      style={[styles.context, compact && styles.contextCompact, { color: palette.muted }]}>
      {context}
    </Text>
  );
}

const styles = StyleSheet.create({
  context: { fontFamily: Fonts.sans, fontSize: 11.5, marginTop: 1 },
  contextCompact: { fontSize: 10.5 },
});
