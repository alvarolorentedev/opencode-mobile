// Expo Router intercepts system deep links before routing. The `expo-sharing`
// receive plugin opens the app with a `<scheme>://expo-sharing` URL after a
// share; route that to the share preview. Every other link (session, pair,
// notification) passes through unchanged.
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') {
      return '/share';
    }
    return path;
  } catch {
    return path;
  }
}
