import { uiImports, textContent } from '../../../tests/helpers/ui.mjs';
import { beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: any; props: any };
const element = (type: any, props: any) => ({ type, props });
const find = (root: Element, test: (node: Element) => boolean): Element | undefined => {
  if (!root || typeof root !== 'object') return;
  if (test(root)) return root;
  for (const child of [root.props?.children].flat(Infinity)) {
    const result = find(child, test); if (result) return result;
  }
};
const label = textContent;
let runtime: ReturnType<typeof hookRuntime>;
let shared: any;
let receipt: string;
let dismissTo: ReturnType<typeof vi.fn>;
async function mount() {
  const { default: Screen } = await loadTs('features/sharing/ui/share-screen.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'expo-router': { useRouter: () => ({ dismissTo }), useLocalSearchParams: () => ({ receipt }) },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { StyleSheet: { create: (value: unknown) => value }, ScrollView: 'ScrollView', Text: 'NativeText', View: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    "@/features/sharing/ui/attachment-strip": { AttachmentStrip: 'Attachments' },
    "@/features/projects/ui/project-picker": { ProjectPicker: 'ProjectPicker' },
    "@/shared/ui/overlay-sheet": { OverlaySheet: 'Sheet' },
    "@/shared/ui/theme/theme": { Colors: { light: { background: '#fff', surface: '#fff', text: '#111', muted: '#666', tint: '#080', warning: '#a60', danger: '#f00' } }, Fonts: {} },
    "@/shared/ui/theme/use-color-scheme": { useColorScheme: () => 'light' },
    "@/shared/ui/theme/use-palette": { usePalette: () => ({ background: '#fff', surface: '#fff', text: '#111', muted: '#666', tint: '#080', warning: '#a60', danger: '#f00' }) },
    "@/shared/contracts/connection-scope": { getConnectionScope: () => 's' },
    "@/features/onboarding/context": { useOnboarding: () => ({ isHydrated: true, onboardingCompleted: true }) },
    "@/features/connections/context": { useConnection: () => ({ connection: { status: 'connected' }, settings: { serverUrl: 'https://server' } }) },
    "@/features/projects/context": { useProjects: () => ({ activeProject: { path: '/repo', label: 'repo' }, projects: [], addProject() {}, selectProject() {} }) },
    "@/features/chat/context": { useChat: () => ({ sharedInput: shared }) }
  }, runtime.globals);
  runtime.mount(Screen, {}); await runtime.settle();
}
const button = (text: string) => find(runtime.value, (node) => node.type === 'Button' && label(node) === text)!;
beforeEach(() => {
  runtime = hookRuntime(); receipt = '1'; dismissTo = vi.fn();
  shared = { pending: { text: 'hello', attachments: [{ uri: 'file:///photo.png' }], skipped: [] },
    target: { sessionId: 'current', projectPath: '/repo', connectionScope: 's' },
    targets: [{ sessionId: 'current', projectPath: '/repo', connectionScope: 's', title: 'Current' }, { sessionId: 'other', projectPath: '/other', connectionScope: 's', title: 'Other' }],
    resolving: false, busy: false, targetsLoading: false, refreshShared: vi.fn(async () => {}), refreshTargets: vi.fn(async () => {}),
    addToChat: vi.fn(async () => false), clearShared: vi.fn(), selectTarget: vi.fn() };
});
it('only navigates after a successful provider handoff and wires Change to an existing destination', async () => {
  const waiting = deferred(); shared.addToChat.mockReturnValue(waiting.promise);
  await mount();
  button('share:change').props.onPress(); runtime.flush();
  expect(find(runtime.value, (node) => node.type === 'Sheet')?.props.visible).toBe(true);
  button('Other · other').props.onPress(); runtime.flush();
  expect(shared.selectTarget).toHaveBeenCalledWith(shared.targets[1]);
  button('share:addToChat').props.onPress(); await runtime.settle();
  expect(dismissTo).not.toHaveBeenCalled();
  waiting.resolve(true); await runtime.settle();
  expect(dismissTo).toHaveBeenCalledWith('/(tabs)');
  runtime.unmount();
});
it('refreshes repeated native receipt routes and keeps rejected-only shares visible without Add', async () => {
  shared.pending = { attachments: [], skipped: ['large.zip'] };
  await mount();
  expect(button('share:addToChat').props.disabled).toBe(true);
  expect(shared.refreshShared).toHaveBeenCalledOnce();
  receipt = '2'; runtime.update({}); await runtime.settle();
  expect(shared.refreshShared).toHaveBeenCalledTimes(2);
  button('share:discard').props.onPress();
  expect(shared.clearShared).toHaveBeenCalledOnce();
  expect(dismissTo).toHaveBeenCalledWith('/(tabs)');
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
