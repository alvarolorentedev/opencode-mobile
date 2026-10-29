import { Text } from 'react-native';

// Storybook runs on react-native-web, where Expo's icon fonts are not loaded.
// Render a stable placeholder so Paper controls keep their layout and stories
// stay reviewable without shipping a second icon implementation.
export function MaterialCommunityIcons({
  color,
  name,
  size = 16,
}: {
  color?: string;
  name: string;
  size?: number;
}) {
  return <Text style={{ color, fontSize: size, lineHeight: size }}>{String(name).slice(0, 1).toUpperCase()}</Text>;
}

export default MaterialCommunityIcons;
