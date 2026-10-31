import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { CapabilitiesContextValue } from '@/features/ai/model/types';

export const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

export const useCapabilities = () => useDomainValue(CapabilitiesContext, 'useCapabilities');
