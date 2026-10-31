import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, type ComponentProps } from 'react';
import { TextClassContext } from '@/shared/ui/text';
import { cn } from '@/shared/ui/cn';
import { withUniwind } from 'uniwind';

// Reusables icons use the existing app icon vocabulary and installed font assets.
const StyledIcon = withUniwind(MaterialCommunityIcons, {
  color: { fromClassName: 'className', styleProperty: 'color' },
  size: { fromClassName: 'className', styleProperty: 'width' },
});

export function Icon({ className, name, ...props }: Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name'> & { name?: string; className?: string }) {
  const textClass = useContext(TextClassContext);
  return <StyledIcon name={name && name in MaterialCommunityIcons.glyphMap ? name as ComponentProps<typeof MaterialCommunityIcons>['name'] : 'help-circle-outline'} accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn('text-foreground size-5', textClass, className)} {...props} />;
}
