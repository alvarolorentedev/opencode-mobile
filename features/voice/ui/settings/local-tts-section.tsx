import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { Icon } from '@/shared/ui/icon';
import { FieldDescription } from '@/shared/ui/text-field';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { isPackLanguageCompatible, LOCAL_TTS_SYSTEM_ONLY_LANGUAGES } from '@/shared/platform/voice/tts/catalog';
import type { LocalTtsPackId } from '@/shared/platform/voice/tts/types';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { useTtsSetup } from '@/features/voice/ui/use-tts-setup';
import { SettingSelectField, type Palette } from '@/shared/ui/settings/setting-rows';

export function LocalTtsSection({ chatPreferences, initialPackId, onSelected, palette, ttsSetup }: {
  chatPreferences: ChatPreferences; initialPackId?: LocalTtsPackId; onSelected: () => void;
  palette: Palette; ttsSetup: ReturnType<typeof useTtsSetup>;
}) {
  const { t, i18n } = useTranslation();
  const [packId, setPackId] = useState(initialPackId ?? ttsSetup.activePack?.id ?? ttsSetup.packs[0].id);
  const pack = ttsSetup.packs.find((item) => item.id === packId)!;
  const status = ttsSetup.statuses[packId];
  const installing = Boolean(ttsSetup.isInstallingPack);
  const size = ttsSetup.sizeLabel(pack.tarballBytes);
  const mismatch = !isPackLanguageCompatible(pack, chatPreferences.speechLocale);
  const japanese = LOCAL_TTS_SYSTEM_ONLY_LANGUAGES.some((code) => (chatPreferences.speechLocale || i18n.resolvedLanguage || i18n.language).toLowerCase().startsWith(code));
  return <View className={cn(stylesClasses.section)}>
    <Text className={cn("text-muted-foreground")} variant="body">{t('settings:voice.localTts.description')}</Text>
    <SettingSelectField compact label={t('settings:voice.localTts.title')} palette={palette} disabled={installing} selectedValue={packId} valueLabel={`${pack.vendor} · ${pack.languageLabel}`}
      options={ttsSetup.packs.map((item) => ({ value: item.id, label: `${item.vendor} · ${item.languageLabel}`, description: `${ttsSetup.sizeLabel(item.tarballBytes)} · ${t(ttsSetup.statuses[item.id] === 'ready' ? 'settings:voice.localTts.installed' : 'settings:voice.localTts.notInstalled')}` }))}
      onValueChange={setPackId} />
    <Text className={cn("text-foreground")} variant="description">{t(status === 'ready' ? 'settings:voice.localTts.installed' : status === 'unsupported' ? 'common:labels.unavailable' : installing ? 'settings:voice.localTts.installing' : 'settings:voice.localTts.notInstalled')}{' '}· {size}</Text>
    <Text className={cn("text-muted-foreground")} variant="description">{t(pack.family === 'piper' ? 'settings:voice.localTts.piperDescription' : 'settings:voice.localTts.kokoroDescription')}</Text>
    {status === 'missing' || status === 'installing' ? <Button disabled={installing} onPress={() => void ttsSetup.install(packId)} variant="default">{installing ? <Spinner size="small" /> : null}<Text>{t('settings:voice.localTts.download', { size })}</Text></Button> : null}
    {status === 'ready' ? <>
      <Button disabled={installing} onPress={async () => { await ttsSetup.select(packId); onSelected(); }} variant="default"><Text>{t('settings:voice.localTts.use')}</Text></Button>
      <View className={cn(stylesClasses.actions)}>
        <Button disabled={ttsSetup.isPreviewing} onPress={() => void ttsSetup.preview(packId, packId === chatPreferences.localTtsPackId ? chatPreferences.localTtsSpeakerId : 0)} variant="outline">{ttsSetup.isPreviewing ? <Spinner size="small" /> : null}<Icon name={"play"} size={20} /><Text>{t('settings:voice.localTts.preview')}</Text></Button>
        <Button disabled={installing} onPress={() => void ttsSetup.remove(packId)} variant="ghost"><Text>{t('common:actions.remove')}</Text></Button>
      </View>
    </> : null}
    {ttsSetup.error ? <FieldDescription accessibilityLiveRegion="polite" invalid={true}>{ttsSetup.error}</FieldDescription> : null}
    {mismatch ? <FieldDescription  invalid={false}>{t('settings:voice.localTts.languageMismatch', { language: pack.languageLabel })}</FieldDescription> : null}
    {japanese ? <FieldDescription  invalid={false}>{t('settings:voice.localTts.japaneseUnavailable')}</FieldDescription> : null}
    <Text className={cn("text-muted-foreground")} variant="label">{t('settings:voice.localTts.downloadHint')}</Text>
    {ttsSetup.storageBytes > 0 ? <Text className={cn("text-muted-foreground")} variant="label">{t('settings:voice.localTts.storage', { size: ttsSetup.sizeLabel(ttsSetup.storageBytes) })}</Text> : null}
  </View>;
}

const stylesClasses = {
  "section": "gap-4",
  "actions": "flex-row flex-wrap gap-2"
} as const;
