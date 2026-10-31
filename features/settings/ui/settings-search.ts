import type { SettingsTarget } from '@/shared/ui/settings/target';

type SearchableSection = {
  id: string;
  title: string;
  keywords?: string;
  targets?: SettingsTarget[];
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

// Only catalog copy is indexed, never current values, credentials or server data.
export function searchSettings<T extends SearchableSection>(sections: T[], query: string) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sections.flatMap<{ section: T; target: SettingsTarget | undefined }>((section) => {
    const matches = (text: string) => words.every((word) => normalize(text).includes(word));
    const targets = (section.targets ?? []).filter((target) => matches(`${section.title} ${target.path ?? ''} ${target.label} ${target.description ?? ''}`));
    if (targets.length) return targets.map((target) => ({ section, target }));
    return matches(`${section.title} ${section.keywords ?? ''}`) ? [{ section, target: undefined }] : [];
  });
}
