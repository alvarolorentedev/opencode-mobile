import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearRelaySession, listRelayEnvironments, loadRelaySession, loginToRelay, RelayApiError, saveRelaySession } from '@/features/connections/services/relay-discovery';
import type { RelayEnvironment } from '@/features/connections/model/relay';
import { useUpdateBlocker } from '@/runtime/ui';
import { ListRow } from '@/shared/ui/list-row';
import { Button } from '@/shared/ui/button';
import { FieldDescription } from '@/shared/ui/text-field';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Icon } from '@/shared/ui/icon';
import { SettingField } from '@/shared/ui/settings/setting-rows';
import { ModalSurface } from '@/shared/ui/portal';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';

function errorKey(error: unknown, phase: 'login' | 'list') {
  if (error instanceof RelayApiError && error.kind === 'invalid-url') return 'settings:connection.relay.invalidUrl';
  if (error instanceof RelayApiError && error.kind === 'authentication') return 'settings:connection.relay.loginFailed';
  return phase === 'login' ? 'settings:connection.relay.loginFailed' : 'settings:connection.relay.loadFailed';
}

export function ConnectionRelayDiscovery({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const palette = usePalette();
  const [relayUrl, setRelayUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [environments, setEnvironments] = useState<RelayEnvironment[]>([]);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  function beginRequest() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return { id: ++requestRef.current, signal: controller.signal };
  }

  function isCurrent(id: number) {
    return id === requestRef.current;
  }

  function cancelRequest() {
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  useEffect(() => {
    const request = beginRequest();
    void (async () => {
      try {
        const session = await loadRelaySession();
        if (!isCurrent(request.id)) return;
        if (!session) return;
        setRelayUrl(session.relayUrl);
        setUsername(session.username);
        setHasSavedSession(true);
        const items = await listRelayEnvironments(session, request.signal);
        if (!isCurrent(request.id)) return;
        setEnvironments(items);
        setHasLoaded(true);
      } catch (reason) {
        if (!isCurrent(request.id) || (reason instanceof RelayApiError && reason.kind === 'cancelled')) return;
        if (reason instanceof RelayApiError && reason.kind === 'authentication') {
          await clearRelaySession().catch(() => undefined);
          if (!isCurrent(request.id)) return;
          setHasSavedSession(false);
        }
        setError(t(errorKey(reason, 'list')));
      } finally {
        if (isCurrent(request.id)) {
          setRestoring(false);
          controllerRef.current = null;
        }
      }
    })();
    return cancelRequest;
  }, [t]);

  async function discover() {
    setError(null);
    setDiscovering(true);
    setHasLoaded(false);
    const request = beginRequest();
    let phase: 'login' | 'list' = 'login';
    try {
      const session = await loginToRelay(relayUrl, username, password, request.signal);
      if (!isCurrent(request.id)) return;
      await saveRelaySession(session);
      if (!isCurrent(request.id)) return;
      setHasSavedSession(true);
      setPassword('');
      phase = 'list';
      const items = await listRelayEnvironments(session, request.signal);
      if (!isCurrent(request.id)) return;
      setEnvironments(items);
      setHasLoaded(true);
    } catch (reason) {
      if (!isCurrent(request.id) || (reason instanceof RelayApiError && reason.kind === 'cancelled')) return;
      if (reason instanceof RelayApiError && reason.kind === 'authentication' && phase === 'list') {
        await clearRelaySession().catch(() => undefined);
        if (!isCurrent(request.id)) return;
        setHasSavedSession(false);
        setPassword('');
      }
      setError(t(errorKey(reason, phase)));
    } finally {
      if (isCurrent(request.id)) {
        setDiscovering(false);
        controllerRef.current = null;
      }
    }
  }

  async function signOut() {
    cancelRequest();
    setDiscovering(false);
    setRestoring(false);
    try {
      await clearRelaySession();
      setRelayUrl('');
      setUsername('');
      setPassword('');
      setError(null);
      setHasSavedSession(false);
      setHasLoaded(false);
      setEnvironments([]);
    } catch {
      setError(t('settings:connection.relay.loadFailed'));
    }
  }

  async function refreshEnvironments() {
    setError(null);
    setRestoring(true);
    const request = beginRequest();
    try {
      const session = await loadRelaySession();
      if (!isCurrent(request.id)) return;
      if (!session) {
        setHasSavedSession(false);
        setHasLoaded(false);
        return;
      }
      const items = await listRelayEnvironments(session, request.signal);
      if (!isCurrent(request.id)) return;
      setEnvironments(items);
      setHasLoaded(true);
    } catch (reason) {
      if (!isCurrent(request.id) || (reason instanceof RelayApiError && reason.kind === 'cancelled')) return;
      if (reason instanceof RelayApiError && reason.kind === 'authentication') {
        await clearRelaySession().catch(() => undefined);
        if (!isCurrent(request.id)) return;
        setHasSavedSession(false);
        setPassword('');
      }
      setHasLoaded(false);
      setError(t(errorKey(reason, 'list')));
    } finally {
      if (isCurrent(request.id)) {
        setRestoring(false);
        controllerRef.current = null;
      }
    }
  }

  function dismiss() {
    cancelRequest();
    onDismiss();
  }

  const headerHeight = 64 + insets.top;
  const busy = discovering || restoring;

  return (
    <ModalSurface onDismiss={dismiss}>
      <View style={{ paddingTop: insets.top }} className="flex-1">
        <ScreenHeader style={{ height: headerHeight, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
          <Button variant="ghost" onPress={dismiss} testID="relay-discovery-back" accessibilityLabel={t('common:actions.back')}>
            <Icon name="arrow-left" size={20} />
          </Button>
          <HeaderTitle title={hasLoaded ? t('settings:connection.relay.environments') : t('settings:connection.relay.title')} />
          {hasSavedSession ? (
            <>
              <Button variant="ghost" onPress={() => void refreshEnvironments()} disabled={busy} accessibilityLabel={t('settings:connection.relay.discover')}>
                <Icon name="refresh" size={20} />
              </Button>
              <Button variant="ghost" onPress={() => void signOut()} disabled={busy} accessibilityLabel={t('settings:connection.relay.signOut')}>
                <Icon name="logout" size={20} />
              </Button>
            </>
          ) : (
            <Button variant="default" onPress={() => void discover()} disabled={busy || !relayUrl.trim() || !username.trim() || !password} testID="relay-discover-button">
              {busy ? <Spinner size="small" /> : <Text>{t('settings:connection.relay.discover')}</Text>}
            </Button>
          )}
        </ScreenHeader>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, paddingTop: headerHeight }} className="flex-1">
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} className="flex-1">
            {restoring ? <Spinner size="small" /> : null}
            {!hasLoaded ? (
              <View className="gap-4">
                <Text variant="body" className="text-muted-foreground">{t('settings:connection.relay.description')}</Text>
                <View className="gap-2">
                  <SettingField label={t('settings:connection.relay.url')} testID="relay-url-input" value={relayUrl} onChangeText={setRelayUrl} invalid={Boolean(error && !relayUrl.trim())} autoCapitalize="none" keyboardType="url" placeholder={t('settings:connection.relay.urlPlaceholder')} disabled={busy} />
                  <SettingField label={t('settings:connection.relay.username')} testID="relay-username-input" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder={t('settings:connection.relay.usernamePlaceholder')} disabled={busy} />
                  <SettingField label={t('settings:connection.relay.password')} testID="relay-password-input" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" disabled={busy} />
                </View>
                {error ? <FieldDescription invalid>{error}</FieldDescription> : null}
              </View>
            ) : environments.length === 0 ? (
              <Text variant="body" className="text-muted-foreground text-center py-8">{t('settings:connection.relay.noEnvironments')}</Text>
            ) : (
              <View className="gap-2">
                {environments.map((env) => {
                  const isOnline = env.status === 'online';
                  const statusColor = isOnline ? palette.success : palette.muted;
                  const statusLabel = isOnline ? t('settings:connection.relay.online') : t('settings:connection.relay.offline');
                  const description = [env.hostname, env.platform, env.version, statusLabel].filter(Boolean).join(' · ');
                  return (
                    <ListRow key={env.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, minHeight: 72 }} titleStyle={{ color: palette.text, fontWeight: '600' }} descriptionStyle={{ color: palette.muted }} testID={`relay-env-${env.id}`} title={env.name} description={description} left={(props) => <Icon {...props} name={isOnline ? 'server' : 'server-off'} color={statusColor} />} />
                  );
                })}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ModalSurface>
  );
}
