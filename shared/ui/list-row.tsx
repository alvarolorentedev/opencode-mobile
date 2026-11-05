import type { ComponentProps, ReactNode } from 'react';
import { Pressable, View, type StyleProp, type TextStyle } from 'react-native';
import { cn } from '@/shared/ui/cn';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { Text } from '@/shared/ui/text';

type Decoration = (props: { color: string; style?: StyleProp<TextStyle> }) => ReactNode;
export function ListRow({ title, description, left, right, titleStyle, descriptionStyle, style, className, ...props }: Omit<ComponentProps<typeof Pressable>, 'children' | 'style' | 'className'> & {
  title: ReactNode; description?: ReactNode; left?: Decoration; right?: Decoration;
  titleStyle?: StyleProp<TextStyle>; descriptionStyle?: StyleProp<TextStyle>; style?: ComponentProps<typeof View>['style']; className?: string;
}) {
  const palette = usePalette();
  return <Pressable {...props} accessibilityRole={props.accessibilityRole ?? (props.onPress ? 'button' : undefined)}
    className={cn("min-h-target flex-row items-center gap-3 px-3 py-3", className)} style={style}>
    {left?.({ color: palette.muted })}
    <View className="flex-1 min-w-0 gap-1">
      <Text style={titleStyle}>{title}</Text>
      {description ? <Text variant="description" className="text-muted-foreground" style={descriptionStyle}>{description}</Text> : null}
    </View>
    {right?.({ color: palette.muted })}
  </Pressable>;
}
