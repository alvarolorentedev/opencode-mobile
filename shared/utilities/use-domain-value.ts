import { useContext, type Context } from 'react';

export function useDomainValue<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used inside OpencodeProvider.`);
  return value;
}
