import { describe, expect, it } from 'vitest';
import { searchSettings } from '@/components/settings/settings-search';
import { settingsTargets } from '@/components/settings/settings-targets';
import type { TFunction } from 'i18next';
import en from '@/lib/i18n/locales/en/settings.json';

const t = ((key: string) => key.startsWith('settings:')
  ? key.slice(9).split('.').reduce<any>((value, part) => value?.[part], en) ?? key
  : key) as TFunction;
const options = { native: false, android: false, localInput: false, localInputSupported: false, enrolled: false, localPlayback: false, speakerAvailable: false, workingSound: false, delivery: false, updates: false, autoModel: false, classifier: 'server' as const };

describe('settings search', () => {
  it('matches every query word across localized labels and descriptions, ignoring accents and case', () => {
    const sections = [{ id: 'appearance', title: 'Apariencia', targets: [{ label: 'Tema', description: 'Elige un tema claro u oscuro' }] }];
    expect(searchSettings(sections, '  OSCÚRO   tema ')).toHaveLength(1);
    expect(searchSettings(sections, 'tema missing')).toHaveLength(0);
    expect(searchSettings(sections, '   ')).toHaveLength(0);
  });

  it('does not index current values or server summaries', () => {
    const sections = [{ id: 'connection', title: 'Connection', summary: 'secret-gateway', targets: [{ label: 'Reconnect' }] }];
    expect(searchSettings(sections, 'secret-gateway')).toEqual([]);
    expect(searchSettings(sections, 'reconnect')[0].target?.label).toBe('Reconnect');
  });

  it('opens a category when its title matches and it has no individual targets', () => {
    const section = { id: 'cloud-link', title: 'Cloud Link' };
    expect(searchSettings([section], 'cloud')).toEqual([{ section, target: undefined }]);
  });

  it('reveals more audio settings for a wake phrase without matching playback settings', () => {
    const section = { id: 'voice', title: 'Voice & audio', targets: settingsTargets(t, 'voice', options) };
    const results = searchSettings([section], 'wake phrase');
    expect(results.map((result) => result.target?.label)).toEqual(['Wake phrase']);
    expect(results[0].target?.group).toBe('voice-more');
  });

  it('excludes unavailable platform, capability and conditional controls', () => {
    const labels = (section: string, patch = {}) => settingsTargets(t, section, { ...options, ...patch }).map((target) => target.label);
    expect(labels('voice')).not.toContain(t('settings:voice.playbackEngine.label'));
    expect(labels('voice')).not.toContain(t('settings:voice.workingSoundVolume.label'));
    expect(labels('voice', { native: true, workingSound: true })).toContain(t('settings:voice.workingSoundVolume.label'));
    expect(labels('responses')).not.toContain(t('settings:providers.promptDelivery.label'));
    expect(labels('responses', { delivery: true })).toContain(t('settings:providers.promptDelivery.label'));
    expect(labels('responses')).toContain(t('settings:appearance.timelineDetail.label'));
    expect(labels('support')).not.toContain(t('settings:autoUpdate.enable.title'));
    expect(labels('ai')).not.toContain(t('settings:modelRouting.enable.title'));
    expect(labels('ai', { autoModel: true })).toContain(t('settings:modelRouting.enable.title'));
    expect(labels('notifications')).not.toContain(t('settings:notifications.batterySaver'));
    expect(labels('notifications', { android: true })).toContain(t('settings:notifications.batterySaver'));
    expect(labels('voice', { localInput: true })).not.toContain(t('settings:voice.wakePhrase.label'));
  });

  it('selects the correct extension tab without submitting a form', () => {
    const targets = settingsTargets(t, 'extensions', options);
    expect(targets.find((target) => target.label === 'Skills')?.group).toBe('extensions-skills');
  });
});
