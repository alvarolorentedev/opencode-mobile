import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectionMethodChooser } from '@/components/settings/connection-method-chooser';
import { ConnectionProfileDialog, type ConnectionProfileFormValues } from '@/components/settings/connection-profile-dialog';
import { useConnection } from '@/providers/opencode-contexts';

export function ConnectionSetupForm({ onPair, onConnected, onBusyChange }: { onPair: () => void; onConnected: () => void; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const { settings, connectionProfiles } = useConnection();
  const [manual, setManual] = useState(false);
  const profileId = useRef<string | undefined>(undefined);
  async function submit(values: ConnectionProfileFormValues) {
    onBusyChange(true);
    try {
      const profile = await connectionProfiles.save(values, profileId.current);
      profileId.current = profile.id;
      const result = await connectionProfiles.connect(profile);
      if (result.status !== 'connected') throw new Error(result.message);
      setManual(false);
      onConnected();
    } finally { onBusyChange(false); }
  }
  return <>
    <ConnectionMethodChooser onPair={onPair} onManual={() => setManual(true)} />
    {manual ? <ConnectionProfileDialog title={t('settings:connection.addConnection')} submitLabel={t('settings:connection.saveAndConnect')} initial={{ serverUrl: settings.serverUrl }} onBusyChange={onBusyChange} onSubmit={submit} onDismiss={() => { profileId.current = undefined; setManual(false); }} /> : null}
  </>;
}
