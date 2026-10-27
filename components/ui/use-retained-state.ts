import { useMemo, useState, type SetStateAction } from 'react';
import { useWorkspacePresentation } from '@/providers/workspace-context';

// Unsaved UI state survives workspace navigation without becoming persisted domain data.
export function useRetainedState<T>(key: string, initial: T) {
  const presentation = useWorkspacePresentation();
  const [local, setLocal] = useState(() => ({ key, value: presentation.has(key) ? presentation.get(key) as T : initial }));
  const value = local.key === key ? local.value : presentation.has(key) ? presentation.get(key) as T : initial;
  const setValue = useMemo(() => (next: SetStateAction<T>) => {
    const previous = presentation.has(key) ? presentation.get(key) as T : initial;
    const current = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
    presentation.set(key, current); setLocal({ key, value: current });
  }, [initial, key, presentation]);
  return [value, setValue] as const;
}
