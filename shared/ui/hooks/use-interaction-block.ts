import { useLayoutEffect } from 'react';

export type InteractionBlock = () => () => void;

export function useInteractionBlock(active: boolean, block?: InteractionBlock) {
  useLayoutEffect(() => active ? block?.() : undefined, [active, block]);
}
