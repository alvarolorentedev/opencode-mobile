import { useEffect, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import * as Toast from '@rn-primitives/toast';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';

export function Feedback({ open, onOpenChange, duration = 7000, action, style, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; duration?: number; children: ReactNode;
  action?: { label: string; onPress: () => void }; style?: StyleProp<ViewStyle>;
}) {
  const close = useRef(onOpenChange);
  useEffect(() => { close.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => {
    if (!open || duration === Infinity) return;
    const timer = setTimeout(() => close.current(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);
  if (!open) return null;
  return <View className="absolute bottom-4 left-4 right-4" style={style} pointerEvents="box-none">
    <Toast.Root type="background" open={open} onOpenChange={onOpenChange} className="bg-popover border-border rounded-control border p-4 flex-row items-center gap-3" accessibilityLiveRegion="polite">
      <Toast.Description className="text-description text-popover-foreground flex-1">{children}</Toast.Description>
      {action ? <Button variant="ghost" onPress={() => { action.onPress(); onOpenChange(false); }}><Text>{action.label}</Text></Button> : null}
    </Toast.Root>
  </View>;
}
