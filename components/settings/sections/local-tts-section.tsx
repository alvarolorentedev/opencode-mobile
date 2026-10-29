import { SettingButton as Button, SettingSelectField, type Palette } from './setting-rows';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import type { NativeSelectOption } from '@/components/ui/native-select';
import { isPackLanguageCompatible, LOCAL_TTS_SYSTEM_ONLY_LANGUAGES } from '@/lib/voice/tts/catalog';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { useTtsSetup } from '@/components/settings/use-tts-setup';


export function LocalTtsSection({
  chatPreferences,
  palette,
  ttsSetup,
}: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  ttsSetup: ReturnType<typeof useTtsSetup>;
}) {
  const { t, i18n } = useTranslation();
  const activePackId = chatPreferences.ttsEngine === 'local' ? chatPreferences.localTtsPackId : undefined;
  const activePack = ttsSetup.activePack;
  const currentLanguage = (i18n.resolvedLanguage || i18n.language || '').split('-')[0];
  const showJapaneseNote = LOCAL_TTS_SYSTEM_ONLY_LANGUAGES.includes(currentLanguage)
    || LOCAL_TTS_SYSTEM_ONLY_LANGUAGES.some((code) => chatPreferences.speechLocale?.toLowerCase().startsWith(code));
  const languageMismatch = Boolean(
    activePack
    && chatPreferences.ttsEngine === 'local'
    && !isPackLanguageCompatible(activePack, chatPreferences.speechLocale),
  );
  const speakerOptions: NativeSelectOption<string>[] = activePack?.speakers.map((speaker) => ({
    label: speaker.label,
    value: String(speaker.id),
  })) ?? [];

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <MaterialCommunityIcons color={palette.tint} name="waveform" size={22} />
        <View style={styles.headingText}>
          <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.localTts.title')}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:voice.localTts.description')}</Text>
        </View>
      </View>

      {ttsSetup.error && !ttsSetup.errorPackId ? <HelperText type="error">{ttsSetup.error}</HelperText> : null}

      {ttsSetup.packs.map((pack) => {
        const status = ttsSetup.statuses[pack.id];
        const active = activePackId === pack.id && status === 'ready';
        const installing = ttsSetup.isInstallingPack === pack.id || status === 'installing';
        const statusLabel = active
          ? t('common:labels.active')
          : status === 'ready'
            ? t('settings:voice.localTts.installed')
            : status === 'installing' || installing
              ? t('settings:voice.localTts.installing')
              : status === 'unsupported'
                ? t('common:labels.unavailable')
                : t('settings:voice.localTts.notInstalled');
        const familyLabel = pack.family === 'piper'
          ? t('settings:voice.localTts.piper')
          : t('settings:voice.localTts.kokoro');
        const familyDescription = pack.family === 'piper'
          ? t('settings:voice.localTts.piperDescription')
          : t('settings:voice.localTts.kokoroDescription');

        return (
          <View
            key={pack.id}
            style={[
              styles.packCard,
              {
                backgroundColor: active ? palette.surface : palette.background,
                borderColor: active ? palette.tint : palette.border,
              },
            ]}>
            <View style={styles.packHeader}>
              <MaterialCommunityIcons
                color={active ? palette.tint : status === 'ready' ? palette.success : palette.muted}
                name={active ? 'check-circle' : pack.family === 'kokoro' ? 'creation' : 'cellphone'}
                size={22}
              />
              <View style={styles.packHeading}>
                <Text variant="bodyMedium" style={{ color: palette.text }}>
                  {pack.vendor} · {pack.languageLabel}
                </Text>
                <Text variant="bodySmall" style={{ color: palette.muted }}>
                  {familyLabel} · {familyDescription} · {ttsSetup.sizeLabel(pack.tarballBytes)}
                </Text>
                <Text variant="labelSmall" style={{ color: active ? palette.tint : palette.muted }}>{statusLabel}</Text>
              </View>
            </View>

            {ttsSetup.error && ttsSetup.errorPackId === pack.id ? (
              <HelperText type="error">{ttsSetup.error}</HelperText>
            ) : null}

            {status === 'missing' ? (
              <Button
                disabled={Boolean(ttsSetup.isInstallingPack)}
                loading={installing}
                mode="contained-tonal"
                onPress={() => { void ttsSetup.install(pack.id); }}>
                {t('settings:voice.localTts.download', { size: ttsSetup.sizeLabel(pack.tarballBytes) })}
              </Button>
            ) : null}

            {status === 'ready' && !active ? (
              <Button mode="outlined" onPress={() => { void ttsSetup.select(pack.id); }}>
                {t('settings:voice.localTts.use')}
              </Button>
            ) : null}

            {status === 'ready' ? (
              <View style={styles.actionRow}>
                <Button
                  disabled={ttsSetup.isPreviewing || installing}
                  loading={ttsSetup.isPreviewing && active}
                  mode="text"
                  onPress={() => { void ttsSetup.preview(pack.id, active ? chatPreferences.localTtsSpeakerId : 0); }}>
                  {t('settings:voice.localTts.preview')}
                </Button>
                <Button compact mode="text" onPress={() => { void ttsSetup.remove(pack.id); }}>
                  {t('common:actions.remove')}
                </Button>
              </View>
            ) : null}
          </View>
        );
      })}

      {activePack && activePack.family === 'kokoro' && chatPreferences.ttsEngine === 'local' ? (
        <SettingSelectField
          label={t('settings:voice.localTts.speaker')}
          onValueChange={(value) => ttsSetup.setSpeaker(Number(value))}
          options={speakerOptions}
          palette={palette}
          selectedValue={String(chatPreferences.localTtsSpeakerId)}
          valueLabel={activePack.speakers.find((speaker) => speaker.id === chatPreferences.localTtsSpeakerId)?.label ?? activePack.speakers[0]?.label ?? ''}
        />
      ) : null}

      {languageMismatch && activePack ? (
        <HelperText type="info">
          {t('settings:voice.localTts.languageMismatch', { language: activePack.languageLabel })}
        </HelperText>
      ) : null}

      <HelperText type="info">{t('settings:voice.localTts.downloadHint')}</HelperText>
      {showJapaneseNote ? (
        <HelperText type="info">{t('settings:voice.localTts.japaneseUnavailable')}</HelperText>
      ) : null}
      {ttsSetup.storageBytes > 0 ? (
        <HelperText type="info">
          {t('settings:voice.localTts.storage', { size: ttsSetup.sizeLabel(ttsSetup.storageBytes) })}
        </HelperText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  headingText: { flex: 1, gap: 2 },
  packCard: { borderRadius: 14, borderWidth: 1, gap: 8, padding: 12 },
  packHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  packHeading: { flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
