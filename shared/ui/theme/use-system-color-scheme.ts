import { useColorScheme as useRNColorScheme } from 'react-native';

export function useSystemColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
