import { cn } from '@/lib/utils';
import { useWatch, useForm, useController, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { connectionSchema, type ConnectionDraft } from './forms/connection-schema';
import { SettingField } from '@/components/settings/sections/setting-rows';
import { ModalSurface } from '@/components/ui/portal';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';
import { Spinner } from '@/components/ui/spinner';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { usePalette } from '@/hooks/use-palette';

import { MAX_CONNECTION_HEADERS, parseConnectionHeaders } from '@/lib/connection-headers';
import { type ConnectionProbeResult } from '@/lib/opencode/client';
import { getServerHostname } from '@/lib/opencode/client/url';
import { useConnection } from '@/providers/opencode-contexts';

export type ConnectionProfileFormValues = {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  headers: Record<string, string>;
};



// The form owns presentation; probing and profile persistence stay in the
// provider. Local QR setup lives in its own flow (`connection-scan-flow.tsx`)
// and never reuses this manual address/details surface.
export function ConnectionProfileDialog({ title, submitLabel, showName = true, initial, onSubmit, onDismiss, onBusyChange }: {
  title: string;
  submitLabel: string;
  showName?: boolean;
  initial?: Partial<ConnectionProfileFormValues>;
  onSubmit: (values: ConnectionProfileFormValues) => Promise<void> | void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  useUpdateBlocker(true);
  const { t } = useTranslation();
  const { connectionProfiles } = useConnection();
  const palette = usePalette();
  const form = useForm<ConnectionDraft>({ resolver: zodResolver(connectionSchema), shouldUnregister: false,
    defaultValues: { name: initial?.name ?? '', serverUrl: initial?.serverUrl ?? '', username: initial?.username ?? '', password: initial?.password ?? '', headers: Object.entries(initial?.headers ?? {}).map(([name, value]) => ({ name, value })) },
    mode: 'onSubmit', reValidateMode: 'onChange',
  });
  const { field: { value: name, onChange: setName, onBlur: nameBlur, ref: nameRef } } = useController({ control: form.control, name: 'name' });
  const { field: { value: serverUrl, onChange: setServerUrl, onBlur: urlBlur, ref: urlRef } } = useController({ control: form.control, name: 'serverUrl' });
  const { field: { value: username, onChange: setUsername, onBlur: usernameBlur, ref: usernameRef } } = useController({ control: form.control, name: 'username' });
  const { field: { value: password, onChange: setPassword, onBlur: passwordBlur, ref: passwordRef } } = useController({ control: form.control, name: 'password' });
  const { fields: headers, append, remove } = useFieldArray({ control: form.control, name: 'headers' });
  const headerValues = useWatch({ control: form.control, name: 'headers' });
  const [headersOpen, setHeadersOpen] = useState(headers.length > 0);
  const [showHeaderValues, setShowHeaderValues] = useState(false);
  const [step, setStep] = useState<'address' | 'details'>('address');
  const [probe, setProbe] = useState<ConnectionProbeResult>();
  const [customUsername, setCustomUsername] = useState(Boolean(initial?.username));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'probe' | 'save'>();
  const working = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  const locked = busy === 'save';
  const v1 = probe?.status === 'detected' && probe.contract === 'v1';
  const v2 = probe?.status === 'detected' && probe.contract === 'v2';

  function back() {
    request.current += 1;
    controller.current?.abort();
    working.current = false;
    setBusy(undefined);
    onBusyChange?.(false);
    setError(undefined);
    if (step === 'details') setStep('address');
    else onDismiss();
  }

  function updateHeader(index: number, patch: Partial<{ name: string; value: string }>) {
    if (patch.name !== undefined) form.setValue(`headers.${index}.name`, patch.name, { shouldDirty: true });
    if (patch.value !== undefined) form.setValue(`headers.${index}.value`, patch.value, { shouldDirty: true });
    setError(undefined);
  }
  function addHeader() {
    if (form.getValues('headers').length >= MAX_CONNECTION_HEADERS) return;
    append({ name: '', value: '' }, { shouldFocus: false });
    setHeadersOpen(true);
    setError(undefined);
  }
  function removeHeader(index: number) { remove(index); setError(undefined); }

  async function perform(operation: 'probe' | 'save') {
    if (working.current) return;
    working.current = true;
    const validationRequest = ++request.current;
    if (!await form.trigger(undefined, { shouldFocus: true }) || validationRequest !== request.current) {
      if (validationRequest === request.current) working.current = false;
      if (form.getFieldState('headers').invalid) setHeadersOpen(true);
      return;
    }
    const parsedHeaders = parseConnectionHeaders(form.getValues('headers'));
    if (parsedHeaders.error) return;
    working.current = true;
    setBusy(operation);
    setError(undefined);
    const current = ++request.current;
    controller.current = new AbortController();
    try {
      const values = { name: name.trim(), serverUrl: serverUrl.trim(), username: username.trim(), password, headers: parsedHeaders.headers ?? {} };
      const result = await connectionProfiles.probe(values, controller.current.signal);
      if (current !== request.current) return;
      setProbe(result);
      if (result.status === 'unreachable') throw new Error(t('settings:connection.setup.unreachable'));
      if (operation === 'probe') { setStep('details'); return; }
      if (result.status === 'authentication-required') throw new Error(t('settings:connection.setup.credentialsRejected'));
      await onSubmit(values);
    } catch (reason) {
      if (current !== request.current) return;
      setError(reason instanceof Error ? reason.message : t('settings:connection.errors.save'));
    } finally {
      if (current === request.current) { working.current = false; setBusy(undefined); }
    }
  }

  return (
    <ModalSurface accessibilityLabel={title} visible animationType="slide" presentationStyle="fullScreen" onRequestClose={locked ? undefined : back}>
      <KeyboardAvoidingView className={cn(stylesClasses.screen, "bg-background")} behavior="padding">
        <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }} safeArea={false}><Button accessibilityLabel={t('common:actions.back')} disabled={locked} onPress={back} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} /></Button><HeaderTitle title={title} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text className={cn("text-muted-foreground")}>{t('settings:connection.setup.step', { step: step === 'address' ? 1 : 2 })}</Text>
          <Text  variant="display">{t(step === 'address' ? 'settings:connection.setup.addressTitle' : 'settings:connection.setup.detailsTitle')}</Text>
          {step === 'address' ? <>
            <Text className={cn("text-muted-foreground")}>{t('settings:connection.setup.addressHint')}</Text>
            <SettingField label={t('settings:connection.fields.serverUrl')} testID="connection-profile-url-input" invalid={Boolean(form.formState.errors.serverUrl)} aria-describedby={form.formState.errors.serverUrl ? "connection-profile-validation" : undefined} ref={urlRef} onBlur={urlBlur} value={serverUrl} onChangeText={(value) => { setServerUrl(value); setProbe(undefined); setError(undefined); }} disabled={Boolean(busy)} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.10:49374"></SettingField>
          </> : <>
            <View className={cn(stylesClasses.addressRow)}>
              <Text className={cn(stylesClasses.address)} numberOfLines={2}>{serverUrl}</Text>
              <Button testID="connection-profile-change" disabled={Boolean(busy)} onPress={back} variant="ghost"><Text>{t('settings:connection.setup.change')}</Text></Button>
            </View>
            <Text testID="connection-profile-detection" accessibilityLiveRegion="polite" style={{ color: v1 || v2 ? palette.tint : palette.muted }}>{v1 || v2 ? t('settings:connection.setup.detected', { version: v2 ? '2' : '1' }) : t('settings:connection.setup.identify')}</Text>
            {!v2 && !v1 ? <Button testID="connection-profile-custom-username" disabled={Boolean(busy)} onPress={() => setCustomUsername((value) => !value)} variant="ghost" className={cn(stylesClasses.left)} ><Text>{t('settings:connection.setup.customUsername')}</Text></Button> : null}
            {!v2 && (v1 || customUsername) ? <SettingField label={t('settings:connection.fields.username')} testID="connection-profile-username-input" ref={usernameRef} onBlur={usernameBlur} value={username} onChangeText={setUsername} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false} placeholder="opencode"></SettingField> : null}
            <SettingField label={t('settings:connection.fields.password')} testID="connection-profile-password-input" ref={passwordRef} onBlur={passwordBlur} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false} endAdornment={<Button onPress={() => setShowPassword((value) => !value)} accessibilityLabel={t(showPassword ? 'settings:connection.setup.hidePassword' : 'settings:connection.setup.showPassword')} variant="ghost" size="icon"><Icon name={showPassword ? 'eye-off' : 'eye'} size={24} /></Button>}></SettingField>
            <Text className={cn("text-muted-foreground")}>{t('settings:connection.setup.passwordHint')}</Text>
            <Button testID="connection-profile-headers-toggle" disabled={Boolean(busy)} onPress={() => setHeadersOpen((value) => !value)} variant="ghost" className={cn(stylesClasses.left)} ><Icon name={headersOpen ? 'chevron-up' : 'chevron-down'} size={20} /><Text>{t('settings:connection.headers.title')}</Text></Button>
            {headersOpen ? <>
              <Text className={cn("text-muted-foreground")}>{t('settings:connection.headers.hint')}</Text>
              {headers.map((row, index) => (
                <View key={row.id} className={cn(stylesClasses.headerBlock)}>
                  <View className={cn(stylesClasses.headerRow)}>
                    <SettingField label={t('settings:connection.headers.name')} testID={`connection-profile-header-name-${index}`} value={headerValues[index]?.name ?? ''} onChangeText={(value) => updateHeader(index, { name: value })} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false} className={cn(stylesClasses.headerName)} ></SettingField>
                    <Button testID={`connection-profile-header-remove-${index}`} accessibilityLabel={t('settings:connection.headers.remove')} disabled={Boolean(busy)} onPress={() => removeHeader(index)} variant="ghost" size="icon"><Icon name={"close"} size={24} /></Button>
                  </View>
                  <SettingField label={t('settings:connection.headers.value')} testID={`connection-profile-header-value-${index}`} value={headerValues[index]?.value ?? ''} onChangeText={(value) => updateHeader(index, { value })} secureTextEntry={!showHeaderValues} disabled={Boolean(busy)} autoCapitalize="none" autoCorrect={false}></SettingField>
                </View>
              ))}
              <View className={cn(stylesClasses.headerActions)}>
                <Button testID="connection-profile-header-add" disabled={Boolean(busy) || headers.length >= MAX_CONNECTION_HEADERS} onPress={addHeader} variant="outline"><Icon name={"plus"} size={20} /><Text>{t('settings:connection.headers.add')}</Text></Button>
                {headerValues.some((row) => row.value) ? <Button testID="connection-profile-header-visibility" disabled={Boolean(busy)} onPress={() => setShowHeaderValues((value) => !value)} variant="ghost"><Text>{t(showHeaderValues ? 'settings:connection.headers.hideValues' : 'settings:connection.headers.showValues')}</Text></Button> : null}
              </View>
            </> : null}
            {showName ? <>
              <SettingField label={t('settings:connection.setup.optionalName')} testID="connection-profile-name-input" ref={nameRef} onBlur={nameBlur} value={name} onChangeText={setName} disabled={Boolean(busy)} placeholder={getServerHostname(serverUrl)}></SettingField>
              <Text className={cn("text-muted-foreground")}>{t('settings:connection.setup.nameHint')}</Text>
            </> : null}
          </>}
          <FieldDescription testID="connection-profile-error" nativeID="connection-profile-validation" accessibilityLiveRegion="polite" invalid={true} hidden={!Boolean(error || form.formState.errors.serverUrl || form.formState.errors.headers)}>{error ?? (form.formState.errors.serverUrl?.message ? t(form.formState.errors.serverUrl.message) : form.formState.errors.headers?.message ? t(form.formState.errors.headers.message) : undefined)}</FieldDescription>
        </ScrollView>
        <View className={cn(stylesClasses.actions)} style={[{ backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button testID="connection-profile-save-cancel" disabled={locked} onPress={back} variant="ghost"><Text>{t(step === 'details' ? 'common:actions.back' : 'common:actions.cancel')}</Text></Button>
          <Button testID={step === 'address' ? 'connection-profile-continue' : 'connection-profile-save-confirm'} disabled={Boolean(busy)} onPress={() => void perform(step === 'address' ? 'probe' : 'save')} variant="default">{Boolean(busy) ? <Spinner size="small" /> : null}<Text>{step === 'address' ? t('settings:connection.setup.continue') : submitLabel}</Text></Button>
        </View>
      </KeyboardAvoidingView>
    </ModalSurface>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 }
});

const stylesClasses = {
  "screen": "flex-1",
  "addressRow": "flex-row items-center gap-2",
  "address": "flex-1",
  "left": "self-start",
  "headerBlock": "gap-2",
  "headerRow": "flex-row items-center gap-2",
  "headerName": "flex-1",
  "headerActions": "flex-row flex-wrap gap-2",
  "actions": "border-t flex-row justify-end gap-2 px-6 pt-4"
} as const;
