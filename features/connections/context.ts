import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { ConnectionContextValue , DiagnosticsContextValue } from '@/features/connections/model/types';

export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export const DiagnosticsContext = createContext<DiagnosticsContextValue | null>(null);

export const useConnection = () => useDomainValue(ConnectionContext, 'useConnection');

export const useDiagnostics = () => useDomainValue(DiagnosticsContext, 'useDiagnostics');
