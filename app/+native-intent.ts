// Expo Router intercepts system deep links before routing. The `expo-sharing`
// receive plugin opens the app with a `<scheme>://expo-sharing` URL after a
// share; route that to the share preview. Every other link (session, pair,
// notification) passes through unchanged.
let shareReceipt = 0;
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // React Native's URL.hostname only parses HTTP(S), not custom app schemes.
  if (/^[a-z][a-z\d+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path)) {
    // Re-entering an already visible preview must ingest the new intent too.
    return `/share?receipt=${++shareReceipt}`;
  }
  return path;
}
