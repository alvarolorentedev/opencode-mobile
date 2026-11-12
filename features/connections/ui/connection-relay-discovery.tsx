import { ModalSurface } from '@/shared/ui/portal';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { FieldDescription } from '@/shared/ui/text-field';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/runtime/ui';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { ListRow } from '@/shared/ui/list-row';
import { normalizeServerUrl, getServerHostname } from '@/shared/contracts/server-url';
import { clearRelaySession, getRelayPassword, loadRelaySession, saveRelaySession } from '@/shared/storage/relay-session';
import type { ConnectionProfileFormValues } from '@/features/connections/ui/connection-profile-dialog';

type RelayEnvironment = {
  id: string;
  name: string;
  description: string;
  url: string;
  username: string;
  status: string;
  hostname: string;
  version: string;
  platform: string;
  tunnelHostname: string;
  deviceId: string;
  lastSeenAt: number | null;
  createdAt: number;
};

// Self-hosted relay discovery flow. The user enters their relay URL +
// credentials, we list the environments registered on that relay, and picking
// one builds a proxy URL that we hand back to the caller as a profile form
// value (same shape as the manual dialog, so save + connect work identically).
export function ConnectionRelayDiscovery({ onSubmit, onDismiss, onBusyChange }: {
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const palette = usePalette();

  const [relayUrl, setRelayUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [environments, setEnvironments] = useState<RelayEnvironment[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const requestRef = useRef(0);

  function setBusy(value: boolean) {
    onBusyChange?.(value);
  }

  function dismiss() {
    requestRef.current += 1;
    setBusy(false);
    onDismiss();
  }

  // Load the machines registered on the relay the user signed in with before.
  // The account is stored once, so discovery does not ask for credentials
  // again on every visit.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await loadRelaySession();
      if (!session) return;
      const savedPassword = await getRelayPassword();
      if (cancelled) return;
      setRelayUrl(session.relayUrl);
      setUsername(session.username);
      setPassword(savedPassword);
      if (!savedPassword) return;
      const envRes = await fetch(`${session.relayUrl}/api/environments`, {
        headers: { authorization: `Bearer ${session.token}` },
      });
      if (cancelled || !envRes.ok) return;
      const envData = await envRes.json() as { environments: RelayEnvironment[] };
      setEnvironments(envData.environments || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function discover() {
    setError(null);
    setDiscovering(true);
    setBusy(true);
    const thisRequest = ++requestRef.current;
    try {
      const base = normalizeServerUrl(relayUrl);
      if (!base.valid) {
        setError(t('settings:connection.relay.invalidUrl'));
        return;
      }
      const loginRes = await fetch(`${base.displayUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (thisRequest !== requestRef.current) return;
      if (!loginRes.ok) {
        setError(t('settings:connection.relay.loginFailed'));
        return;
      }
      const loginData = await loginRes.json() as { token: string };
      await saveRelaySession(
        { relayUrl: base.displayUrl, username: username.trim(), token: loginData.token },
        password,
      );
      const envRes = await fetch(`${base.displayUrl}/api/environments`, {
        headers: { authorization: `Bearer ${loginData.token}` },
      });
      if (thisRequest !== requestRef.current) return;
      if (!envRes.ok) {
        setError(t('settings:connection.relay.loadFailed'));
        return;
      }
      const envData = await envRes.json() as { environments: RelayEnvironment[] };
      setEnvironments(envData.environments || []);
    } catch (err) {
      if (thisRequest !== requestRef.current) return;
      setError(String((err as Error).message || err));
    } finally {
      if (thisRequest === requestRef.current) {
        setDiscovering(false);
        setBusy(false);
      }
    }
  }

  async function connectEnv(env: RelayEnvironment) {
    const base = normalizeServerUrl(relayUrl);
    if (!base.valid) return;
    setConnectingId(env.id);
    setError(null);
    setBusy(true);
    try {
      const proxyUrl = `${base.displayUrl}/api/proxy/${env.id}`;
      const values: ConnectionProfileFormValues = {
        name: env.name || getServerHostname(proxyUrl),
        serverUrl: proxyUrl,
        username: env.username || 'opencode',
        password,
        headers: {},
      };
      await onSubmit(values);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setConnectingId(null);
      setBusy(false);
    }
  }

  function reset() {
    setEnvironments([]);
    setError(null);
    setPassword('');
    void clearRelaySession();
  }

  const headerHeight = 64 + insets.top;
  const showList = environments.length > 0;

  return (
    <ModalSurface onDismiss={dismiss}>
      <View style={{ paddingTop: insets.top }} className="flex-1">
        <ScreenHeader style={{ height: headerHeight, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
          <Button variant="ghost" onPress={dismiss} testID="relay-discovery-back">
            <Icon name="arrow-left" size={20} />
          </Button>
          <HeaderTitle title={showList ? t('settings:connection.relay.environments') : t('settings:connection.relay.title')} />
          {showList ? (
            <Button variant="ghost" onPress={reset} disabled={discovering || connectingId !== null}>
              <Icon name="refresh" size={20} />
            </Button>
          ) : (
            <Button
              variant="default"
              onPress={() => void discover()}
              disabled={discovering || !relayUrl.trim() || !password.trim()}
              testID="relay-discover-button"
            >
              {discovering ? <Spinner size="small" /> : <Text>{t('settings:connection.relay.discover')}</Text>}
            </Button>
          )}
        </ScreenHeader>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, paddingTop: headerHeight }}
          className="flex-1"
        >
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} className="flex-1">
            {!showList ? (
              <View className="gap-4">
                <Text variant="body" className="text-muted-foreground">
                  {t('settings:connection.relay.description')}
                </Text>

                <View className="gap-2">
                  <SettingField
                    label={t('settings:connection.relay.url')}
                    testID="relay-url-input"
                    value={relayUrl}
                    onChangeText={setRelayUrl}
                    invalid={Boolean(error && !relayUrl.trim())}
                    autoCapitalize="none"
                    keyboardType="url"
                    placeholder={t('settings:connection.relay.urlPlaceholder')}
                    disabled={discovering}
                  />
                  <SettingField
                    label={t('settings:connection.relay.username')}
                    testID="relay-username-input"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    placeholder={t('settings:connection.relay.usernamePlaceholder')}
                    disabled={discovering}
                  />
                  <SettingField
                    label={t('settings:connection.relay.password')}
                    testID="relay-password-input"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    disabled={discovering}
                  />
                </View>

                {error ? <FieldDescription invalid>{error}</FieldDescription> : null}
              </View>
            ) : (
              <View className="gap-2">
                {environments.map((env) => {
                  const isOffline = env.status !== 'online';
                  const isConnecting = connectingId === env.id;
                  const statusColor = isOffline ? palette.muted : palette.success;
                  const statusLabel = isOffline
                    ? t('settings:connection.relay.offline')
                    : t('settings:connection.relay.online');
                  const description = [env.hostname, env.platform, env.version, statusLabel]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <ListRow
                      key={env.id}
                      accessibilityRole="button"
                      style={{ borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, minHeight: 72 }}
                      titleStyle={{ color: palette.text, fontWeight: '600' }}
                      descriptionStyle={{ color: palette.muted }}
                      testID={`relay-env-${env.id}`}
                      title={env.name}
                      description={description}
                      left={(props) => <Icon {...props} name={isOffline ? 'server-off' : 'server'} color={statusColor} />}
                      right={(props) => isConnecting ? <Spinner size="small" /> : <Icon {...props} color={palette.muted} name="chevron-right" />}
                      onPress={() => !isOffline && !isConnecting && void connectEnv(env)}
                      disabled={isOffline || isConnecting}
                      accessibilityState={{ disabled: isOffline || isConnecting }}
                    />
                  );
                })}
                {environments.length === 0 ? (
                  <Text variant="body" className="text-muted-foreground text-center py-8">
                    {t('settings:connection.relay.noEnvironments')}
                  </Text>
                ) : null}
                {error ? <FieldDescription invalid>{error}</FieldDescription> : null}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ModalSurface>
  );
}
