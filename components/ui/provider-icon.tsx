import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';

const PROVIDER_ICON_SOURCES: Record<string, ImageSourcePropType> = {
  openai: require('../../assets/provider-icons/openai.png'),
  anthropic: require('../../assets/provider-icons/anthropic.png'),
  google: require('../../assets/provider-icons/google.png'),
  groq: require('../../assets/provider-icons/groq.png'),
  openrouter: require('../../assets/provider-icons/openrouter.png'),
  mistral: require('../../assets/provider-icons/mistral.png'),
  xai: require('../../assets/provider-icons/xai.png'),
  azure: require('../../assets/provider-icons/azure.png'),
  'github-copilot': require('../../assets/provider-icons/githubcopilot.png'),
  github_copilot: require('../../assets/provider-icons/githubcopilot.png'),
  github: require('../../assets/provider-icons/github.png'),
};

export function renderProviderIcon(providerId: string | undefined, size: number, color: string): ReactNode {
  if (providerId) {
    const source = PROVIDER_ICON_SOURCES[providerId];
    if (source) {
      return <Image source={source} style={{ width: size, height: size, tintColor: color }} contentFit="contain" />;
    }
  }

  switch (providerId) {
    case 'gitlab':
      return <MaterialCommunityIcons name="gitlab" size={size} color={color} />;
    default:
      return <MaterialCommunityIcons name="cube-outline" size={size} color={color} />;
  }
}
