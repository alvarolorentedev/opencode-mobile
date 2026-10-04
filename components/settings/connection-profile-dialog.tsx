import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';
import { usePalette } from '@/providers/theme-provider';
import { isValidServerUrl } from '@/lib/opencode/client';

export type ConnectionProfileFormValues = {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
};

// Mounted only while open, so its form state is seeded fresh each time. The
// parent owns what happens on submit (persist a profile, apply live settings,
// optionally connect).
export function ConnectionProfileDialog({
  title,
  submitLabel,
  showName = true,
  initial,
  onSubmit,
  onDismiss,
}: {
  title: string;
  submitLabel: string;
  showName?: boolean;
  initial?: Partial<ConnectionProfileFormValues>;
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const palette = usePalette();
  const [name, setName] = useState(initial?.name ?? '');
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (submitting.current) return;
    const trimmedName = name.trim();
    const trimmedUrl = serverUrl.trim();
    if (showName && !trimmedName) {
      setError(t('settings:connection.errors.name'));
      return;
    }
    if (!trimmedUrl) {
      setError(t('settings:connection.errors.serverUrl'));
      return;
    }
    if (!isValidServerUrl(trimmedUrl)) {
      setError(t('settings:connection.errors.invalidUrl'));
      return;
    }

    setError(undefined);
    submitting.current = true;
    setSaving(true);
    try {
      await onSubmit({
        name: trimmedName,
        serverUrl: trimmedUrl,
        username: username.trim(),
        password,
      });
    } catch (submitError) {
      // Keep the dialog open with the values intact so the user can retry.
      setError(submitError instanceof Error ? submitError.message : t('settings:connection.errors.save'));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={saving ? undefined : onDismiss}>
      <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
        <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
          <Appbar.BackAction accessibilityLabel={t('common:actions.cancel')} disabled={saving} onPress={onDismiss} />
          <Appbar.Content title={title} />
        </Appbar.Header>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {showName ? (
            <TextInput
              mode="outlined"
              label={t('settings:connection.fields.name')}
              testID="connection-profile-name-input"
              value={name}
              onChangeText={setName}
              disabled={saving}
              autoFocus
            />
          ) : null}
          <TextInput
            mode="outlined"
            label={t('settings:connection.fields.serverUrl')}
            testID="connection-profile-url-input"
            value={serverUrl}
            onChangeText={setServerUrl}
            disabled={saving}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.10:4096"
          />
          <TextInput
            mode="outlined"
            label={t('settings:connection.fields.username')}
            testID="connection-profile-username-input"
            value={username}
            onChangeText={setUsername}
            disabled={saving}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            mode="outlined"
            label={t('settings:connection.fields.password')}
            testID="connection-profile-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            disabled={saving}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <HelperText testID="connection-profile-error" type="error" visible={Boolean(error)}>{error}</HelperText>
        </ScrollView>
        <View style={[styles.actions, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button testID="connection-profile-save-cancel" disabled={saving} onPress={onDismiss}>{t('common:actions.cancel')}</Button>
          <Button mode="contained" testID="connection-profile-save-confirm" loading={saving} disabled={saving} onPress={() => void handleSubmit()}>
            {submitLabel}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10 },
  actions: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
});
