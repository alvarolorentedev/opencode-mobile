import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectionCertificate } from '@/shared/contracts/connection-certificate';
import { useConnectionCertificate } from '@/features/connections/state/use-connection-certificate';
import { ConnectionCertificateView } from '@/features/connections/ui/connection-certificate-view';

export function ConnectionCertificateField({
  certificate,
  disabled,
  error,
  onChange,
  onError,
  supported: supportedOverride,
}: {
  certificate?: ConnectionCertificate;
  disabled?: boolean;
  error?: string;
  onChange: (certificate: ConnectionCertificate | undefined) => void;
  onError: (message: string | undefined) => void;
  supported?: boolean;
}) {
  const { t } = useTranslation();
  const { supported: nativeSupported, busy, error: pickError, pick } = useConnectionCertificate();
  const supported = supportedOverride ?? nativeSupported;

  useEffect(() => {
    if (pickError) onError(t(pickError));
  }, [onError, pickError, t]);

  if (!supported) return null;

  async function importCertificate() {
    const next = await pick();
    if (next) {
      onChange(next);
      onError(undefined);
    }
  }

  return (
    <ConnectionCertificateView
      certificate={certificate}
      disabled={disabled}
      busy={busy}
      error={error}
      onImport={() => void importCertificate()}
      onRemove={() => { onChange(undefined); onError(undefined); }}
    />
  );
}
