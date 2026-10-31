import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWatch, useForm, useController, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { initialAuthValues, providerAuthSchema, visibleAuthPrompts } from './forms/provider-auth-schema';
import { SettingField } from '@/components/settings/sections/setting-rows';
import { ModalSurface } from '@/components/ui/portal';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Icon } from '@/components/ui/icon';
import { FieldDescription } from '@/components/ui/text-field';
import { HeaderTitle, ScreenHeader } from '@/components/ui/screen-header';
import { Spinner } from '@/components/ui/spinner';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { CatalogSelect } from '@/components/ui/catalog-select';


import { Colors } from '@/constants/theme';
import { extractPairingCode } from '@/lib/opencode/oauth';
import type { ProviderAuthMethod, ProviderAuthPrompt, ProviderAuthValues } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

export type ProviderSetupStep = 'method' | 'configure';
export type ProviderOAuthStage = 'idle' | 'pending' | 'code';

type ProviderConfigDialogProps = {
  error?: string;
  isConfiguringProvider: boolean;
  methods: ProviderAuthMethod[];
  oauthCode: string;
  oauthError?: string;
  oauthInstructions?: string;
  oauthStage: ProviderOAuthStage;
  oauthUrl?: string;
  onBack: () => void;
  onCancelOAuth: () => void;
  onCompleteOAuth: () => void;
  onDismiss: () => void;
  onOAuthCodeChange: (code: string) => void;
  onSelectMethod: (index: number) => void;
  onSubmit: (values: ProviderAuthValues) => void;
  palette: Palette;
  providerDescription?: string;
  providerLabel: string;
  selectedMethod?: ProviderAuthMethod;
  selectedMethodIndex: number;
  step: ProviderSetupStep;
};

function PromptField({ control, palette, prompt }: {
  control: Control<ProviderAuthValues>; palette: Palette; prompt: ProviderAuthPrompt;
}) {
  const { field: { value, onChange, onBlur, ref: inputRef }, fieldState } = useController({ control, name: prompt.key });
  const onAuthValueChange = (_key: string, value: string | number | boolean | string[]) => onChange(value);
  if (prompt.type === 'select' || prompt.type === 'multiselect') {
    return <View className={cn(stylesClasses.promptGroup)}>
      <Text variant="description">{prompt.message}</Text>
      {prompt.type === 'select' ? <ToggleGroup type="single" value={typeof value === 'string' ? value : undefined} onValueChange={(next) => { if (next) onChange(next); }} className="flex-row flex-wrap">
        {(prompt.options ?? []).map((option) => <ToggleGroupItem key={option.value} value={option.value}><Text>{option.label}</Text></ToggleGroupItem>)}
      </ToggleGroup> : <ToggleGroup type="multiple" value={Array.isArray(value) ? value : []} onValueChange={onChange} className="flex-row flex-wrap">
        {(prompt.options ?? []).map((option) => <ToggleGroupItem key={option.value} value={option.value}><Text>{option.label}</Text></ToggleGroupItem>)}
      </ToggleGroup>}
    </View>;
  }

  if (prompt.type === 'boolean') {
    return (
      <View className={cn(stylesClasses.switchRow)}>
        <Text className={cn(stylesClasses.switchLabel, "text-foreground")} variant="description">{prompt.message}</Text>
        <Switch accessibilityLabel={prompt.message} checked={Boolean(value)} onCheckedChange={(next) => onAuthValueChange(prompt.key, next)}></Switch>
      </View>
    );
  }

  if (prompt.type === 'external') {
    return (
      <Button onPress={() => { if (prompt.url) void Linking.openURL(prompt.url).catch(() => undefined); }} variant="outline"><Icon name={"open-in-new"} size={20} /><Text>{prompt.message}</Text></Button>
    );
  }

  const numeric = prompt.type === 'number' || prompt.type === 'integer';
  return (
    <SettingField ref={inputRef} onBlur={onBlur} invalid={fieldState.invalid} label={prompt.message} placeholder={prompt.placeholder} keyboardType={numeric ? 'numeric' : undefined} value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''} onChangeText={(next) => onAuthValueChange(prompt.key, next)} autoCapitalize="none" autoCorrect={false} secureTextEntry={/token|key|secret|password/i.test(prompt.key)}></SettingField>
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
    <View className={cn(stylesClasses.copyRow, "bg-surface border-border")}>
      <Text selectable className={cn(stylesClasses.copyText, "text-foreground")} variant="description">{value}</Text>
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
    <View className={cn(stylesClasses.pairingGroup)}>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:providers.pairingCode')}</Text>
      <View className={cn(stylesClasses.codeBox, "bg-surface border-border")}>
        <Text selectable className={cn(stylesClasses.codeValue, "text-foreground")} variant="display">{code}</Text>
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
    <View className={cn(stylesClasses.linkActions)}>
      <Button onPress={() => void Linking.openURL(url).catch(() => undefined)} variant="outline"><Icon name={"open-in-new"} size={20} /><Text>{t('settings:providers.openLink')}</Text></Button>
      <Button onPress={() => void copy(url)} variant="ghost"><Icon name={copied ? 'check' : 'content-copy'} size={20} color={palette.muted} /><Text className={cn("text-muted-foreground")} >{t('settings:providers.copyLink')}</Text></Button>
    </View>
  );
}

export function ProviderConfigDialog({
  error,
  isConfiguringProvider,
  methods,
  oauthCode,
  oauthError,
  oauthInstructions,
  oauthStage,
  oauthUrl,
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
}: ProviderConfigDialogProps) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const form = useForm<ProviderAuthValues>({ defaultValues: initialAuthValues(selectedMethod), resolver: zodResolver(providerAuthSchema(selectedMethod?.prompts ?? [])), shouldUnregister: false, mode: 'onSubmit', reValidateMode: 'onChange' });
  const authValues = useWatch({ control: form.control, compute: (values) => values });
  const visiblePrompts = visibleAuthPrompts(selectedMethod?.prompts ?? [], authValues);
  const isOAuth = selectedMethod?.type === 'oauth';
  const pairingCode = oauthStage === 'pending' ? extractPairingCode(oauthInstructions) : undefined;

  return (
    <ModalSurface accessibilityLabel={t('settings:providers.configureProvider', { provider: providerLabel })} visible animationType="slide" presentationStyle="fullScreen" onRequestClose={step === 'configure' ? onBack : onDismiss}>
      <KeyboardAvoidingView className={cn(stylesClasses.screen, "bg-background")} behavior="padding">
        <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }} safeArea={false}><Button accessibilityLabel={step === 'configure' ? t('common:actions.back') : t('settings:providers.cancelSetup')} onPress={step === 'configure' ? onBack : onDismiss} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} /></Button><HeaderTitle title={t('settings:providers.configureProvider', { provider: providerLabel })} maxFontSizeMultiplier={1.5}></HeaderTitle><Button accessibilityLabel={t('settings:providers.cancelSetup')} onPress={onDismiss} variant="ghost" size="icon"><Icon name={"close"} size={24} /></Button></ScreenHeader>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
          {step === 'method' ? (
            <>
              {providerDescription ? (
                <Text className={cn("text-muted-foreground")} variant="description">{providerDescription}</Text>
              ) : null}
              <CatalogSelect
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
                    className={cn(stylesClasses.methodTrigger)} style={[{ backgroundColor: palette.surface, borderColor: openState ? palette.tint : palette.border }]}>
                    <Text className={cn("text-foreground")}>{selectedMethod?.label ?? t('settings:providers.selectMethod')}</Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
                  </Pressable>
                )}
              />
            </>
          ) : (
            <>
              {providerDescription ? (
                <Text className={cn("text-muted-foreground")} variant="description">{providerDescription}</Text>
              ) : null}

              {!selectedMethod ? (
                <FieldDescription  invalid={true}>{t('settings:providers.setupUnavailable')}</FieldDescription>
              ) : oauthStage === 'pending' ? (
                <View className={cn(stylesClasses.centered)}>
                  <Spinner />
                  <Text className={cn("text-foreground")} variant="description">{t('settings:providers.signInTitle')}</Text>
                  {pairingCode ? <PairingCode code={pairingCode} palette={palette} /> : null}
                  {oauthInstructions ? <CopyText palette={palette} value={oauthInstructions} /> : null}
                  {oauthUrl ? <LinkActions palette={palette} url={oauthUrl} /> : null}
                  <Text className={cn("text-muted-foreground text-center")} variant="label">{t('settings:providers.signInPendingHint')}</Text>
                </View>
              ) : oauthStage === 'code' ? (
                <View className={cn(stylesClasses.promptGroup)}>
                  {oauthInstructions ? <CopyText palette={palette} value={oauthInstructions} /> : null}
                  {oauthUrl ? <LinkActions palette={palette} url={oauthUrl} /> : null}
                  <Text className={cn("text-muted-foreground")} variant="label">{t('settings:providers.authorizationCodeHint')}</Text>
                  <SettingField label={t('settings:providers.authorizationCode')} value={oauthCode} onChangeText={onOAuthCodeChange} autoCapitalize="none" testID="provider-oauth-code-input"></SettingField>
                  {oauthError ? <FieldDescription  invalid={true}>{oauthError}</FieldDescription> : null}
                </View>
              ) : isOAuth ? (
                <Text className={cn("text-muted-foreground")} variant="description">{t('settings:providers.oauthHint')}</Text>
              ) : (
                visiblePrompts.map((prompt) => (
                  <View key={prompt.key}><PromptField control={form.control} palette={palette} prompt={prompt} />{form.formState.errors[prompt.key]?.message ? <FieldDescription invalid>{t(form.formState.errors[prompt.key]!.message!)}</FieldDescription> : null}</View>
                ))
              )}

              {error ? <FieldDescription  invalid={true}>{error}</FieldDescription> : null}
            </>
          )}
        </ScrollView>

        <View className={cn(stylesClasses.actions)} style={[{ backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {step === 'method' ? (
            <Button onPress={onDismiss} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
          ) : oauthStage === 'pending' ? (
            <Button onPress={onCancelOAuth} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
          ) : oauthStage === 'code' ? (
            <>
              <Button onPress={onCancelOAuth} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
              <Button testID="provider-oauth-complete-button" disabled={!oauthCode.trim()} onPress={onCompleteOAuth} variant="default">{isConfiguringProvider ? <Spinner size="small" /> : null}<Text>{t('settings:providers.complete')}</Text></Button>
            </>
          ) : !selectedMethod ? (
            <Button onPress={onDismiss} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
          ) : (
            <>
              <Button onPress={onDismiss} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
              <Button disabled={isConfiguringProvider} testID="settings-provider-save-button" onPress={() => { void form.handleSubmit(onSubmit)(); }} variant="default">{isConfiguringProvider ? <Spinner size="small" /> : null}<Text>{isOAuth ? t('settings:providers.continue') : t('common:actions.save')}</Text></Button>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </ModalSurface>
  );
}

const styles = StyleSheet.create({
  dialogContent: { gap: 14, padding: 16 }
});

const stylesClasses = {
  "promptGroup": "gap-2",
  "switchRow": "flex-row items-center justify-between gap-3",
  "switchLabel": "flex-1",
  "copyRow": "items-center self-stretch rounded-[12px] border flex-row gap-3 px-3.5 py-3",
  "copyText": "flex-1",
  "pairingGroup": "items-center self-stretch gap-1.5",
  "codeBox": "items-center self-stretch rounded-[12px] border flex-row gap-3 justify-between px-4 py-3.5",
  "codeValue": "flex-1 tracking-[2px]",
  "linkActions": "self-stretch items-center flex-row flex-wrap gap-2 justify-center",
  "screen": "flex-1",
  "methodTrigger": "min-h-13 border rounded-[12px] flex-row items-center justify-between px-3.5",
  "centered": "items-center gap-2.5 py-6",
  "actions": "border-t flex-row justify-end gap-2 px-4 pt-3"
} as const;
