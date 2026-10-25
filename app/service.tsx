import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServiceEditor } from '@/components/settings/service-editor';
import { useConnection } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

// Full-screen add/edit route for one connector service. The services domain
// (target machine, credentials, connector revision) stays in the provider; this
// screen only wires the route to the shared editor.
export default function ServiceScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { connectSetup, services } = useConnection();
  if (!connectSetup.enabled) return null;
  const editing = params.id ? services.services.find((service) => service.id === params.id) : undefined;
  const missing = Boolean(params.id) && !editing;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <Appbar.Header style={{ backgroundColor: palette.surface }} statusBarHeight={0} elevated>
        <Appbar.BackAction accessibilityLabel={t('common:actions.back')} onPress={() => router.back()} color={palette.text} />
        <Appbar.Content titleMaxFontSizeMultiplier={1.5} titleStyle={{ color: palette.text }} title={editing ? t('settings:services.editTitle') : t('settings:services.addTitle')} />
      </Appbar.Header>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {missing ? (
            <View style={styles.missing}>
              <HelperText testID="service-missing" type="info">{t('settings:services.unavailableService')}</HelperText>
              <Text style={{ color: palette.muted }}>{t('settings:services.unavailableServiceHint')}</Text>
            </View>
          ) : (
            <ServiceEditor api={services} editing={editing} palette={palette} onDone={() => router.back()} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { gap: 4, padding: 16, width: '100%', maxWidth: 800, alignSelf: 'center' },
  missing: { gap: 8 },
});
