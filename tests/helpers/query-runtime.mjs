import { QueryClient, QueryObserver, QueriesObserver, hashKey, queryOptions, onlineManager, focusManager } from '@tanstack/react-query';

// Real query-core observers with the deterministic provider hook driver. React
// context is the boundary being supplied here, not a reimplementation of Query.
const clients = new WeakMap();
export function queryRuntime(react) {
  let client = clients.get(react);
  if (!client) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000, refetchOnReconnect: false, refetchOnWindowFocus: false } } });
    clients.set(react, client);
  }
  return {
    QueryClient, QueryObserver, queryOptions, onlineManager, focusManager,
    useQueryClient: () => client,
    useQueries({ queries }) {
      const options = queries.map((query) => client.defaultQueryOptions(query));
      const observer = react.useMemo(() => new QueriesObserver(client, options), []);
      observer.setQueries(options);
      const [, publish] = react.useState(0);
      react.useEffect(() => observer.subscribe(() => publish((value) => value + 1)), [observer]);
      return observer.getCurrentResult();
    },
    useQuery(options) {
      options = client.defaultQueryOptions(options);
      const observer = react.useMemo(() => new QueryObserver(client, options), [hashKey(options.queryKey)]);
      observer.setOptions(options, { listeners: false });
      const [, publish] = react.useState(0);
      react.useEffect(() => options.subscribed === false ? undefined : observer.subscribe(() => publish((value) => value + 1)), [observer, options.subscribed]);
      return observer.getOptimisticResult(options);
    },
  };
}
