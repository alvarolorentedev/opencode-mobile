import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { UpdatesContextValue } from '@/features/updates/model/types';

export const UpdatesContext = createContext<UpdatesContextValue | null>(null);

export const useUpdates = () => useDomainValue(UpdatesContext, 'useUpdates');
