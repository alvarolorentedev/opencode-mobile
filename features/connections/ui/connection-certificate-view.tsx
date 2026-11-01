import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { certificateFingerprintLabel, type ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function ConnectionCertificateView({
  certificate,
  disabled,
  busy,
  error,
  onImport,
  onRemove,
}: {
  certificate?: ConnectionCertificate;
  disabled?: boolean;
  busy?: boolean;
  error?: string;
  onImport: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const palette = usePalette();

  const kind = certificate?.kind === 'ca'
    ? t('settings:connection.certificate.kind.ca')
    : certificate?.kind === 'self-signed'
      ? t('settings:connection.certificate.kind.selfSigned')
      : t('settings:connection.certificate.kind.server');

  return (
    <View className={cn('gap-2')}>
      <View className={cn('flex-row items-center gap-2')}>
        <Icon name="shield" size={20} />
        <Text variant="label">{t('settings:connection.certificate.title')}</Text>
      </View>
      <Text className={cn('text-muted-foreground')}>{t('settings:connection.certificate.hint')}</Text>
      {certificate ? (
        <View className={cn('border rounded-[12px] p-3 gap-1')} style={{ borderColor: palette.border }} testID="connection-certificate-summary">
          <Text variant="label">{kind}</Text>
          <Text className={cn('text-muted-foreground')} numberOfLines={2}>{certificate.subject}</Text>
          <Text className={cn('text-muted-foreground')} numberOfLines={2}>{t('settings:connection.certificate.issuer', { issuer: certificate.issuer })}</Text>
          <Text className={cn('text-muted-foreground')}>{t('settings:connection.certificate.expires', { date: new Date(certificate.notAfter).toLocaleDateString() })}</Text>
          <Text className={cn('text-muted-foreground')} selectable>{t('settings:connection.certificate.fingerprint', { fingerprint: certificateFingerprintLabel(certificate.fingerprint) })}</Text>
          {certificate.count > 1 ? <Text className={cn('text-muted-foreground')}>{t('settings:connection.certificate.chain', { count: certificate.count })}</Text> : null}
          {certificate.kind !== 'ca' ? <Text className={cn('text-muted-foreground')}>{t('settings:connection.certificate.pinnedWarning')}</Text> : null}
          <View className={cn('flex-row flex-wrap gap-2 pt-1')}>
            <Button testID="connection-certificate-replace" disabled={disabled || busy} onPress={onImport} variant="outline"><Text>{t('settings:connection.certificate.replace')}</Text></Button>
            <Button testID="connection-certificate-remove" disabled={disabled || busy} onPress={onRemove} variant="ghost"><Text>{t('settings:connection.certificate.remove')}</Text></Button>
          </View>
        </View>
      ) : (
        <View className={cn('flex-row')}>
          <Button testID="connection-certificate-import" disabled={disabled || busy} onPress={onImport} variant="outline"><Icon name="upload" size={20} /><Text>{t('settings:connection.certificate.import')}</Text></Button>
        </View>
      )}
      <FieldDescription testID="connection-certificate-error" accessibilityLiveRegion="polite" invalid hidden={!error}>{error}</FieldDescription>
    </View>
  );
}
