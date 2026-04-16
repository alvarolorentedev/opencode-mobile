import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, RadioButton, Text, TextInput } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import type { ProviderAuthMethod } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ProviderConfigDialogProps = {
  authMethods: ProviderAuthMethod[];
  authValues: Record<string, string>;
  effectiveAuthMethods: ProviderAuthMethod[];
  isConfiguringProvider: boolean;
  onAuthValueChange: (key: string, value: string) => void;
  onDismiss: () => void;
  onMethodChange: (index: number) => void;
  onSubmit: () => void;
  palette: Palette;
  providerDialogError?: string;
  selectedMethod?: ProviderAuthMethod;
  selectedMethodIndex: number;
  selectedProviderDescription?: string;
  selectedProviderLabel: string;
  useGenericFallback: boolean;
  visiblePrompts: NonNullable<ProviderAuthMethod['prompts']>;
};

export function ProviderConfigDialog({
  authMethods,
  authValues,
  effectiveAuthMethods,
  isConfiguringProvider,
  onAuthValueChange,
  onDismiss,
  onMethodChange,
  onSubmit,
  palette,
  providerDialogError,
  selectedMethod,
  selectedMethodIndex,
  selectedProviderDescription,
  selectedProviderLabel,
  useGenericFallback,
  visiblePrompts,
}: ProviderConfigDialogProps) {
  return (
    <Dialog visible onDismiss={onDismiss}>
      <Dialog.Title>{`Configure ${selectedProviderLabel}`}</Dialog.Title>
      <Dialog.Content style={styles.dialogContent}>
        {selectedProviderDescription ? (
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            {selectedProviderDescription}
          </Text>
        ) : null}
        {authMethods.length === 0 && useGenericFallback ? (
          <HelperText type="info">
            No provider-specific setup metadata was returned. You can paste an API key, or leave it empty to just enable the provider.
          </HelperText>
        ) : null}
        {authMethods.length === 0 && !useGenericFallback ? (
          <HelperText type="info">
            This provider should expose its auth flow from the server, but no auth metadata was returned. Refresh the connection and try again.
          </HelperText>
        ) : null}
        {effectiveAuthMethods.length > 1 ? (
          <RadioButton.Group onValueChange={(value) => onMethodChange(Number(value))} value={String(selectedMethodIndex)}>
            {effectiveAuthMethods.map((method, index) => (
              <View key={`${method.label}-${index}`} style={styles.authMethodRow}>
                <RadioButton value={String(index)} />
                <Text style={{ color: palette.text }}>{method.label}</Text>
              </View>
            ))}
          </RadioButton.Group>
        ) : null}

        {visiblePrompts.map((prompt: NonNullable<ProviderAuthMethod['prompts']>[number]) =>
          prompt.type === 'select' ? (
            <View key={prompt.key} style={styles.promptGroup}>
              <Text variant="labelLarge" style={{ color: palette.text }}>
                {prompt.message}
              </Text>
              <View style={styles.chipWrap}>
                {(prompt.options || []).map((option: NonNullable<typeof prompt.options>[number]) => (
                  <Chip
                    key={option.value}
                    selected={authValues[prompt.key] === option.value}
                    onPress={() => onAuthValueChange(prompt.key, option.value)}>
                    {option.label}
                  </Chip>
                ))}
              </View>
            </View>
          ) : (
            <TextInput
              key={prompt.key}
              mode="outlined"
              label={prompt.message}
              placeholder={prompt.placeholder}
              value={authValues[prompt.key] || ''}
              onChangeText={(value) => onAuthValueChange(prompt.key, value)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={/token|key|secret|password/i.test(prompt.key)}
            />
          ),
        )}

        {selectedMethod?.type === 'oauth' ? (
          <HelperText type="info">This opens the provider sign-in flow in your browser.</HelperText>
        ) : null}
        {!selectedMethod && authMethods.length === 0 && !useGenericFallback ? (
          <HelperText type="error">Setup details for this provider are unavailable right now.</HelperText>
        ) : null}
        {providerDialogError ? <HelperText type="error">{providerDialogError}</HelperText> : null}
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancel</Button>
        <Button testID="settings-provider-save-button" disabled={!selectedMethod} loading={isConfiguringProvider} onPress={onSubmit}>
          {selectedMethod?.type === 'oauth' ? 'Continue' : 'Save'}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  dialogContent: { gap: 14 },
  authMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptGroup: { gap: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
