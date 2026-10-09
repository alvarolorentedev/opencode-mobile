import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Chip, HelperText, Switch, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { NativeSelect } from '@/components/ui/native-select';
import { TextInput } from '@/components/ui/text-input';

import { Colors } from '@/constants/theme';
import { extractPairingCode } from '@/lib/opencode/oauth';
import type { ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

export type ProviderSetupStep = 'method' | 'configure';
export type ProviderOAuthStage = 'idle' | 'pending' | 'code';

type ProviderConfigDialogProps = {
  authValues: ProviderAuthValues;
  error?: string;
  isConfiguringProvider: boolean;
  methods: ProviderAuthMethod[];
  oauthCode: string;
  oauthError?: string;
  oauthInstructions?: string;
  oauthStage: ProviderOAuthStage;
  oauthUrl?: string;
  onAuthValueChange: (key: string, value: string | number | boolean | string[]) => void;
  onBack: () => void;
  onCancelOAuth: () => void;
  onCompleteOAuth: () => void;
  onDismiss: () => void;
  onOAuthCodeChange: (code: string) => void;
  onSelectMethod: (index: number) => void;
  onSubmit: () => void;
  palette: Palette;
  providerDescription?: string;
  providerLabel: string;
  selectedMethod?: ProviderAuthMethod;
  selectedMethodIndex: number;
  step: ProviderSetupStep;
  visiblePrompts: ProviderAuthPrompt[];
};

function PromptField({ authValues, onAuthValueChange, palette, prompt }: {
  authValues: ProviderAuthValues;
  onAuthValueChange: ProviderConfigDialogProps['onAuthValueChange'];
  palette: Palette;
  prompt: ProviderAuthPrompt;
}) {
  const value = authValues[prompt.key];

  if (prompt.type === 'select') {
    return (
      <View style={styles.promptGroup}>
        <Text variant="labelLarge" style={{ color: palette.text }}>{prompt.message}</Text>
        <View style={styles.chipWrap}>
          {(prompt.options || []).map((option) => (
            <Chip key={option.value} selected={value === option.value} onPress={() => onAuthValueChange(prompt.key, option.value)}>
              {option.label}
            </Chip>
          ))}
        </View>
      </View>
    );
  }

  if (prompt.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <View style={styles.promptGroup}>
        <Text variant="labelLarge" style={{ color: palette.text }}>{prompt.message}</Text>
        <View style={styles.chipWrap}>
          {(prompt.options || []).map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <Chip
                key={option.value}
                selected={isSelected}
                onPress={() => onAuthValueChange(prompt.key, isSelected ? selected.filter((item) => item !== option.value) : [...selected, option.value])}>
                {option.label}
              </Chip>
            );
          })}
        </View>
      </View>
    );
  }

  if (prompt.type === 'boolean') {
    return (
      <View style={styles.switchRow}>
        <Text variant="labelLarge" style={[styles.switchLabel, { color: palette.text }]}>{prompt.message}</Text>
        <Switch value={Boolean(value)} onValueChange={(next) => onAuthValueChange(prompt.key, next)} />
      </View>
    );
  }

  if (prompt.type === 'external') {
    return (
      <Button mode="outlined" icon="open-in-new" onPress={() => { if (prompt.url) void Linking.openURL(prompt.url).catch(() => undefined); }}>
        {prompt.message}
      </Button>
    );
  }

  const numeric = prompt.type === 'number' || prompt.type === 'integer';
  return (
    <TextInput
      mode="outlined"
      label={prompt.message}
      placeholder={prompt.placeholder}
      keyboardType={numeric ? 'numeric' : undefined}
      value={typeof value === 'string' ? value : ''}
      onChangeText={(next) => onAuthValueChange(prompt.key, next)}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={/token|key|secret|password/i.test(prompt.key)}
    />
  );
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (value: string) => {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
  };
}

// Read-only instruction/URL text with an explicit copy affordance, so device
// and code flows do not require long-pressing to select.
function CopyText({ palette, value }: { palette: Palette; value: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <View style={[styles.copyRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text selectable variant="bodyMedium" style={[styles.copyText, { color: palette.text }]}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common:actions.copy')}
        hitSlop={8}
        onPress={() => void copy(value)}>
        <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={20} color={copied ? palette.tint : palette.muted} />
      </Pressable>
    </View>
  );
}

function PairingCode({ code, palette }: { code: string; palette: Palette }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <View style={styles.pairingGroup}>
      <Text variant="labelLarge" style={{ color: palette.muted }}>{t('settings:providers.pairingCode')}</Text>
      <View style={[styles.codeBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text selectable variant="headlineSmall" style={[styles.codeValue, { color: palette.text }]}>{code}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.copy')}
          hitSlop={8}
          onPress={() => void copy(code)}>
          <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={22} color={copied ? palette.tint : palette.muted} />
        </Pressable>
      </View>
    </View>
  );
}

function LinkActions({ palette, url }: { palette: Palette; url: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <View style={styles.linkActions}>
      <Button mode="outlined" icon="open-in-new" onPress={() => void Linking.openURL(url).catch(() => undefined)}>
        {t('settings:providers.openLink')}
      </Button>
      <Button mode="text" icon={copied ? 'check' : 'content-copy'} onPress={() => void copy(url)} textColor={palette.muted}>
        {t('settings:providers.copyLink')}
      </Button>
    </View>
  );
}

export function ProviderConfigDialog({
  authValues,
  error,
  isConfiguringProvider,
  methods,
  oauthCode,
  oauthError,
  oauthInstructions,
  oauthStage,
  oauthUrl,
  onAuthValueChange,
  onBack,
  onCancelOAuth,
  onCompleteOAuth,
  onDismiss,
  onOAuthCodeChange,
  onSelectMethod,
  onSubmit,
  palette,
  providerDescription,
  providerLabel,
  selectedMethod,
  selectedMethodIndex,
  step,
  visiblePrompts,
}: ProviderConfigDialogProps) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const isOAuth = selectedMethod?.type === 'oauth';
  const pairingCode = oauthStage === 'pending' ? extractPairingCode(oauthInstructions) : undefined;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={step === 'configure' ? onBack : onDismiss}>
      <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior="padding">
        <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
          <Appbar.BackAction
            accessibilityLabel={step === 'configure' ? t('common:actions.back') : t('settings:providers.cancelSetup')}
            onPress={step === 'configure' ? onBack : onDismiss}
          />
          <Appbar.Content title={t('settings:providers.configureProvider', { provider: providerLabel })} />
          <Appbar.Action icon="close" accessibilityLabel={t('settings:providers.cancelSetup')} onPress={onDismiss} />
        </Appbar.Header>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
          {step === 'method' ? (
            <>
              {providerDescription ? (
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{providerDescription}</Text>
              ) : null}
              <NativeSelect
                title={t('settings:providers.selectMethod')}
                onValueChange={(value) => onSelectMethod(Number(value))}
                options={methods.map((method, index) => ({ label: method.label, value: String(index) }))}
                selectedValue={String(selectedMethodIndex)}
                renderTrigger={({ open, openState }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings:providers.selectMethod')}
                    testID="provider-method-select"
                    onPress={open}
                    style={[styles.methodTrigger, { backgroundColor: palette.surface, borderColor: openState ? palette.tint : palette.border }]}>
                    <Text style={{ color: palette.text }}>{selectedMethod?.label ?? t('settings:providers.selectMethod')}</Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
                  </Pressable>
                )}
              />
            </>
          ) : (
            <>
              {providerDescription ? (
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{providerDescription}</Text>
              ) : null}

              {!selectedMethod ? (
                <HelperText type="error">{t('settings:providers.setupUnavailable')}</HelperText>
              ) : oauthStage === 'pending' ? (
                <View style={styles.centered}>
                  <ActivityIndicator />
                  <Text variant="titleSmall" style={{ color: palette.text }}>{t('settings:providers.signInTitle')}</Text>
                  {pairingCode ? <PairingCode code={pairingCode} palette={palette} /> : null}
                  {oauthInstructions ? <CopyText palette={palette} value={oauthInstructions} /> : null}
                  {oauthUrl ? <LinkActions palette={palette} url={oauthUrl} /> : null}
                  <Text variant="bodySmall" style={{ color: palette.muted, textAlign: 'center' }}>{t('settings:providers.signInPendingHint')}</Text>
                </View>
              ) : oauthStage === 'code' ? (
                <View style={styles.promptGroup}>
                  {oauthInstructions ? <CopyText palette={palette} value={oauthInstructions} /> : null}
                  {oauthUrl ? <LinkActions palette={palette} url={oauthUrl} /> : null}
                  <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:providers.authorizationCodeHint')}</Text>
                  <TextInput
                    mode="outlined"
                    label={t('settings:providers.authorizationCode')}
                    value={oauthCode}
                    onChangeText={onOAuthCodeChange}
                    autoCapitalize="none"
                    testID="provider-oauth-code-input"
                  />
                  {oauthError ? <HelperText type="error">{oauthError}</HelperText> : null}
                </View>
              ) : isOAuth ? (
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('settings:providers.oauthHint')}</Text>
              ) : (
                visiblePrompts.map((prompt) => (
                  <PromptField key={prompt.key} authValues={authValues} onAuthValueChange={onAuthValueChange} palette={palette} prompt={prompt} />
                ))
              )}

              {error ? <HelperText type="error">{error}</HelperText> : null}
            </>
          )}
        </ScrollView>

        <View style={[styles.actions, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {step === 'method' ? (
            <Button onPress={onDismiss}>{t('common:actions.cancel')}</Button>
          ) : oauthStage === 'pending' ? (
            <Button onPress={onCancelOAuth}>{t('common:actions.cancel')}</Button>
          ) : oauthStage === 'code' ? (
            <>
              <Button onPress={onCancelOAuth}>{t('common:actions.cancel')}</Button>
              <Button mode="contained" testID="provider-oauth-complete-button" disabled={!oauthCode.trim()} loading={isConfiguringProvider} onPress={onCompleteOAuth}>
                {t('settings:providers.complete')}
              </Button>
            </>
          ) : !selectedMethod ? (
            <Button onPress={onDismiss}>{t('common:actions.cancel')}</Button>
          ) : (
            <>
              <Button onPress={onDismiss}>{t('common:actions.cancel')}</Button>
              <Button mode="contained" testID="settings-provider-save-button" loading={isConfiguringProvider} onPress={onSubmit}>
                {isOAuth ? t('settings:providers.continue') : t('common:actions.save')}
              </Button>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dialogContent: { gap: 14, padding: 16 },
  actions: { borderTopWidth: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  promptGroup: { gap: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodTrigger: { minHeight: 52, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  switchLabel: { flex: 1 },
  centered: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  copyRow: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  copyText: { flex: 1 },
  pairingGroup: { alignItems: 'center', alignSelf: 'stretch', gap: 6 },
  codeBox: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  codeValue: { flex: 1, letterSpacing: 2 },
  linkActions: { alignSelf: 'stretch', alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
});
