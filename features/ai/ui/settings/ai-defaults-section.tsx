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
  expandedProviderIds: ReadonlySet<string>;
  onActivateProviderAccount: (credentialId: string) => void;
  onToggleProvider: (providerId: string) => void;
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
  expandedProviderIds,
  onActivateProviderAccount,
  onToggleProvider,
  onModelToggle,
  onRemoveProvider,
  onRemoveProviderAccount,
  onStartProviderConfiguration,
  palette,
  providerAuthMethodsById,
}: AiDefaultsSectionProps) {
  const { t } = useTranslation();
  // Every configured provider keeps its accordion row, even without models, so
  // its credentials stay removable.
  const providerModels = configuredProviders.map((provider) => ({
    provider,
    models: availableModels.filter((model) => model.providerID === provider.id),
  }));
  const configuredModels = providerModels.flatMap((entry) => entry.models);
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
        {availableProviders.length === 0 ? <FieldDescription  invalid={false}>{t('settings:providers.connectFirst')}</FieldDescription> : null}
        {availableProviders.length > 0 && configuredProviders.length === 0 ? (
          <FieldDescription  invalid={false}>{t('settings:providers.configureAtLeastOne')}</FieldDescription>
        ) : null}
        <View className={cn(stylesClasses.modelListSection)}>
            {providerModels.map(({ provider, models }) => {
              const accounts = provider.accounts ?? [];
              const selectedCount = models.filter((model) => enabledModelIds.has(model.id)).length;
              const expanded = expandedProviderIds.has(provider.id);
              const providerLabel = getProviderCopy(provider.id, provider.label, t).label;

              return (
                <Collapsible key={provider.id} open={expanded}><ListRow
                  title={providerLabel}
                  description={models.length > 0 ? t('settings:providers.selectedCount', { selected: selectedCount, total: models.length }) : undefined}
                  left={() => (
                    <View className={cn(stylesClasses.providerAccordionIconWrap, "bg-surface-alt border-border")}>
                      {renderProviderIcon(provider.id, 20, palette.tint)}
                    </View>
                  )}
                  right={() => (
                    <View className={cn(stylesClasses.providerActions)}>
                      <Button
                        accessibilityLabel={t('settings:providers.removeCredentials', { provider: providerLabel })}
                        onPress={(event) => {
                          event.stopPropagation();
                          onRemoveProvider(provider.id);
                        }}
                        size="icon"
                        variant="ghost">
                        <Icon name="close" />
                      </Button>
                      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={palette.muted} />
                    </View>
                  )}
                  className={cn(stylesClasses.providerAccordion, "bg-background border-border")}
                  titleStyle={{ color: palette.text }}
                  descriptionStyle={{ color: palette.muted }} accessibilityState={{ expanded }} onPress={() => onToggleProvider(provider.id)} /><CollapsibleContent>
                  {accounts.length > 0 ? (
                    <View className={cn(stylesClasses.accountsGroup)}>
                      <Text className={cn("text-muted-foreground")} variant="label">{t('settings:providers.accounts')}</Text>
                      <View className={cn(stylesClasses.chipWrap)}>
                        {accounts.map((account) => (
                          <View key={account.id} className="flex-row items-center"><Button onPress={() => {
                              if (!account.active) onActivateProviderAccount(account.id);
                            }} variant="secondary" size="sm" accessibilityState={{ selected: account.active }}><Icon name={account.active ? 'check' : account.method === 'oauth' ? 'account-key' : 'key-variant'} size={18} /><Text>{account.label}</Text></Button><Button variant="ghost" size="icon" accessibilityLabel={t('settings:providers.removeAccount')} onPress={() => onRemoveProviderAccount(account.id)}><Icon name="close" /></Button></View>
                        ))}
                      </View>
                    </View>
                  ) : null}
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
  "accountsGroup": "gap-2.5 pl-4 pr-2 pb-2",
  "modelListSection": "gap-2.5",
  "providerAccordion": "rounded-[14px] border overflow-hidden mb-2.5",
  "providerAccordionIconWrap": "w-9.5 h-9.5 rounded-[12px] border items-center justify-center ml-1 mr-2",
  "providerActions": "flex-row items-center gap-1",
  "modelListItem": "pl-4 pr-2"
} as const;
