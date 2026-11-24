import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { useTranslation } from 'react-i18next';

import { useProjectCheckouts } from '@/features/projects/index';

// Read-only workspace line under the session title. Workspace changes belong to
// Projects and New chat; the chat header must not expose another selector.
export function ChatWorkspaceContext() {
  const { t } = useTranslation();

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
      className={cn(stylesClasses.context, "text-muted-foreground")}
      variant="label">
      {context}
    </Text>
  );
}

const stylesClasses = {
  "context": "text-[10.5px]"
} as const;
