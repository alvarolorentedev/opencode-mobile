import { useAppearance } from '@/shared/ui/theme/appearance-context';

export function useColorScheme(): 'light' | 'dark' {
  return useAppearance().scheme;
}
