import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { getLanguageDirection } from '@/shared/i18n/languages';
import { TextClassContext } from '@/shared/ui/text';
import { cn } from '@/shared/ui/cn';
import { withUniwind } from 'uniwind';

// Reusables icons use the existing app icon vocabulary and installed font assets.
const StyledIcon = withUniwind(MaterialCommunityIcons, {
  color: { fromClassName: 'className', styleProperty: 'color' },
  size: { fromClassName: 'className', styleProperty: 'width' },
});

const RTL_ICON_NAMES: Record<string, string> = {
  'arrow-left': 'arrow-right',
  'arrow-right': 'arrow-left',
  'chevron-left': 'chevron-right',
  'chevron-right': 'chevron-left',
};

export function Icon({ className, name, size, ...props }: Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name'> & { name?: string; className?: string }) {
  const textClass = useContext(TextClassContext);
  const { i18n } = useTranslation();
  const isRTL = getLanguageDirection(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const iconName = isRTL ? RTL_ICON_NAMES[name ?? ''] ?? name : name;
  // A caller-provided size already sets the glyph font size. Do not also impose
  // the default 20 px box, or the wider glyph is clipped on the right.
  return <StyledIcon name={iconName && iconName in MaterialCommunityIcons.glyphMap ? iconName as ComponentProps<typeof MaterialCommunityIcons>['name'] : 'help-circle-outline'} accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn('text-foreground', size === undefined && 'size-5', textClass, className)} size={size} {...props} />;
}
