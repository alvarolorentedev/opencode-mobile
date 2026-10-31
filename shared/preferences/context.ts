import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { PreferencesContextValue } from '@/shared/preferences/types';

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export const usePreferences = () => useDomainValue(PreferencesContext, 'usePreferences');
