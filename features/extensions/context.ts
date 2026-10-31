import { createContext } from 'react';
import { useDomainValue } from '@/shared/utilities/use-domain-value';
import type { McpContextValue , ExtensionsContextValue } from '@/features/extensions/model/types';

export const McpContext = createContext<McpContextValue | null>(null);

export const ExtensionsContext = createContext<ExtensionsContextValue | null>(null);

export const useMcp = () => useDomainValue(McpContext, 'useMcp');

export const useExtensions = () => useDomainValue(ExtensionsContext, 'useExtensions');
