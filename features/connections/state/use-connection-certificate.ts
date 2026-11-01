import { base64 } from '@scure/base';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { importCertificate, isTlsTrustSupported } from '@/shared/platform/tls-trust';
import type { ConnectionCertificate } from '@/shared/contracts/connection-certificate';

function errorKey(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/expired|not yet valid/i.test(message)) return 'settings:connection.certificate.errors.expired';
  if (/too large/i.test(message)) return 'settings:connection.certificate.errors.tooLarge';
  if (/not a certificate|invalid|could not parse/i.test(message)) return 'settings:connection.certificate.errors.invalid';
  return 'settings:connection.certificate.errors.read';
}

export function useConnectionCertificate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const pick = useCallback(async (): Promise<ConnectionCertificate | undefined> => {
    if (!isTlsTrustSupported()) return undefined;
    setBusy(true);
    setError(undefined);
    try {
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) return undefined;
      let bytes: Uint8Array;
      if (Platform.OS === 'web') {
        if (asset.file) bytes = new Uint8Array(await asset.file.arrayBuffer());
        else if (asset.base64) bytes = base64.decode(asset.base64);
        else throw new Error('Could not read the selected certificate.');
      } else {
        const { File } = await import('expo-file-system');
        bytes = await new File(asset.uri).bytes();
      }
      return await importCertificate(base64.encode(bytes));
    } catch (reason) {
      setError(errorKey(reason));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported: isTlsTrustSupported(), busy, error, pick, clearError: useCallback(() => setError(undefined), []) };
}
