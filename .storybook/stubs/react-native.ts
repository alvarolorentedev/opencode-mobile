export * from 'react-native-web';

// react-native-web has no ActionSheetIOS. NativeSelect only calls it on iOS;
// the Storybook preview runs on web, so a no-op keeps the shared module graph
// loadable without changing the production component.
export const ActionSheetIOS = {
  showActionSheetWithOptions: (
    _options: unknown,
    callback: (buttonIndex: number) => void,
  ) => callback(-1),
};
