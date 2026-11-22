// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

import type { SharedInput } from '@/features/sharing/state/use-share-state';
import Screen from '@/features/sharing/ui/share-screen';
import { UpdateBlockingSheet } from '@/features/updates/index';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { Button } from '@/shared/ui/button';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { deferred, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';
import { textContent } from '../../../tests/helpers/text-content';

const route = vi.hoisted(() => ({ receipt: '1', router: { dismissTo: vi.fn() } }));
vi.mock('expo-router', () => ({
  useRouter: () => route.router, usePathname: () => '/share', useLocalSearchParams: () => ({ receipt: route.receipt }),
}));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

type Element = { type: any; props: any };
const find = (root: Element, test: (node: Element) => boolean): Element | undefined => {
  if (!root || typeof root !== 'object') return;
  if (test(root)) return root;
  for (const child of [root.props?.children].flat(Infinity)) {
    const result = find(child, test); if (result) return result;
  }
};
const label = textContent;
const settings = { serverUrl: 'https://server.test', username: '', password: '', directory: '' };
const connectionScope = getConnectionScope(settings);
let runtime: ReturnType<typeof renderHook<object, ReturnType<typeof Screen>>>;
type ShareFixture = SharedInput & { addToChat: ReturnType<typeof vi.fn<SharedInput['addToChat']>> };
let shared: ShareFixture;

async function mount() {
  const id = 'share-server';
  const Shell = connectionViewProbe({} as never, true, {
    sharedInput: shared,
    initialize: (store) => store.getState().setRegistry({
      connections: [{ id, name: 'Server', enabled: true, settings, projects: ['/repo'], preferences: {} }],
      focus: { connectionId: id, projectPath: '/repo' },
    }),
  });
  runtime = renderHook(() => Screen(), {}, Shell);
  await settleReact();
}

const button = (text: string) => find(runtime.result.current, (node) => node.type === Button && label(node) === text)!;
beforeEach(() => {
  route.receipt = '1';
  route.router.dismissTo.mockReset();
  shared = {
    pending: { text: 'hello', attachments: [{ uri: 'file:///photo.png' }], skipped: [] },
    target: { sessionId: 'current', projectPath: '/repo', connectionScope },
    targets: [{ sessionId: 'current', projectPath: '/repo', connectionScope, title: 'Current' }, { sessionId: 'other', projectPath: '/other', connectionScope, title: 'Other' }],
    resolving: false, busy: false, targetsLoading: false, refreshShared: vi.fn(async () => {}), refreshTargets: vi.fn(async () => {}),
    addToChat: vi.fn(async () => false), clearShared: vi.fn(), selectTarget: vi.fn(), consumeShared: vi.fn(() => null),
  };
});
it('only navigates after a successful provider handoff and wires Change to an existing destination', async () => {
  const waiting = deferred<boolean>(); shared.addToChat.mockReturnValue(waiting.promise);
  await mount();
  act(() => button('share:change').props.onPress());
  expect(find(runtime.result.current, (node) => node.type === UpdateBlockingSheet)?.props.visible).toBe(true);
  act(() => button('Other · other').props.onPress());
  expect(shared.selectTarget).toHaveBeenCalledWith(shared.targets[1]);
  act(() => button('share:addToChat').props.onPress()); await settleReact();
  expect(route.router.dismissTo).not.toHaveBeenCalled();
  await act(async () => { waiting.resolve(true); });
  expect(route.router.dismissTo).toHaveBeenCalledWith('/(tabs)');
  runtime.unmount();
});
it('refreshes repeated native receipt routes and keeps rejected-only shares visible without Add', async () => {
  shared.pending = { attachments: [], skipped: ['large.zip'] };
  await mount();
  expect(button('share:addToChat').props.disabled).toBe(true);
  expect(shared.refreshShared).toHaveBeenCalledOnce();
  route.receipt = '2'; runtime.rerender({}); await settleReact();
  expect(shared.refreshShared).toHaveBeenCalledTimes(2);
  button('share:discard').props.onPress();
  expect(shared.clearShared).toHaveBeenCalledOnce();
  expect(route.router.dismissTo).toHaveBeenCalledWith('/(tabs)');
  runtime.unmount();
});

it('keeps the original tabs route when dismissing instead of creating another chat screen', () => {
  const { StackRouter, StackActions } = createRequire(import.meta.url)('../../../node_modules/expo-router/build/react-navigation/routers/StackRouter.js');
  const router = StackRouter({ initialRouteName: '(tabs)' });
  const options = { routeNames: ['(tabs)', 'share'], routeParamList: {}, routeGetIdList: {} };
  const initial = { key: 'root', type: 'stack', stale: false, routeNames: options.routeNames, index: 0, routeKeySeq: 1, routes: [{ key: 'tabs-0', name: '(tabs)' }] };
  const shared = router.getStateForAction(initial, StackActions.push('share'), options).state;
  const dismissed = router.getStateForAction(shared, StackActions.popTo('(tabs)'), options).state;
  expect(dismissed.routes).toEqual(initial.routes);
  const replaced = router.getStateForAction(shared, StackActions.replace('(tabs)'), options).state;
  expect(replaced.routes.at(-1).key).not.toBe(initial.routes[0].key);
});
