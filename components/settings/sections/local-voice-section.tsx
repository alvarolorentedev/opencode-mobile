import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';

import { type NativeSelectOption } from '@/components/ui/native-select';
import {
  LOCAL_COMMAND_MODELS,
  localCommandModelDownloadSizeLabel,
  localVoiceBaseDownloadSizeLabel,
  localVoiceDownloadSizeLabel,
} from '@/lib/voice/local-wake-word/model-constants';
import {
  LOCAL_WAKE_PHRASES,
  type LocalCommandModelId,
  type LocalVoiceModelStatus,
  type LocalWakePhraseId,
} from '@/lib/voice/local-wake-word/types';
import { DEFAULT_WAKE_PHRASE } from '@/lib/voice/wake-phrase';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

export type LocalVoiceState = {
  baseStatus: LocalVoiceModelStatus;
  clearError: () => void;
  commandStatus: LocalVoiceModelStatus;
  enrollment: {
    clearProfile: () => Promise<void>;
    enroll: () => Promise<void>;
    error?: string;
    hasProfile: boolean;
    isRecording: boolean;
    status: 'idle' | 'recording' | 'saving' | 'error';
  };
  error?: string;
  install: () => Promise<void>;
  isInstalling: boolean;
  refresh: () => void;
  remove: () => Promise<void>;
  status: LocalVoiceModelStatus;
};

function SetupStatusRow({
  done,
  label,
  palette,
  status,
}: {
  done: boolean;
  label: string;
  palette: Palette;
  status: string;
}) {
  return (
    <View style={styles.setupRow}>
      <MaterialCommunityIcons
        color={done ? palette.success : palette.muted}
        name={done ? 'check-circle' : 'circle-outline'}
        size={20}
      />
      <View style={styles.setupText}>
        <Text variant="bodyMedium" style={{ color: palette.text }}>{label}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{status}</Text>
      </View>
    </View>
  );
}

export function LocalVoiceSection({
  chatPreferences,
  localVoice,
  palette,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  localVoice: LocalVoiceState;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const localReady = localVoice.status === 'ready'
    && (!chatPreferences.localSpeakerVerification || localVoice.enrollment.hasProfile);
  const baseNeedsDownload = localVoice.baseStatus !== 'ready';
  const commandNeedsDownload = localVoice.commandStatus !== 'ready';
  const needsDownload = baseNeedsDownload || commandNeedsDownload;
  const installSizeLabel = baseNeedsDownload && commandNeedsDownload
    ? localVoiceDownloadSizeLabel(chatPreferences.localCommandModel)
    : baseNeedsDownload
      ? localVoiceBaseDownloadSizeLabel()
      : localCommandModelDownloadSizeLabel(chatPreferences.localCommandModel);
  const installLabel = baseNeedsDownload && commandNeedsDownload
    ? t('settings:voice.localWake.install', { size: installSizeLabel })
    : baseNeedsDownload
      ? t('settings:voice.localWake.installBase', { size: installSizeLabel })
      : t('settings:voice.localWake.installCommand', { size: installSizeLabel });
  const modelStatusLabel = (status: LocalVoiceModelStatus) => ({
    error: t('settings:voice.localWake.statusError'),
    installing: t('settings:voice.localWake.statusInstalling'),
    missing: t('settings:voice.localWake.statusMissing'),
    ready: t('settings:voice.localWake.statusReady'),
    unsupported: t('settings:voice.localWake.statusUnsupported'),
  }[status]);
  const localVoiceStatusLabel = localVoice.status === 'ready' && !localReady
    ? t('settings:voice.localWake.notEnrolled')
    : modelStatusLabel(localVoice.status);
  const profileStatus = localVoice.enrollment.error
    || (localVoice.enrollment.status === 'recording'
      ? t('settings:voice.localWake.recording')
      : localVoice.enrollment.status === 'saving'
        ? t('settings:voice.localWake.saving')
        : localVoice.enrollment.hasProfile
          ? t('settings:voice.localWake.enrolled')
          : localVoice.status !== 'ready'
            ? t('settings:voice.localWake.enrollRequiresModels')
            : t('settings:voice.localWake.notEnrolled'));
  const localStatusColor = localReady
    ? palette.success
    : localVoice.status === 'error'
      ? palette.danger
      : localVoice.status === 'installing'
        ? palette.tint
        : palette.warning;
  const localWakePhraseOptions: NativeSelectOption<LocalWakePhraseId>[] = (
    Object.values(LOCAL_WAKE_PHRASES)
  ).map((phrase) => ({
    label: phrase.label,
    value: phrase.id,
  }));
  const localCommandModelOptions: NativeSelectOption<LocalCommandModelId>[] = (
    Object.values(LOCAL_COMMAND_MODELS)
  ).map((model) => ({
    description: model.languages,
    label: model.label,
    value: model.id,
  }));

  return (
    <View style={[styles.localVoiceCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.localVoiceStatusRow}>
        <MaterialCommunityIcons
          color={localStatusColor}
          name={localReady ? 'check-circle' : localVoice.status === 'installing' ? 'download' : 'alert-circle-outline'}
          size={22}
        />
        <View style={styles.localVoiceStatusText}>
          <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:voice.localWake.title')}</Text>
          <Text variant="labelMedium" style={{ color: localStatusColor }}>{localVoiceStatusLabel}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {LOCAL_WAKE_PHRASES[chatPreferences.localWakePhrase].label}
            {' · '}
            {LOCAL_COMMAND_MODELS[chatPreferences.localCommandModel].label}
          </Text>
        </View>
      </View>

      <View style={styles.setupRows}>
        <SetupStatusRow
          done={localVoice.baseStatus === 'ready'}
          label={t('settings:voice.localWake.baseModels')}
          palette={palette}
          status={`${localVoice.isInstalling && localVoice.baseStatus !== 'ready' ? t('settings:voice.localWake.statusInstalling') : modelStatusLabel(localVoice.baseStatus)} · ${localVoiceBaseDownloadSizeLabel()}`}
        />
        <SetupStatusRow
          done={localVoice.commandStatus === 'ready'}
          label={t('settings:voice.localWake.commandModelLabel')}
          palette={palette}
          status={`${localVoice.isInstalling && localVoice.commandStatus !== 'ready' ? t('settings:voice.localWake.statusInstalling') : modelStatusLabel(localVoice.commandStatus)} · ${localCommandModelDownloadSizeLabel(chatPreferences.localCommandModel)}`}
        />
      </View>

      {needsDownload && (localVoice.status === 'missing' || localVoice.status === 'error' || localVoice.status === 'installing') ? (
        <Button
          disabled={localVoice.isInstalling}
          loading={localVoice.isInstalling}
          mode="contained-tonal"
          onPress={() => { void localVoice.install(); }}
        >
          {installLabel}
        </Button>
      ) : localVoice.status === 'ready' ? (
        <Button compact mode="text" onPress={() => { void localVoice.remove(); }}>
          {t('settings:voice.localWake.remove')}
        </Button>
      ) : null}

      {localVoice.status === 'unsupported' ? (
        <HelperText type="info">{t('settings:voice.localWake.unsupportedHint')}</HelperText>
      ) : null}
      {localVoice.error ? <HelperText type="error">{localVoice.error}</HelperText> : null}

      {localVoice.status !== 'unsupported' ? (
        <>
          <SettingSelectField
            disabled={localVoice.isInstalling}
            label={t('settings:voice.localWake.phraseLabel')}
            onValueChange={(value) => updateChatPreferences({ localWakePhrase: value })}
            options={localWakePhraseOptions}
            palette={palette}
            selectedValue={chatPreferences.localWakePhrase}
            valueLabel={LOCAL_WAKE_PHRASES[chatPreferences.localWakePhrase].label}
          />
          <HelperText type="info">{t('settings:voice.localWake.phraseHelper')}</HelperText>
          <SettingSelectField
            disabled={localVoice.isInstalling}
            label={t('settings:voice.localWake.commandModelLabel')}
            onValueChange={(value) => updateChatPreferences({ localCommandModel: value })}
            options={localCommandModelOptions}
            palette={palette}
            selectedValue={chatPreferences.localCommandModel}
            valueLabel={LOCAL_COMMAND_MODELS[chatPreferences.localCommandModel].label}
          />
          <HelperText type="info">{t('settings:voice.localWake.commandModelHelper')}</HelperText>

          <View style={styles.profileRow}>
            <MaterialCommunityIcons
              color={localVoice.enrollment.hasProfile ? palette.success : palette.muted}
              name={localVoice.enrollment.hasProfile ? 'account-check-outline' : 'account-outline'}
              size={22}
            />
            <View style={styles.localVoiceStatusText}>
              <Text variant="bodyMedium" style={{ color: palette.text }}>{t('settings:voice.localWake.voiceProfile')}</Text>
              <Text variant="bodySmall" style={{ color: localVoice.enrollment.error ? palette.danger : palette.muted }}>
                {profileStatus}
              </Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <Button
              disabled={localVoice.status !== 'ready' || localVoice.enrollment.isRecording || localVoice.enrollment.status === 'saving'}
              loading={localVoice.enrollment.isRecording || localVoice.enrollment.status === 'saving'}
              mode="outlined"
              onPress={() => { void localVoice.enrollment.enroll(); }}
            >
              {localVoice.enrollment.hasProfile
                ? t('settings:voice.localWake.reEnroll')
                : t('settings:voice.localWake.enroll')}
            </Button>
            {localVoice.enrollment.hasProfile ? (
              <Button compact mode="text" onPress={() => { void localVoice.enrollment.clearProfile(); }}>
                {t('settings:voice.localWake.removeVoice')}
              </Button>
            ) : null}
          </View>

          {localVoice.enrollment.hasProfile ? (
            <SettingSwitchRow
              description={t('settings:voice.localWake.speakerVerificationDescription')}
              onValueChange={(value) => updateChatPreferences({ localSpeakerVerification: value })}
              palette={palette}
              title={t('settings:voice.localWake.speakerVerification')}
              value={chatPreferences.localSpeakerVerification}
            />
          ) : null}
          <HelperText type="info">
            {t('settings:voice.localWake.fallback', {
              phrase: chatPreferences.conversationWakePhrase || DEFAULT_WAKE_PHRASE,
            })}
          </HelperText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  localVoiceCard: { borderRadius: 16, borderWidth: 1, gap: 10, padding: 14 },
  localVoiceStatusRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  localVoiceStatusText: { flex: 1, gap: 2 },
  setupRows: { gap: 10, paddingVertical: 4 },
  setupRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  setupText: { flex: 1, gap: 1 },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingTop: 4 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
