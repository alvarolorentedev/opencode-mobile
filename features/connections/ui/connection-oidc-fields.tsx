import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { SettingField, SettingSwitchRow, type Palette } from '@/shared/ui/settings/setting-rows';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { cn } from '@/shared/ui/cn';

export type OidcFormValue = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  scopes: string;
  tokenHeader: string;
  redirectUri: string;
};

export type OidcFieldStatus = 'unknown' | 'signed-in' | 'expired' | 'signed-out' | 'signing-in';

// Presentation-only OpenID Connect block for the shared connection form. The
// provider call that opens the browser lives in the connections domain hook;
// this control never touches the network or storage.
export function ConnectionOidcFields({ value, status, error, defaultRedirectUri, disabled, palette, onChange, onSignIn }: {
  value: OidcFormValue;
  status: OidcFieldStatus;
  error?: string;
  defaultRedirectUri: string;
  disabled: boolean;
  palette: Palette;
  onChange: (patch: Partial<OidcFormValue>) => void;
  onSignIn: () => void;
}) {
  const { t } = useTranslation();
  const signingIn = status === 'signing-in';
  return (
    <View className={cn(stylesClasses.section)}>
      <SettingSwitchRow
        title={t('settings:connection.oidc.enable')}
        description={t('settings:connection.oidc.hint')}
        value={value.enabled}
        disabled={disabled}
        palette={palette}
        onValueChange={(enabled) => onChange({ enabled })}
      />
      {value.enabled ? <>
        <SettingField
          label={t('settings:connection.oidc.issuer')}
          testID="connection-oidc-issuer-input"
          value={value.issuer}
          onChangeText={(issuer) => onChange({ issuer })}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://login.example.com/realms/main"
        />
        <Text className={cn('text-muted-foreground')} variant="description">{t('settings:connection.oidc.issuerHint')}</Text>
        <SettingField
          label={t('settings:connection.oidc.clientId')}
          testID="connection-oidc-client-id-input"
          value={value.clientId}
          onChangeText={(clientId) => onChange({ clientId })}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <SettingField
          label={t('settings:connection.oidc.scopes')}
          testID="connection-oidc-scopes-input"
          value={value.scopes}
          onChangeText={(scopes) => onChange({ scopes })}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text className={cn('text-muted-foreground')} variant="description">{t('settings:connection.oidc.scopesHint')}</Text>
        <SettingField
          label={t('settings:connection.oidc.tokenHeader')}
          testID="connection-oidc-token-header-input"
          value={value.tokenHeader}
          onChangeText={(tokenHeader) => onChange({ tokenHeader })}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text className={cn('text-muted-foreground')} variant="description">{t('settings:connection.oidc.tokenHeaderHint')}</Text>
        <SettingField
          label={t('settings:connection.oidc.redirectUri')}
          testID="connection-oidc-redirect-input"
          value={value.redirectUri}
          onChangeText={(redirectUri) => onChange({ redirectUri })}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={defaultRedirectUri}
        />
        <Text className={cn('text-muted-foreground')} variant="description">{t('settings:connection.oidc.redirectHint', { uri: defaultRedirectUri })}</Text>
        <Button testID="connection-oidc-sign-in" disabled={disabled} onPress={onSignIn} variant="outline">
          {signingIn ? <Spinner size="small" /> : <Icon name="account-key" size={20} />}
          <Text>{t(status === 'signed-in' ? 'settings:connection.oidc.signInAgain' : 'settings:connection.oidc.signIn')}</Text>
        </Button>
        <Text
          testID="connection-oidc-status"
          accessibilityLiveRegion="polite"
          className={cn(status === 'signed-in' ? 'text-foreground' : 'text-muted-foreground')}
          variant="description">
          {t(`settings:connection.oidc.status.${status}`)}
        </Text>
        {error ? <FieldDescription testID="connection-oidc-error" invalid accessibilityLiveRegion="polite">{error}</FieldDescription> : null}
      </> : null}
    </View>
  );
}

const stylesClasses = {
  section: 'gap-3',
} as const;
