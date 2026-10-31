import { uiImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

describe('project file list', () => {
  it('defers 1,000 file rows to one list and preserves row navigation and changed-file states', async () => {
    const runtime = hookRuntime(), createdItems = vi.fn();
    const element = (type: unknown, props: any) => { if (type === 'Item') createdItems(); return { type, props }; };
    const onOpen = vi.fn(), openDirectory = vi.fn();
    const { FilesPanel } = await loadTs('features/projects/ui/files-panel.tsx', {
    ...uiImports,
    "@/shared/platform/haptics": { longPressHaptic: () => {}, selectionAsync: () => {} },
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@shopify/flash-list': { FlashList: 'FlashList' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { View: 'View' },
    "@/shared/ui/swipe-row": { SwipeRow: 'SwipeRow' },
    "@/features/projects/ui/entry-action-sheet": { EntryActionSheet: 'Sheet' },
    "@/features/projects/ui/file-clipboard-strip": { FileClipboardStrip: 'Clipboard' },
    "@/shared/ui/theme/theme": { Colors: { light: {} } },
    "@/shared/ui/theme/use-color-scheme": { useColorScheme: () => 'light' },
    "@/shared/ui/theme/use-palette": { usePalette: () => ({}) }
  });
    runtime.mount(FilesPanel, { browser: { initialized: true, path: '', entries: Array.from({ length: 1000 }, (_, i) => ({ path: `file${i}.ts`, name: `file${i}.ts`, type: i === 0 ? 'directory' : 'file' })),
      openDirectory, search: vi.fn() }, statuses: [{ path: 'file1.ts', status: 'modified' }, { path: 'removed.ts', status: 'deleted' }], projectLabel: 'Repo', onOpen });
    const list = runtime.value.props.children[1].props.children[0];
    expect(list.type).toBe('FlashList'); expect(list.props.data).toHaveLength(1003); expect(createdItems).not.toHaveBeenCalled();
    expect(list.props.keyExtractor(list.props.data[1])).not.toBe(list.props.keyExtractor(list.props.data[1001]));
    const folder = list.props.renderItem({ item: list.props.data[0] }); folder.props.children[0].props.children.props.onPress();
    expect(openDirectory).toHaveBeenCalledWith('file0.ts');
    const file = list.props.renderItem({ item: list.props.data[999] }); file.props.children[0].props.children.props.onPress();
    expect(onOpen).toHaveBeenCalledWith('file999.ts');
    const deleted = list.props.renderItem({ item: list.props.data[1002] });
    expect(deleted.props.disabled).toBe(true); expect(deleted.props.onPress).toBeUndefined();
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
    runtime.unmount();
  });
});
