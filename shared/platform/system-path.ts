// Records the route the app is showing so a system-browser redirect (the
// OpenID Connect callback) can return to it. Expo Router sends native intent
// URLs through `+native-intent` before routing; without this, the callback path
// would land on an unmatched route and the connection form would disappear.
let currentPath = '/';

export function setSystemPath(path: string) {
  if (path && path.startsWith('/')) currentPath = path;
}

export function getSystemPath() {
  return currentPath;
}
