

export async function openOAuthBrowser(url: string) {
  const browser = await import('expo-web-browser');
  return browser.openBrowserAsync(url);
}
