import {
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryClientConfig,
} from '@tanstack/react-query';

import { ApiRequestError } from './api';
import { qk } from './queries';

/**
 * The app's QueryClient. Any 401 (an expired or revoked session) marks the user signed out, so
 * RequireAuth redirects to sign-in (keeping the current path) instead of pages showing errors.
 */
export function createQueryClient(defaultOptions: QueryClientConfig['defaultOptions'] = {}) {
  const signedOut = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) client.setQueryData(qk.me, null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: signedOut }),
    mutationCache: new MutationCache({ onError: signedOut }),
    defaultOptions,
  });
  return client;
}
