import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';
import { Checkbox, Chip, HelperText, List, Text } from 'react-native-paper';

import { NativeSelect } from '@/components/ui/native-select';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import { SettingTarget } from '../settings-panel';
import { Fonts } from '@/constants/theme';
import { getAddableProviders, getProviderCopy } from '@/components/settings/settings-utils';
import type { ServerContract } from '@/lib/opencode/client';
import type { ModelOption, ProviderAuthMethod, ProviderOption } from '@/providers/opencode-provider';
import type { Palette } from './setting-rows';

type AiDefaultsSectionProps = {
  availableModels: ModelOption[];
  availableProviders: ProviderOption[];
  configuredProviders: ProviderOption[];
  contract: ServerContract;
  enabledModelIds: Set<string>;
  expandedProviderId?: string;
  onActivateProviderAccount: (credentialId: string) => void;
  onExpandedProviderChange: (providerId?: string) => void;
  onModelToggle: (modelId: string, checked: boolean) => void;
  onRemoveProvider: (providerId: string) => void;
  onRemoveProviderAccount: (credentialId: string) => void;
  onStartProviderConfiguration: (providerId: string) => void;
  palette: Palette;
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
};

export function AiDefaultsSection({
  availableModels,
  availableProviders,
  configuredProviders,
  contract,
  enabledModelIds,
  expandedProviderId,
  onActivateProviderAccount,
  onExpandedProviderChange,
  onModelToggle,
  onRemoveProvider,
  onRemoveProviderAccount,
  onStartProviderConfiguration,
  palette,
  providerAuthMethodsById,
}: AiDefaultsSectionProps) {
  const { t } = useTranslation();
  const configuredModels = availableModels.filter((model) => configuredProviders.some((provider) => provider.id === model.providerID));
  const configuredProviderModels = configuredProviders
    .map((provider) => ({
      provider,
      models: configuredModels.filter((model) => model.providerID === provider.id),
    }))
    .filter((entry) => entry.models.length > 0);
  const addableProviders = getAddableProviders(availableProviders, providerAuthMethodsById, contract);

  return (
    <View style={styles.section}>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          {t('settings:providers.chooseModels')}
        </Text>
        <SettingTarget label={t('settings:providers.configuredProviders')}><View style={styles.providerHeader}>
          <Text variant="labelLarge" style={{ color: palette.text }}>{t('settings:providers.configuredProviders')}</Text>
          {addableProviders.length > 0 ? (
            <NativeSelect
              searchable
              onValueChange={onStartProviderConfiguration}
              options={addableProviders.map((provider) => ({
                label: getProviderCopy(provider.id, provider.label, t).label,
                description: provider.configured ? t('settings:providers.addAnotherAccount') : undefined,
                leadingIcon: (props) => renderProviderIcon(provider.id, props.size, props.color),
                value: provider.id,
              }))}
              title={t('settings:providers.addProvider')}
              renderTrigger={({ disabled, open, openState }) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={open}
                  testID="settings-add-provider-button"
                  style={({ pressed }) => [
                    styles.inlineSelectButton,
                    {
                      backgroundColor: palette.surface,
                      borderColor: openState ? palette.tint : palette.border,
                      opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
                    },
                  ]}>
                  <NativeText style={[styles.inlineSelectButtonLabel, { color: palette.text }]}>{t('settings:providers.addProvider')}</NativeText>
                </Pressable>
              )}
            />
          ) : null}
        </View>

        </SettingTarget>
        <View style={styles.chipWrap}>
          {configuredProviders.map((provider) => (
            <Chip key={provider.id} icon={({ size, color }) => renderProviderIcon(provider.id, size, color)} compact onPress={() => onStartProviderConfiguration(provider.id)} closeIconAccessibilityLabel={t('settings:providers.removeCredentials', { provider: getProviderCopy(provider.id, provider.label, t).label })} onClose={() => onRemoveProvider(provider.id)}>
              {getProviderCopy(provider.id, provider.label, t).label}
            </Chip>
          ))}
        </View>
        {configuredProviders.some((provider) => provider.accounts && provider.accounts.length > 0) ? (
          <View style={styles.accountsGroup}>
            <Text variant="labelLarge" style={{ color: palette.text }}>{t('settings:providers.accounts')}</Text>
            {configuredProviders.filter((provider) => provider.accounts && provider.accounts.length > 0).map((provider) => (
              <View key={provider.id} style={styles.accountProviderGroup}>
                <Text variant="bodySmall" style={{ color: palette.muted }}>{getProviderCopy(provider.id, provider.label, t).label}</Text>
                <View style={styles.chipWrap}>
                  {(provider.accounts || []).map((account) => (
                    <Chip
                      key={account.id}
                      icon={account.active ? 'check' : account.method === 'oauth' ? 'account-key' : 'key-variant'}
                      selected={account.active}
                      onPress={() => {
                        if (!account.active) onActivateProviderAccount(account.id);
                      }}
                      closeIconAccessibilityLabel={t('settings:providers.removeAccount')}
                      onClose={() => onRemoveProviderAccount(account.id)}>
                      {account.label}
                    </Chip>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {availableProviders.length === 0 ? <HelperText type="info">{t('settings:providers.connectFirst')}</HelperText> : null}
        {availableProviders.length > 0 && configuredProviders.length === 0 ? (
          <HelperText type="info">{t('settings:providers.configureAtLeastOne')}</HelperText>
        ) : null}
        <List.Section style={styles.modelListSection}>
          <List.AccordionGroup expandedId={expandedProviderId} onAccordionPress={(id) => onExpandedProviderChange(expandedProviderId === String(id) ? undefined : String(id))}>
            {configuredProviderModels.map(({ provider, models }) => {
              const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;

              return (
                <List.Accordion
                  key={provider.id}
                  id={provider.id}
                  title={getProviderCopy(provider.id, provider.label, t).label}
                  description={t('settings:providers.selectedCount', { selected: selectedCount, total: models.length })}
                  left={() => (
                    <View style={[styles.providerAccordionIconWrap, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
                      {renderProviderIcon(provider.id, 20, palette.tint)}
                    </View>
                  )}
                  style={[styles.providerAccordion, { backgroundColor: palette.background, borderColor: palette.border }]}
                  titleStyle={{ color: palette.text }}
                  descriptionStyle={{ color: palette.muted }}>
                  {models.map((model) => {
                    const checked = enabledModelIds.has(model.id);

                    return (
                      <List.Item
                        key={model.id}
                        title={model.label}
                        description={model.supportsReasoning ? t('settings:providers.reasoningSupported') : t('settings:providers.standardModel')}
                        titleStyle={{ color: palette.text }}
                        descriptionStyle={{ color: palette.muted }}
                        onPress={() => onModelToggle(model.id, checked)}
                        left={() => <Checkbox status={checked ? 'checked' : 'unchecked'} />}
                        style={styles.modelListItem}
                      />
                    );
                  })}
                </List.Accordion>
              );
            })}
          </List.AccordionGroup>
        </List.Section>
        {configuredModels.length === 0 ? <HelperText type="info">{t('settings:providers.noModels')}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inlineSelectButton: { minHeight: 36, borderWidth: 1, borderRadius: 999, justifyContent: 'center', paddingHorizontal: 12 },
  inlineSelectButtonLabel: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  accountsGroup: { gap: 10 },
  accountProviderGroup: { gap: 6 },
  modelListSection: { gap: 10 },
  providerAccordion: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  providerAccordionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: 8,
  },
  modelListItem: { paddingLeft: 16, paddingRight: 8 },
});
