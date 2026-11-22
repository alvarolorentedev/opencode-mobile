// Native host components are inert in a render-hook probe. State, component
// composition and effects still run through React and the production hooks.
export function nativeViewPlatform(state: { platform: string; width?: number; height?: number }) {
  return {
    Platform: {
      get OS() { return state.platform; },
      select: (options: Record<string, unknown>) => options[state.platform] ?? options.native ?? options.default,
    },
    StyleSheet: {
      create: (styles: object) => styles,
      flatten: (styles: object | object[]) => Array.isArray(styles) ? Object.assign({}, ...styles) : styles,
      hairlineWidth: 1,
      absoluteFill: { position: 'absolute', top: 0, bottom: 0, right: 0, left: 0 },
    },
    useWindowDimensions: () => ({ width: state.width ?? 390, height: state.height ?? 844, fontScale: 1, scale: 1 }),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) },
    Linking: { openURL: async () => undefined },
    ActivityIndicator: 'ActivityIndicator',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Switch: 'Switch',
    Text: 'Text',
    TextInput: 'TextInput',
    Image: 'Image',
    View: 'View',
  };
}
