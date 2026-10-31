import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { TerminalContextValue } from '@/features/terminal/model/types';

export const TerminalContext = createContext<TerminalContextValue | null>(null);

export const useTerminal = () => useDomainValue(TerminalContext, 'useTerminal');
