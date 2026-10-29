import type { TFunction } from 'i18next';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { SettingsTarget } from './settings-search';

export function settingsTargets(t: TFunction, section: string, options: {
  native: boolean; android: boolean; localInput: boolean; localInputSupported: boolean;
  enrolled: boolean; localPlayback: boolean; speakerAvailable: boolean;
  workingSound: boolean; delivery: boolean; updates: boolean; autoModel: boolean;
  classifier: ChatPreferences['autoModel']['classifier'];
}): SettingsTarget[] {
  const field = (key: string, group?: string, description?: string): SettingsTarget => ({
    label: t(`settings:${key}`), group, path: group?.startsWith('extensions-') ? t(`settings:extensions.tabs.${group.split('-')[1]}`) : undefined, description: description ? t(`settings:${description}`) : undefined,
  });
  switch (section) {
    case 'appearance': return [field('appearance.theme.label', undefined, 'appearance.theme.description'), field('appearance.accent.label', undefined, 'appearance.accent.description'), field('appearance.slimInterface.title', undefined, 'appearance.slimInterface.description')];
    case 'responses': return [
      field('appearance.timelineDetail.label', undefined, 'appearance.timelineDetail.description'),
      field('appearance.chatTextSize', undefined, 'appearance.chatTextSizeDescription'),
      field('appearance.flatThread.title', undefined, 'appearance.flatThread.description'),
      field('voice.responseScope.label'), field('voice.nextActions.title', undefined, 'voice.nextActions.description'),
      ...(options.delivery ? [field('providers.promptDelivery.label')] : []),
    ];
    case 'language': return [field('language.title', undefined, 'language.description')];
    case 'support': return [field('support.feedback'), field('support.openSupport'), field('general.resetOnboarding'),
      ...(options.updates ? [field('autoUpdate.enable.title', undefined, 'autoUpdate.enable.description'), field('autoUpdate.checkPeriod.label')] : [])];
    case 'connection': return [field('connection.addConnection'), { label: t('common:actions.reconnect') }];
    case 'notifications': return [field('notifications.enable'), field('notifications.settings'), field('notifications.appSettings'),
      ...(options.android ? [field('notifications.batteryOptimization'), field('notifications.batterySaver'), { label: t('share:widgets.previewsTitle'), description: t('share:widgets.previewsDescription') }] : [])];
    case 'voice': return [
      field('voice.autoPlay.title', undefined, 'voice.autoPlay.description'),
      field('voice.readInterim.title', 'voice-more', 'voice.readInterim.description'), field('voice.speechRate.label', 'voice-more'),
      ...(!options.localPlayback ? [field('voice.voiceSelect.label')] : []),
      field('voice.workingSound.title', 'voice-more', 'voice.workingSound.description'),
      ...(options.workingSound ? [field('voice.workingSoundVariant.label', 'voice-more'), field('voice.workingSoundVolume.label', 'voice-more')] : []),
      field('voice.mode.label'), field('voice.speechLocale.label', options.localInput ? 'voice-setup-prepare' : undefined, 'voice.speechLocale.helper'),
      ...(options.localInput ? [field('voice.localWake.title'), ...(options.localInputSupported ? [field('voice.localWake.phraseLabel', 'voice-setup-prepare'), field('voice.localWake.commandModelLabel', 'voice-setup-prepare'), field('voice.localWake.voiceProfile', 'voice-setup-profile'),
        ...(options.enrolled ? [field('voice.localWake.speakerVerification', 'voice-setup-profile', 'voice.localWake.speakerVerificationDescription')] : [])] : [])]
        : [field('voice.wakePhrase.label', 'voice-more', 'voice.wakePhrase.helper'), field('voice.onDeviceInput.title', 'voice-more', 'voice.onDeviceInput.description')]),
      ...(options.native ? [field('voice.playbackEngine.label'), ...(options.localPlayback ? [field('voice.localTts.title', 'voice-tts'),
        ...(options.speakerAvailable ? [field('voice.localTts.speaker')] : [])] : [])] : []),
      ...(!options.localInput ? [field('voice.check.title', 'voice-more')] : []),
    ];
    case 'ai': return [field('providers.configuredProviders'),
      ...(options.autoModel ? [field('modelRouting.enable.title', 'auto-model', 'modelRouting.enable.description'), field('modelRouting.classifier.label', 'auto-model'),
        ...(options.classifier === 'server' ? [field('modelRouting.server.modelLabel', 'auto-model')] : []),
        ...['simple', 'standard', 'complex'].map((tier) => field(`modelRouting.tiers.${tier}.label`, 'auto-model')),
        field('modelRouting.protect.title', 'auto-model', 'modelRouting.protect.description')] : [])];
    case 'extensions': return [
      ...['mcp', 'plugins', 'skills', 'commands'].map((tab) => field(`extensions.tabs.${tab}`, `extensions-${tab}`)),
      field('mcp.serverName', 'extensions-mcp'), field('mcp.commandArguments', 'extensions-mcp'), field('mcp.url', 'extensions-mcp-remote'),
      field('extensions.plugins.package', 'extensions-plugins', 'extensions.plugins.warning'),
      ...['id', 'name', 'descriptionLabel', 'instructions'].map((key) => field(`extensions.skills.${key}`, 'extensions-skills')),
      ...['name', 'descriptionLabel', 'template'].map((key) => field(`extensions.commands.${key}`, 'extensions-commands')),
    ];
    case 'permissions': return [{ label: t('chat:composer.autoApproveEnabled') }, field('permissions.title', 'saved')];
    case 'advanced': return ['server', 'realtimeUpdates', 'network', 'requestLatency', 'networkUsage', 'lastError'].map((key) => field(`diagnostics.${key}`));
    case 'cloud-link': return [field('subscription.manage'), field('connect.restore'), field('connect.machines'), field('services.title')];
    default: return [];
  }
}
