// Source: founded-labs/react-native-reusables @ 385834c2196f8a303cbc9057d1ac768f3bde0a3b (Uniwind, MIT).
import { cn } from '@/shared/ui/cn';
import { Platform, TextInput } from 'react-native';
import { usePalette } from '@/shared/ui/theme/use-palette';

function Input({
  className,
  ...props
}: React.ComponentProps<typeof TextInput>) {
  const palette = usePalette();
  return (
    <TextInput
      selectionColor={props.selectionColor ?? palette.tint}
      cursorColor={props.cursorColor ?? palette.tint}
      className={cn(
        'dark:bg-input/30 border-input bg-background text-foreground flex min-h-field w-full min-w-0 flex-row items-center rounded-control border px-3 py-1 text-base leading-5 shadow-sm shadow-foreground/5',
        props.editable === false &&
          cn(
            'opacity-50',
            Platform.select({ web: 'disabled:pointer-events-none disabled:cursor-not-allowed' })
          ),
        Platform.select({
          web: cn(
            'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow]',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'
          ),
          native: 'placeholder:text-muted-foreground/50',
        }),
        className
      )}
      {...props}
    />
  );
}

export { Input };
