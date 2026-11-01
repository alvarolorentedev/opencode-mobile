import { useEffect, useState } from 'react';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { oidcSessionKey, type ConnectionOidc } from '@/shared/contracts/connection-oidc';
import type { OidcSessionIdentity } from '@/shared/auth/oidc/session';

// Non-interactive access-token snapshot for surfaces that cannot await (the
// terminal WebSocket upgrade builds its headers synchronously). It refreshes
// silently and re-renders when the session table changes after a token renewal.
// The session module is imported lazily so connections without OIDC never load
// the encrypted token store.
export function useOidcAccessToken(identity: OidcSessionIdentity, oidc: ConnectionOidc | undefined) {
  const key = oidc ? oidcSessionKey(getConnectionScope(identity), oidc) : '';
  const [snapshot, setSnapshot] = useState<{ key: string; token?: string }>({ key: '' });

  useEffect(() => {
    if (!oidc || !key) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const session = await import('@/shared/auth/oidc/session');
      if (cancelled) return;
      const load = () => {
        void session.getOidcAccessToken(identity, oidc).then((token) => {
          if (!cancelled) setSnapshot({ key, token });
        }).catch(() => {
          if (!cancelled) setSnapshot({ key, token: undefined });
        });
      };
      load();
      unsubscribe = session.subscribeOidcSession(load);
    })();
    return () => { cancelled = true; unsubscribe?.(); };
    // The key string covers the connection identity and provider settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, identity.serverUrl, identity.username]);

  return oidc && snapshot.key === key ? snapshot.token : undefined;
}
