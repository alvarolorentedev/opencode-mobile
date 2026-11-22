// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FilesPanel } from '@/features/projects/ui/files-panel';
import { UpdatesContext } from '@/features/updates/context';
import type { UpdatesContextValue } from '@/features/updates/model/types';
import { ListRow } from '@/shared/ui/list-row';
import { ToggleGroup } from '@/shared/ui/toggle-group';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const updates = { block: () => () => {} } as UpdatesContextValue;

type Element = { type: unknown; props: any };

function find(node: unknown, type: unknown, out: Element[] = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, type, out));
    return out;
  }
  const element = node as Element;
  if (element.type === type) out.push(element);
  if (element.props?.children !== undefined) find(element.props.children, type, out);
  return out;
}

describe('project file list', () => {
  it('defers file rows, preserves navigation and separates changed files into their own view', async () => {
    const onOpen = vi.fn(), openDirectory = vi.fn();
    const browser = {
      initialized: true, path: '', entries: Array.from({ length: 1000 }, (_, i) => ({
        path: `file${i}.ts`, name: `file${i}.ts`, type: i === 0 ? 'directory' : 'file',
      })),
      openDirectory, search: vi.fn(),
    } as unknown as Parameters<typeof FilesPanel>[0]['browser'];
    const runtime = renderHook(FilesPanel, {
      browser, statuses: [{ path: 'file1.ts', status: 'modified', added: 1, removed: 1 }, { path: 'removed.ts', status: 'deleted', added: 0, removed: 1 }],
      projectLabel: 'Repo', onOpen,
    }, ({ children }) => createElement(UpdatesContext.Provider, { value: updates }, children));
    const list = find(runtime.result.current, 'FlashList')[0];
    expect(list.type).toBe('FlashList'); expect(list.props.data).toHaveLength(1000); expect(find(runtime.result.current, ListRow)).toHaveLength(0);
    expect(list.props.keyExtractor(list.props.data[0])).not.toBe(list.props.keyExtractor(list.props.data[999]));
    const folder = list.props.renderItem({ item: list.props.data[0] }); folder.props.children[0].props.children.props.onPress();
    expect(openDirectory).toHaveBeenCalledWith('file0.ts');
    const file = list.props.renderItem({ item: list.props.data[999] }); file.props.children[0].props.children.props.onPress();
    expect(onOpen).toHaveBeenCalledWith('file999.ts');
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');

    const views = find(list.props.ListHeaderComponent, ToggleGroup)[0];
    expect(views.props.value).toBe('files');
    act(() => views.props.onValueChange('changes'));
    const changes = find(runtime.result.current, 'FlashList')[0];
    expect(changes.props.data).toHaveLength(2);
    const modified = changes.props.renderItem({ item: changes.props.data[0] }).props.children[0];
    expect(modified.type).toBe(ListRow); expect(modified.props.title).toBe('file1.ts');
    const deleted = changes.props.renderItem({ item: changes.props.data[1] }).props.children[0];
    expect(deleted.props.disabled).toBe(true); expect(deleted.props.onPress).toBeUndefined();
    runtime.unmount();
  });
});
