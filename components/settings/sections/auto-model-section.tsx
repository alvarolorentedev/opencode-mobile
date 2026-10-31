import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldDescription } from '@/components/ui/text-field';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';


import { getAutoModelSuggestions } from '@/providers/opencode-auto-model';
import { getVisibleModels } from '@/providers/opencode-model-selection';
import type { ModelComplexity } from '@/lib/auto-model/classifier-prompt';
import { AUTO_MODEL_PACK } from '@/lib/auto-model/catalog';
import type { ServerContract } from '@/lib/opencode/client';
import type { ChatPreferences, ModelOption, ProviderOption } from '@/providers/opencode-provider';
import type { AutoModelClassifier } from '@/providers/opencode-preferences';
import type { CapabilitiesContextValue } from '@/providers/opencode-provider-types';
import { useAutoModelSetup } from '@/components/settings/use-auto-model-setup';
import { SettingsDisclosure } from '../settings-panel';


type AutoModelSectionProps = {
  availableModels: ModelOption[];
  configuredProviders: ProviderOption[];
  chatPreferences: ChatPreferences;
  contract: ServerContract;
  modelRouting: CapabilitiesContextValue['modelRouting'];
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};

const COMPLEXITIES: ModelComplexity[] = ['simple', 'standard', 'complex'];

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function AutoModelSection({
  availableModels,
  configuredProviders,
  chatPreferences,
  contract,
  modelRouting,
  palette,
  updateChatPreferences,
}: AutoModelSectionProps) {
  const { t } = useTranslation();
  const setup = useAutoModelSetup(modelRouting.refreshAvailability);
  const autoModel = chatPreferences.autoModel;
  const visibleModels = getVisibleModels(availableModels, configuredProviders, chatPreferences.enabledModelIds);
  const suggestions = getAutoModelSuggestions(visibleModels, chatPreferences.modelId);
  const localSupported = Platform.OS !== 'web';
  const serverSupported = contract === 'v2' && visibleModels.length > 0;
  const serverUsable = serverSupported && modelRouting.serverStatus !== 'unsupported';
  const classifierModel = autoModel.classifierModelId
    ? visibleModels.find((model) => model.id === autoModel.classifierModelId)
    : undefined;

  useEffect(() => {
    if (!localSupported && serverUsable && autoModel.classifier !== 'server') {
      updateChatPreferences({ autoModel: { ...autoModel, classifier: 'server', enabled: false } });
    }
  }, [autoModel, localSupported, serverUsable, updateChatPreferences]);

  useEffect(() => {
    if (localSupported && autoModel.classifier === 'server' && (!serverSupported || modelRouting.serverStatus === 'unsupported')) {
      updateChatPreferences({ autoModel: { ...autoModel, classifier: 'local', enabled: false } });
    }
  }, [autoModel, localSupported, modelRouting.serverStatus, serverSupported, updateChatPreferences]);

  useEffect(() => {
    if (serverSupported && autoModel.classifier === 'server' && modelRouting.serverStatus === 'unknown') {
      void modelRouting.checkServerClassifier(classifierModel?.id);
    }
  }, [autoModel.classifier, classifierModel?.id, modelRouting, serverSupported]);

  if (!localSupported && !serverUsable) {
    return null;
  }

  const classifierOptions: { value: AutoModelClassifier; label: string; description: string }[] = [
    ...(localSupported ? [{
      value: 'local' as const,
      label: t('settings:modelRouting.classifier.local.label'),
      description: t('settings:modelRouting.classifier.local.description'),
    }] : []),
    ...(serverUsable ? [{
      value: 'server' as const,
      label: t('settings:modelRouting.classifier.server.label'),
      description: t('settings:modelRouting.classifier.server.description'),
    }] : []),
  ];
  const canEnable = autoModel.classifier === 'local'
    ? setup.status === 'ready'
    : modelRouting.serverStatus === 'available';
  const classifierValue = classifierModel?.id ?? 'auto';
  const classifierLabel = classifierModel
    ? `${classifierModel.label} · ${classifierModel.providerLabel}`
    : t('settings:modelRouting.server.cheapest');
  const serverStatus = modelRouting.serverStatus;
  const serverStatusType = serverStatus === 'available' || serverStatus === 'unknown' || serverStatus === 'checking' ? 'info' : 'error';
  const serverStatusLabel = serverStatus === 'checking'
    ? t('settings:modelRouting.server.status.checking')
    : serverStatus === 'available'
      ? t('settings:modelRouting.server.status.available')
      : serverStatus === 'unsupported'
        ? t('settings:modelRouting.server.status.unsupported')
        : serverStatus === 'auth'
          ? t('settings:modelRouting.server.status.auth')
          : serverStatus === 'unavailable'
            ? t('settings:modelRouting.server.status.unavailable')
            : t('settings:modelRouting.server.status.unknown');

  function update(patch: Partial<typeof autoModel>) {
    updateChatPreferences({ autoModel: { ...autoModel, ...patch } });
  }

  function updateTier(tier: ModelComplexity, value: string) {
    update({ tiers: { ...autoModel.tiers, [tier]: value } });
  }

  function modelOptions() {
    return [
      {
        value: 'auto',
        label: t('settings:modelRouting.tiers.automatic'),
        description: t('settings:modelRouting.tiers.automaticDescription'),
      },
      ...visibleModels.map((model) => ({
        value: model.id,
        label: `${model.label} · ${model.providerLabel}`,
        description: model.supportsReasoning ? t('settings:providers.reasoningSupported') : t('settings:providers.standardModel'),
      })),
    ];
  }

  function tierLabel(tier: ModelComplexity) {
    const value = autoModel.tiers[tier];
    if (value === 'auto') {
      const suggestion = suggestions[tier] ? visibleModels.find((model) => model.id === suggestions[tier]) : undefined;
      return t('settings:modelRouting.tiers.automaticValue', { model: suggestion?.label ?? t('settings:modelRouting.tiers.unavailable') });
    }
    const model = visibleModels.find((candidate) => candidate.id === value);
    return model ? `${model.label} · ${model.providerLabel}` : t('settings:modelRouting.tiers.unavailable');
  }

  return (
    <SettingsDisclosure id="auto-model" title={t('settings:modelRouting.title')}
      attention={autoModel.enabled || Boolean(setup.error) || setup.status === 'installing' || serverStatus === 'auth' || serverStatus === 'unavailable'}>
    <View testID="settings-auto-model-section" className={cn(stylesClasses.section)}>
      <Text className={cn("text-muted-foreground")} variant="description">{t('settings:modelRouting.description')}</Text>

      <SettingSwitchRow
        description={canEnable ? t('settings:modelRouting.enable.description') : t('settings:modelRouting.enable.unavailable')}
        disabled={!canEnable}
        onValueChange={(enabled) => update({ enabled })}
        palette={palette}
        title={t('settings:modelRouting.enable.title')}
        value={autoModel.enabled}
      />

      <SettingSelectField<AutoModelClassifier>
        label={t('settings:modelRouting.classifier.label')}
        onValueChange={(classifier) => {
          update({ classifier, enabled: false });
          if (classifier === 'server') {
            modelRouting.resetServerClassifier();
          }
        }}
        options={classifierOptions}
        palette={palette}
        selectedValue={autoModel.classifier}
        testID="settings-auto-model-classifier"
        valueLabel={t(`settings:modelRouting.classifier.${autoModel.classifier}.label`)}
      />

      {autoModel.classifier === 'local' ? (
        <View className={cn(stylesClasses.panel, "bg-surface border-border")}>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:modelRouting.local.statusLabel')}: {t(`settings:modelRouting.local.status.${setup.status}`)}</Text>
          {setup.status === 'ready' ? (
            <>
              <Text className={cn("text-muted-foreground")} variant="label">{t('settings:modelRouting.local.installed', { size: formatBytes(setup.bytes) })}</Text>
              <Button onPress={() => { void setup.remove(); }} testID="settings-auto-model-remove" variant="outline"><Text>{t('settings:modelRouting.local.remove')}</Text></Button>
            </>
          ) : (
            <>
              <Button disabled={setup.status === 'installing' || !localSupported} onPress={() => { void setup.install(); }} testID="settings-auto-model-download" variant="secondary">{setup.status === 'installing' ? <Spinner size="small" /> : null}<Text>{t('settings:modelRouting.local.download', { size: formatBytes(AUTO_MODEL_PACK.bytes) })}</Text></Button>
              {setup.error ? <FieldDescription  invalid={true}>{setup.error}</FieldDescription> : null}
            </>
          )}
          <FieldDescription  invalid={false}>{t('settings:modelRouting.local.license', { model: AUTO_MODEL_PACK.label, license: AUTO_MODEL_PACK.license })}</FieldDescription>
        </View>
      ) : (
        <View className={cn(stylesClasses.panel, "bg-surface border-border")}>
          <SettingSelectField
            label={t('settings:modelRouting.server.modelLabel')}
            onValueChange={(value) => {
              update({ classifierModelId: value === 'auto' ? undefined : value, enabled: false });
              modelRouting.resetServerClassifier();
            }}
            options={[
              { value: 'auto', label: t('settings:modelRouting.server.cheapest') },
              ...visibleModels.map((model) => ({ value: model.id, label: `${model.label} · ${model.providerLabel}` })),
            ]}
            palette={palette}
            searchable
            selectedValue={classifierValue}
            testID="settings-auto-model-classifier-model"
            valueLabel={classifierLabel}
          />
          <Button disabled={serverStatus === 'checking'} onPress={() => { void modelRouting.checkServerClassifier(classifierModel?.id); }} testID="settings-auto-model-check" variant="outline">{serverStatus === 'checking' ? <Spinner size="small" /> : null}<Text>{t('settings:modelRouting.server.check')}</Text></Button>
          <FieldDescription  invalid={serverStatusType === 'error'}>{serverStatusLabel}</FieldDescription>
        </View>
      )}

      {COMPLEXITIES.map((tier) => (
        <SettingSelectField
          key={tier}
          disabled={!visibleModels.length}
          label={t(`settings:modelRouting.tiers.${tier}.label`)}
          onValueChange={(value) => updateTier(tier, value)}
          options={modelOptions()}
          palette={palette}
          searchable
          selectedValue={autoModel.tiers[tier]}
          testID={`settings-auto-model-tier-${tier}`}
          valueLabel={tierLabel(tier)}
        />
      ))}

      <SettingSwitchRow
        description={t('settings:modelRouting.protect.description')}
        onValueChange={(protectLongChats) => update({ protectLongChats })}
        palette={palette}
        title={t('settings:modelRouting.protect.title')}
        value={autoModel.protectLongChats}
      />
    </View></SettingsDisclosure>
  );
}



const stylesClasses = {
  "section": "gap-3 pt-2 pb-2",
  "panel": "rounded-[14px] border gap-2 p-3"
} as const;
