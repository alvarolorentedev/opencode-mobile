import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { EntryActionContent } from '@/features/projects/ui/entry-action-content';

export function EntryActionSheet(props: ComponentProps<typeof EntryActionContent>) {
  const { t } = useTranslation();
  const title = props.mode === 'rename'
    ? t(`project:files.actions.${props.entry.type === 'directory' ? 'renameFolder' : 'renameFile'}`)
    : props.entry.path.split('/').pop() || props.entry.name;
  return <OverlaySheet visible fitContent dismissible={!props.busy} dismissKeyboard={props.mode !== 'rename'} title={title}
    testID={props.mode === 'rename' ? 'project-entry-rename' : 'project-entry-actions'} onClose={props.onClose}>
    <EntryActionContent {...props} />
  </OverlaySheet>;
}
