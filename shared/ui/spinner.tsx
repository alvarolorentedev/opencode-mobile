import { useContext, type ComponentProps } from 'react';
import { ActivityIndicator } from 'react-native';
import { withUniwind } from 'uniwind';
import { TextClassContext } from '@/shared/ui/text';
import { cn } from '@/shared/ui/cn';

const StyledSpinner = withUniwind(ActivityIndicator, { color: { fromClassName: 'className', styleProperty: 'color' } });
export function Spinner({ className, ...props }: ComponentProps<typeof StyledSpinner>) {
  const textClass = useContext(TextClassContext);
  return <StyledSpinner accessibilityRole="progressbar" className={cn(textClass ?? 'text-primary', className)} {...props} />;
}
