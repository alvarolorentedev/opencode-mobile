import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectionMethodChooser } from '@/components/settings/connection-method-chooser';
import { ConnectionProfileDialog, type ConnectionProfileFormValues } from '@/components/settings/connection-profile-dialog';
import { useConnection } from '@/providers/opencode-contexts';

export function ConnectionSetupForm({ onPair, onConnected, onBusyChange }: { onPair: () => void; onConnected: () => void; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const { settings, connectionProfiles } = useConnection();
  const [mode, setMode] = useState<'manual' | 'scan'>();
  const profileId = useRef<string | undefined>(undefined);
  async function submit(values: ConnectionProfileFormValues) {
    onBusyChange(true);
    try {
      const profile = await connectionProfiles.save(values, profileId.current);
      profileId.current = profile.id;
      const result = await connectionProfiles.connect(profile);
      if (result.status !== 'connected') throw new Error(result.message);
      setMode(undefined);
      onConnected();
    } finally { onBusyChange(false); }
  }
  return <>
    <ConnectionMethodChooser onScan={() => setMode('scan')} onManual={() => setMode('manual')} onPair={onPair} />
    {mode ? <ConnectionProfileDialog title={t('settings:connection.addConnection')} submitLabel={t('settings:connection.saveAndConnect')} initial={{ serverUrl: settings.serverUrl }} startScanning={mode === 'scan'} onBusyChange={onBusyChange} onSubmit={submit} onDismiss={() => { profileId.current = undefined; setMode(undefined); }} /> : null}
  </>;
}
