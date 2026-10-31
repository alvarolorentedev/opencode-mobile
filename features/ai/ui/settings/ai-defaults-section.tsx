import { cn } from '@/shared/ui/cn';
import { Collapsible, CollapsibleContent } from '@/shared/ui/collapsible';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { FieldDescription } from '@/shared/ui/text-field';
import { ListRow } from '@/shared/ui/list-row';
import { Checkbox } from '@/shared/ui/checkbox';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as NativeText, View } from 'react-native';

import { CatalogSelect } from '@/shared/ui/catalog-select';
import { renderProviderIcon } from '@/features/ai/ui/provider-icon';
import { SettingTarget } from '@/shared/ui/settings/settings-panel';
import { Fonts } from '@/shared/ui/theme/theme';
import { getAddableProviders, getProviderCopy } from '@/features/ai/model/settings-utils';
import type { ServerContract } from '@/shared/protocol/opencode/client';
import type { ModelOption } from '@/shared/contracts/model-options';
import type { ProviderAuthMethod } from '@/shared/protocol/opencode/types';
import type { ProviderOption } from '@/features/ai/model/types';
import { Palette } from '@/shared/ui/settings/setting-rows';

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
    <View className={cn(stylesClasses.section)}>
        <Text className={cn("text-muted-foreground")} variant="description">{t('settings:providers.chooseModels')}</Text>
        <SettingTarget label={t('settings:providers.configuredProviders')}><View className={cn(stylesClasses.providerHeader)}>
          <Text className={cn("text-foreground")} variant="description">{t('settings:providers.configuredProviders')}</Text>
          {addableProviders.length > 0 ? (
            <CatalogSelect
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
                  <NativeText className={cn("text-foreground")} style={[styles.inlineSelectButtonLabel]}>{t('settings:providers.addProvider')}</NativeText>
                </Pressable>
              )}
            />
          ) : null}
        </View>

        </SettingTarget>
        <View className={cn(stylesClasses.chipWrap)}>
          {configuredProviders.map((provider) => (
            <View key={provider.id} className="flex-row items-center"><Button onPress={() => onStartProviderConfiguration(provider.id)} variant="secondary" size="sm">{(({ size, color }) => renderProviderIcon(provider.id, size, color))({ size: 18, color: palette.tint })}<Text>{getProviderCopy(provider.id, provider.label, t).label}</Text></Button><Button variant="ghost" size="icon" accessibilityLabel={t('settings:providers.removeCredentials', { provider: getProviderCopy(provider.id, provider.label, t).label })} onPress={() => onRemoveProvider(provider.id)}><Icon name="close" /></Button></View>
          ))}
        </View>
        {configuredProviders.some((provider) => provider.accounts && provider.accounts.length > 0) ? (
          <View className={cn(stylesClasses.accountsGroup)}>
            <Text className={cn("text-foreground")} variant="description">{t('settings:providers.accounts')}</Text>
            {configuredProviders.filter((provider) => provider.accounts && provider.accounts.length > 0).map((provider) => (
              <View key={provider.id} className={cn(stylesClasses.accountProviderGroup)}>
                <Text className={cn("text-muted-foreground")} variant="label">{getProviderCopy(provider.id, provider.label, t).label}</Text>
                <View className={cn(stylesClasses.chipWrap)}>
                  {(provider.accounts || []).map((account) => (
                    <View key={account.id} className="flex-row items-center"><Button onPress={() => {
                        if (!account.active) onActivateProviderAccount(account.id);
                      }} variant="secondary" size="sm" accessibilityState={{ selected: account.active }}><Icon name={account.active ? 'check' : account.method === 'oauth' ? 'account-key' : 'key-variant'} size={18} /><Text>{account.label}</Text></Button><Button variant="ghost" size="icon" accessibilityLabel={t('settings:providers.removeAccount')} onPress={() => onRemoveProviderAccount(account.id)}><Icon name="close" /></Button></View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {availableProviders.length === 0 ? <FieldDescription  invalid={false}>{t('settings:providers.connectFirst')}</FieldDescription> : null}
        {availableProviders.length > 0 && configuredProviders.length === 0 ? (
          <FieldDescription  invalid={false}>{t('settings:providers.configureAtLeastOne')}</FieldDescription>
        ) : null}
        <View className={cn(stylesClasses.modelListSection)}>
            {configuredProviderModels.map(({ provider, models }) => {
              const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;

              return (
                <Collapsible key={provider.id} open={expandedProviderId === provider.id}><ListRow
                  title={getProviderCopy(provider.id, provider.label, t).label}
                  description={t('settings:providers.selectedCount', { selected: selectedCount, total: models.length })}
                  left={() => (
                    <View className={cn(stylesClasses.providerAccordionIconWrap, "bg-surface-alt border-border")}>
                      {renderProviderIcon(provider.id, 20, palette.tint)}
                    </View>
                  )}
                  className={cn(stylesClasses.providerAccordion, "bg-background border-border")}
                  titleStyle={{ color: palette.text }}
                  descriptionStyle={{ color: palette.muted }} accessibilityState={{ expanded: expandedProviderId === provider.id }} onPress={() => onExpandedProviderChange(expandedProviderId === provider.id ? undefined : provider.id)} /><CollapsibleContent>
                  {models.map((model) => {
                    const checked = enabledModelIds.has(model.id);

                    return (
                      <ListRow key={model.id} title={model.label} description={model.supportsReasoning ? t('settings:providers.reasoningSupported') : t('settings:providers.standardModel')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} onPress={() => onModelToggle(model.id, checked)} left={() => <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Checkbox onCheckedChange={() => {}} accessible={false} checked={checked} /></View>} className={cn(stylesClasses.modelListItem)}></ListRow>
                    );
                  })}
                </CollapsibleContent></Collapsible>
              );
            })}
          </View>
        {configuredModels.length === 0 ? <FieldDescription  invalid={false}>{t('settings:providers.noModels')}</FieldDescription> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineSelectButton: { minHeight: 36, borderWidth: 1, borderRadius: 999, justifyContent: 'center', paddingHorizontal: 12 },
  inlineSelectButtonLabel: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' }
});

const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "providerHeader": "flex-row items-center justify-between gap-3",
  "chipWrap": "flex-row flex-wrap gap-2",
  "accountsGroup": "gap-2.5",
  "accountProviderGroup": "gap-1.5",
  "modelListSection": "gap-2.5",
  "providerAccordion": "rounded-[14px] border overflow-hidden mb-2.5",
  "providerAccordionIconWrap": "w-9.5 h-9.5 rounded-[12px] border items-center justify-center ml-1 mr-2",
  "modelListItem": "pl-4 pr-2"
} as const;
