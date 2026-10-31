import { useId, type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';
import { Input } from './input';
import { Label } from './label';
import { Text } from './text';
import { cn } from '@/lib/utils';

export type TextFieldProps = ComponentProps<typeof Input> & {
  label?: string;
  invalid?: boolean;
  disabled?: boolean;
  endAdornment?: ReactNode;
  startAdornment?: ReactNode;
};

export function TextField({ label, invalid, disabled, endAdornment, startAdornment, className, nativeID, accessibilityLabel, ...props }: TextFieldProps) {
  const id = useId();
  const inputId = nativeID ?? id;
  return <View className={cn("gap-1 min-w-0", className)}>
    {label ? <Label nativeID={`${inputId}-label`} htmlFor={inputId}>{label}</Label> : null}
    <View className="flex-row items-center gap-1">
      {startAdornment}
      <Input {...props} nativeID={inputId} accessibilityLabel={accessibilityLabel ?? label}
        aria-labelledby={label ? `${inputId}-label` : undefined} aria-invalid={invalid}
        editable={disabled ? false : props.editable} className={cn('flex-1', invalid && 'border-destructive')} />
      {endAdornment}
    </View>
  </View>;
}

export function FieldDescription({ invalid = false, hidden = false, className, ...props }: ComponentProps<typeof Text> & { invalid?: boolean; hidden?: boolean }) {
  if (hidden) return null;
  return <Text variant="description" accessibilityLiveRegion={invalid ? 'polite' : undefined}
    className={cn(invalid ? 'text-destructive' : 'text-muted-foreground', className)} {...props} />;
}
