import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { isPackLanguageCompatible, LOCAL_TTS_SYSTEM_ONLY_LANGUAGES } from '@/lib/voice/tts/catalog';
import type { LocalTtsPackId } from '@/lib/voice/tts/types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { useTtsSetup } from '@/components/settings/use-tts-setup';
import { SettingButton as Button, SettingSelectField, type Palette } from './setting-rows';

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
  return <View style={styles.section}>
    <Text variant="bodyLarge" style={{ color: palette.muted }}>{t('settings:voice.localTts.description')}</Text>
    <SettingSelectField compact label={t('settings:voice.localTts.title')} palette={palette} disabled={installing} selectedValue={packId} valueLabel={`${pack.vendor} · ${pack.languageLabel}`}
      options={ttsSetup.packs.map((item) => ({ value: item.id, label: `${item.vendor} · ${item.languageLabel}`, description: `${ttsSetup.sizeLabel(item.tarballBytes)} · ${t(ttsSetup.statuses[item.id] === 'ready' ? 'settings:voice.localTts.installed' : 'settings:voice.localTts.notInstalled')}` }))}
      onValueChange={setPackId} />
    <Text variant="bodyMedium" style={{ color: palette.text }}>{t(status === 'ready' ? 'settings:voice.localTts.installed' : status === 'unsupported' ? 'common:labels.unavailable' : installing ? 'settings:voice.localTts.installing' : 'settings:voice.localTts.notInstalled')} · {size}</Text>
    <Text variant="bodyMedium" style={{ color: palette.muted }}>{t(pack.family === 'piper' ? 'settings:voice.localTts.piperDescription' : 'settings:voice.localTts.kokoroDescription')}</Text>
    {status === 'missing' || status === 'installing' ? <Button mode="contained" loading={installing} disabled={installing} onPress={() => void ttsSetup.install(packId)}>{t('settings:voice.localTts.download', { size })}</Button> : null}
    {status === 'ready' ? <>
      <Button mode="contained" disabled={installing} onPress={async () => { await ttsSetup.select(packId); onSelected(); }}>{t('settings:voice.localTts.use')}</Button>
      <View style={styles.actions}>
        <Button icon="play" mode="outlined" loading={ttsSetup.isPreviewing} disabled={ttsSetup.isPreviewing} onPress={() => void ttsSetup.preview(packId, packId === chatPreferences.localTtsPackId ? chatPreferences.localTtsSpeakerId : 0)}>{t('settings:voice.localTts.preview')}</Button>
        <Button disabled={installing} onPress={() => void ttsSetup.remove(packId)}>{t('common:actions.remove')}</Button>
      </View>
    </> : null}
    {ttsSetup.error ? <HelperText type="error" accessibilityLiveRegion="polite">{ttsSetup.error}</HelperText> : null}
    {mismatch ? <HelperText type="info">{t('settings:voice.localTts.languageMismatch', { language: pack.languageLabel })}</HelperText> : null}
    {japanese ? <HelperText type="info">{t('settings:voice.localTts.japaneseUnavailable')}</HelperText> : null}
    <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:voice.localTts.downloadHint')}</Text>
    {ttsSetup.storageBytes > 0 ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:voice.localTts.storage', { size: ttsSetup.sizeLabel(ttsSetup.storageBytes) })}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 16 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
