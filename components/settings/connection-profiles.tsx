import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { Button, Chip, Dialog, Portal, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import { Colors } from '@/constants/theme';
import {
  createProfileId,
  deleteProfilePassword,
  findMatchingProfile,
  getProfilePassword,
  loadConnectionProfiles,
  pickModelPreferences,
  saveConnectionProfiles,
  saveProfilePassword,
  type ConnectionProfile,
} from '@/lib/connection-profiles';
import { useOpencode } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

function defaultProfileName(serverUrl: string) {
  try {
    return new URL(serverUrl).hostname || serverUrl;
  } catch {
    return serverUrl;
  }
}

export function ConnectionProfiles({ palette }: { palette: Palette }) {
  const { settings, chatPreferences, switchConnection } = useOpencode();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [dialogName, setDialogName] = useState<string>();

  useEffect(() => {
    void loadConnectionProfiles().then(setProfiles);
  }, []);

  const activeProfile = findMatchingProfile(profiles, settings.serverUrl, settings.username);

  async function persist(next: ConnectionProfile[]) {
    setProfiles(next);
    await saveConnectionProfiles(next);
  }

  async function handleSelect(profile: ConnectionProfile) {
    if (profile.id === activeProfile?.id) {
      return;
    }
    if (activeProfile) {
      await persist(profiles.map((item) => (
        item.id === activeProfile.id ? { ...item, modelPreferences: pickModelPreferences(chatPreferences) } : item
      )));
    }
    const password = await getProfilePassword(profile.id);
    switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password }, profile.modelPreferences);
  }

  async function handleSave() {
    const name = dialogName?.trim();
    setDialogName(undefined);
    if (!name) {
      return;
    }
    const saved: ConnectionProfile = {
      id: activeProfile?.id ?? createProfileId(),
      name,
      serverUrl: settings.serverUrl.trim(),
      username: settings.username.trim(),
      modelPreferences: pickModelPreferences(chatPreferences),
    };
    await saveProfilePassword(saved.id, settings.password);
    await persist(activeProfile
      ? profiles.map((item) => (item.id === saved.id ? saved : item))
      : [...profiles, saved]);
  }

  function handleDelete(profile: ConnectionProfile) {
    Alert.alert('Delete connection', `Remove "${profile.name}" from saved connections?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteProfilePassword(profile.id);
          void persist(profiles.filter((item) => item.id !== profile.id));
        },
      },
    ]);
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            testID={`connection-profile-${profile.id}`}
            selected={profile.id === activeProfile?.id}
            showSelectedCheck={false}
            mode={profile.id === activeProfile?.id ? 'flat' : 'outlined'}
            onPress={() => void handleSelect(profile)}
            onLongPress={() => handleDelete(profile)}
          >
            {profile.name}
          </Chip>
        ))}
        <Chip
          testID="connection-profile-save"
          icon={activeProfile ? 'content-save' : 'plus'}
          mode="outlined"
          disabled={!settings.serverUrl.trim()}
          onPress={() => setDialogName(activeProfile?.name ?? defaultProfileName(settings.serverUrl))}
        >
          {activeProfile ? 'Update' : 'Save'}
        </Chip>
      </ScrollView>
      {profiles.length > 0 ? (
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          Tap to switch, long-press to delete.
        </Text>
      ) : null}
      <Portal>
        <Dialog visible={dialogName !== undefined} onDismiss={() => setDialogName(undefined)}>
          <Dialog.Title>{activeProfile ? 'Update connection' : 'Save connection'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Name"
              testID="connection-profile-name-input"
              value={dialogName ?? ''}
              onChangeText={setDialogName}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogName(undefined)}>Cancel</Button>
            <Button onPress={() => void handleSave()}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 4,
  },
});
