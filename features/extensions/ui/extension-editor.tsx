import { UpdateBlockingSheet as OverlaySheet } from '@/features/updates/index';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SettingsPanel, useSettingsTarget } from '@/shared/ui/settings/settings-panel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';
import type { ExtensionScope } from '@/shared/protocol/opencode/extensions/types';

export type EditorProps = {
  workspace: WorkspaceTarget;
  scope: ExtensionScope;
  onClose: () => void;
  save: (action: () => Promise<void>) => void;
};

export function ExtensionEditor({ title, context, busy, error, onClose, onSubmit, setup, instructions, section = 'setup', onSectionChange, saveID, readOnly = false }: {
  title: string; context: string; dirty: boolean; busy: boolean; error?: string;
  onClose: () => void; onSubmit: () => void; setup: ReactNode; instructions?: ReactNode;
  section?: string; onSectionChange?: (section: string) => void; saveID?: string; readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const target = useSettingsTarget();
  function close() {
    if (busy) return;
    onClose();
  }
  return <><OverlaySheet visible title={title} onClose={close} scrollable={false} testID="extension-editor"
    headerAction={<Button variant="ghost" disabled={busy} onPress={close} accessibilityLabel={t('settings:extensions.editor.back')}><Icon name="arrow-left" /></Button>}>
    <Text variant="description" className="text-muted-foreground">{context}</Text>
    {instructions ? <Tabs value={section} onValueChange={(value) => onSectionChange?.(value)} className="flex-1 min-h-0 gap-3">
      <TabsList className="flex-row"><TabsTrigger value="setup"><Text>{t('settings:extensions.editor.setup')}</Text></TabsTrigger><TabsTrigger value="instructions"><Text>{t('settings:extensions.editor.instructions')}</Text></TabsTrigger></TabsList>
      <SettingsPanel target={target}><TabsContent value="setup">{setup}</TabsContent><TabsContent value="instructions">{instructions}</TabsContent></SettingsPanel>
    </Tabs> : <View className="flex-1 min-h-0"><SettingsPanel target={target}>{setup}</SettingsPanel></View>}
    {error ? <FieldDescription invalid testID="extension-editor-error">{error}</FieldDescription> : null}
    {!readOnly ? <Button testID={saveID} disabled={busy} onPress={onSubmit}><Text>{t(busy ? 'settings:extensions.saving' : 'common:actions.save')}</Text></Button> : null}
  </OverlaySheet></>;
}

export function useEditorSection(instructionsLabel: string) {
  const target = useSettingsTarget();
  return useState(target?.label === instructionsLabel ? 'instructions' : 'setup');
}
