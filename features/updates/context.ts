import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { UpdatesContextValue } from '@/features/updates/model/types';
import { useInteractionBlock } from '@/shared/ui/hooks/use-interaction-block';

export const UpdatesContext = createContext<UpdatesContextValue | null>(null);

export const useUpdates = () => useDomainValue(UpdatesContext, 'useUpdates');

export function useUpdateBlocker(active: boolean) {
  const { block } = useUpdates();
  useInteractionBlock(active, block);
}
