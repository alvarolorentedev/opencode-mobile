import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { CurrentSessionContextValue , SessionLibraryContextValue , ApprovalsContextValue } from '@/features/sessions/model/types';

export const CurrentSessionContext = createContext<CurrentSessionContextValue | null>(null);

export const SessionLibraryContext = createContext<SessionLibraryContextValue | null>(null);

export const ApprovalsContext = createContext<ApprovalsContextValue | null>(null);

export const useCurrentSession = () => useDomainValue(CurrentSessionContext, 'useCurrentSession');

export const useSessionLibrary = () => useDomainValue(SessionLibraryContext, 'useSessionLibrary');

export const useApprovals = () => useDomainValue(ApprovalsContext, 'useApprovals');
