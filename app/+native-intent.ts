// Expo Router intercepts system deep links before routing. The `expo-sharing`
// receive plugin opens the app with a `<scheme>://expo-sharing` URL after a
// share; route that to the share preview. Every other link (session, pair,
// notification) passes through unchanged.
let shareReceipt = 0;
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') {
      // Re-entering an already visible preview must ingest the new intent too.
      return `/share?receipt=${++shareReceipt}`;
    }
    return path;
  } catch {
    return path;
  }
}
