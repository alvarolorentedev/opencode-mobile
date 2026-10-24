import { useAppearance } from '@/providers/appearance-context';

export function useColorScheme(): 'light' | 'dark' {
  return useAppearance().scheme;
}
