import type { ComponentProps } from 'react';

import { useUpdates } from '@/features/updates/context';
import { CatalogSelect } from '@/shared/ui/catalog-select';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { WorkspaceSelect } from '@/shared/ui/workspace-select';

export function UpdateBlockingSheet(props: ComponentProps<typeof OverlaySheet>) {
  const { block } = useUpdates();
  return <OverlaySheet {...props} block={block} />;
}

export function UpdateBlockingCatalogSelect<T extends string>(props: ComponentProps<typeof CatalogSelect<T>>) {
  const { block } = useUpdates();
  return <CatalogSelect {...props} block={block} />;
}

export function UpdateBlockingWorkspaceSelect(props: ComponentProps<typeof WorkspaceSelect>) {
  const { block } = useUpdates();
  return <WorkspaceSelect {...props} block={block} />;
}

export function UpdateBlockingSettingSelectField<T extends string>(props: ComponentProps<typeof SettingSelectField<T>>) {
  const { block } = useUpdates();
  return <SettingSelectField {...props} block={block} />;
}
