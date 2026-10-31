import { Text, type TextProps } from 'react-native';
import glyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

// Storybook runs on react-native-web, where Expo's icon fonts are not loaded.
// Render a stable placeholder so shared controls keep their layout and stories
// stay reviewable without shipping a second icon implementation.
export function MaterialCommunityIcons({
  color,
  name,
  size = 16,
  ...props
}: TextProps & {
  color?: string;
  name: string;
  size?: number;
}) {
  return <Text {...props} style={{ color, fontSize: size, lineHeight: size }}>{String(name).slice(0, 1).toUpperCase()}</Text>;
}

MaterialCommunityIcons.glyphMap = glyphMap;
export default MaterialCommunityIcons;
