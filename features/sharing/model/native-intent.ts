// Expo Router intercepts system deep links before routing. The `expo-sharing`
// receive plugin opens the app with a `<scheme>://expo-sharing` URL after a
// share; route that to the share preview. OpenID Connect sign-in returns to
// `<scheme>://oidc-callback`; send it back to the screen that opened the system
// browser so the connection form survives the round trip. Every other link
// (session, pair, notification) passes through unchanged.
import { isValidOidcRedirectUri } from '@/shared/contracts/connection-oidc';
import { getSystemPath } from '@/shared/platform/system-path';


let shareReceipt = 0;
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // React Native's URL.hostname only parses HTTP(S), not custom app schemes.
  if (/^[a-z][a-z\d+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path)) {
    // Re-entering an already visible preview must ingest the new intent too.
    return `/share?receipt=${++shareReceipt}`;
  }
  if (isValidOidcRedirectUri(path.split(/[?#]/, 1)[0])) return getSystemPath();
  return path;
}
