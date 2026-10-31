// Source: founded-labs/react-native-reusables @ 385834c2196f8a303cbc9057d1ac768f3bde0a3b (Uniwind, MIT).
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { cn } from '@/shared/ui/cn';
export function Skeleton({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn('rounded-control bg-muted', className)} {...props} />;
}
