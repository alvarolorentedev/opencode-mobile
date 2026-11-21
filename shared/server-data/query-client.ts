import { QueryClient } from '@tanstack/react-query';

export function createServerQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false },
    mutations: { retry: false },
  } });
}
