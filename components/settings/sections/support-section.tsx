import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { SettingTarget } from '../settings-panel';
import * as Linking from 'expo-linking';
import * as StoreReview from 'expo-store-review';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { canRateApp, FEEDBACK_URL, hasPlayStoreRating, PLAY_STORE_URL, SUPPORT_URL } from '@/lib/support';
import { Palette } from './setting-rows';

function open(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

async function requestReview() {
  const available = await StoreReview.hasAction().catch(() => false);
  if (!available) {
    if (hasPlayStoreRating()) open(PLAY_STORE_URL);
    return;
  }

  await StoreReview.requestReview().catch(() => {
    if (hasPlayStoreRating()) open(PLAY_STORE_URL);
  });
}

export function SupportSection({ palette }: { palette: Palette }) {
  const { t } = useTranslation();
  return (
    <View className={cn(stylesClasses.section)}>
      <Text className={cn("text-muted-foreground")} variant="description">OpenCode Mobile {Application.nativeApplicationVersion ?? Constants.expoConfig?.version}</Text>
      <Text className={cn(stylesClasses.title, "text-foreground")} variant="description">{t('settings:support.title')}</Text>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:support.description')}</Text>
      {canRateApp() ? (
        <Button onPress={() => void requestReview()} variant="default"><Icon name={"star"} size={20} /><Text>{t('settings:support.rate')}</Text></Button>
      ) : null}
      <SettingTarget label={t('settings:support.feedback')}><Button onPress={() => open(FEEDBACK_URL)} variant="outline"><Icon name={"message-text-outline"} size={20} /><Text>{t('settings:support.feedback')}</Text></Button></SettingTarget>
      <SettingTarget label={t('settings:support.openSupport')}><Button onPress={() => open(SUPPORT_URL)} variant="outline"><Icon name={"open-in-new"} size={20} /><Text>{t('settings:support.openSupport')}</Text></Button></SettingTarget>
    </View>
  );
}



const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "title": "font-semibold"
} as const;
