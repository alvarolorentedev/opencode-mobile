import { useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  Button,
  ButtonText,
  Heading,
  Input,
  InputField,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatTimestamp } from '@/lib/opencode/format';
import { useOpencode } from '@/providers/opencode-provider';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { connect, connection, settings, updateSettings } = useOpencode();
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);

    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}>
      <VStack style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]} space="md"> 
        <Heading style={[styles.heading, { color: palette.text }]}>Connection settings</Heading>
        <Text style={[styles.copy, { color: palette.muted }]}>Point the app at an OpenCode server started with `opencode serve` or `opencode web`. Use your machine IP instead of `127.0.0.1` when testing on a physical device.</Text>

        <Field
          label="Server URL"
          value={settings.serverUrl}
          onChangeText={(value) => updateSettings({ serverUrl: value })}
          placeholder="http://192.168.1.10:4096"
        />
        <Field
          label="Username"
          value={settings.username}
          onChangeText={(value) => updateSettings({ username: value })}
          placeholder="opencode"
        />
        <Field
          label="Password"
          value={settings.password}
          onChangeText={(value) => updateSettings({ password: value })}
          placeholder="Optional basic auth password"
          secureTextEntry
        />
        <Button
          onPress={() => void handleConnect()}
          style={[styles.connectButton, { backgroundColor: palette.tint }]}
          sx={{ ':disabled': { opacity: 0.55 } }}>
          {isConnecting ? (
            <Spinner color={palette.background} />
          ) : (
            <ButtonText style={[styles.connectButtonText, { color: palette.background }]}>Reconnect</ButtonText>
          )}
        </Button>
      </VStack>

      <VStack style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]} space="md"> 
        <Heading style={[styles.heading, { color: palette.text }]}>Server health</Heading>
        <VStack style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Status</Text>
          <Text
            style={[
              styles.metaValue,
              {
                color:
                  connection.status === 'connected'
                    ? palette.success
                    : connection.status === 'error'
                      ? palette.danger
                      : palette.warning,
              },
            ]}>
            {connection.status}
          </Text>
        </VStack>
        <VStack style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Message</Text>
          <Text style={[styles.metaValue, { color: palette.text }]}>{connection.message}</Text>
        </VStack>
        <VStack style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Project</Text>
          <Text style={[styles.metaValue, { color: palette.text }]}>{connection.projectDirectory || 'Unknown until connected'}</Text>
        </VStack>
        <VStack style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Checked</Text>
          <Text style={[styles.metaValue, { color: palette.text }]}> 
            {connection.checkedAt ? formatTimestamp(connection.checkedAt) : 'Not yet'}
          </Text>
        </VStack>
      </VStack>

      <VStack style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]} space="md"> 
        <Heading style={[styles.heading, { color: palette.text }]}>Quick start</Heading>
        <Text style={[styles.command, { color: palette.accent }]}>opencode serve --hostname 0.0.0.0 --port 4096</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>If the server is password protected, add the same credentials here. Choose folders and conversations from the `Workspaces` tab.</Text>
      </VStack>
    </ScrollView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
};

function Field({ label, onChangeText, placeholder, secureTextEntry, value }: FieldProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <VStack style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <Input style={[styles.fieldInput, { borderColor: palette.border, backgroundColor: palette.background }]}> 
        <InputField
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.icon}
          secureTextEntry={secureTextEntry}
          autoCapitalize="none"
          autoCorrect={false}
          color={palette.text}
        />
      </Input>
    </VStack>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    gap: 14,
  },
  heading: {
    fontSize: 28,
    lineHeight: 32,
    fontFamily: Fonts.display,
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
  },
  fieldWrap: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  fieldInput: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  connectButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  metaRow: {
    gap: 4,
  },
  metaLabel: {
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metaValue: {
    fontSize: 15,
    lineHeight: 22,
  },
  command: {
    fontSize: 15,
    fontFamily: Fonts.mono,
    lineHeight: 22,
  },
});
