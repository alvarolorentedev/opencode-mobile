import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { FieldDescription } from '@/shared/ui/text-field';
import { Text } from '@/shared/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServiceEditor } from '@/features/cloud-link/ui/service-editor';
import { useConnection } from '@/features/connections/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

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
    <View className={cn(stylesClasses.screen)} style={[{ backgroundColor: palette.background, paddingTop: insets.top }]}>
      <ScreenHeader className={cn("bg-surface")} safeArea={false}><Button accessibilityLabel={t('common:actions.back')} onPress={() => router.back()} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} color={palette.text} /></Button><HeaderTitle title={editing ? t('settings:services.editTitle') : t('settings:services.addTitle')} textStyle={{ color: palette.text }} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
      <KeyboardAvoidingView className={cn(stylesClasses.flex)} behavior="padding">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {missing ? (
            <View className={cn(stylesClasses.missing)}>
              <FieldDescription testID="service-missing" invalid={false}>{t('settings:services.unavailableService')}</FieldDescription>
              <Text className={cn("text-muted-foreground")}>{t('settings:services.unavailableServiceHint')}</Text>
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
  content: { gap: 4, padding: 16, width: '100%', maxWidth: 800, alignSelf: 'center' }
});

const stylesClasses = {
  "screen": "flex-1",
  "flex": "flex-1",
  "missing": "gap-2"
} as const;
