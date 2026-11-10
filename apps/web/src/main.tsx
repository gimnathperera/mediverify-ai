import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApiRequestError } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) =>
        !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        {/* Default (neutral) toasts: richColors' green-on-green text fails WCAG AA contrast. */}
        <Toaster position="top-right" closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
