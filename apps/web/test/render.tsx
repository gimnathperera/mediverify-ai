import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

/** Shows the current path so tests can assert on navigation. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname}</output>;
}

/**
 * Render with the app's providers: a fresh QueryClient (no retries, so errors surface at once) and an
 * in-memory router. Pass `path` to mount the element under a route pattern (e.g. '/documents/:id').
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { route = '/', path }: { route?: string; path?: string } = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup>; client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {path ? (
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<p>other route</p>} />
          </Routes>
        ) : (
          ui
        )}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, user, client };
}
