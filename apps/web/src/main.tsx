import './styles.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppToaster } from './components/ui/toaster';
import { ApiRequestError } from './lib/api';
import { createQueryClient } from './lib/query-client';

const queryClient = createQueryClient({
  queries: {
    refetchOnWindowFocus: false,
    retry: (count, err) =>
      !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <AppToaster />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
