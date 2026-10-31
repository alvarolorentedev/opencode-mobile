// Source: founded-labs/react-native-reusables @ 385834c2196f8a303cbc9057d1ac768f3bde0a3b (Uniwind, MIT).
import { cn } from '@/lib/utils';
import * as SeparatorPrimitive from '@rn-primitives/separator';

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className
      )}
      {...props}
    />
  );
}

export { Separator };
