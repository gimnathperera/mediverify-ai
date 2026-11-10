import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { AppShell } from './components/AppShell';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { Alert, Spinner } from './components/ui/primitives';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';

// Signed-in pages are split out of the entry bundle; the sign-in page stays eager for first paint.
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const DocumentPage = lazy(() =>
  import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })),
);

const PageFallback = () => (
  <div className="flex justify-center py-16">
    <Spinner label="Loading page…" />
  </div>
);

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking session…" />
      </div>
    );
  if (me.isError)
    return (
      <div className="p-6">
        <Alert tone="danger" title="Cannot reach the server">
          {me.error.message}
        </Alert>
      </div>
    );
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <AppShell>
      <RouteErrorBoundary>
        <Suspense fallback={<PageFallback />}>{children}</Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

function PublicOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data) return <Navigate to="/documents" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <AuthPage mode="login" />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <AuthPage mode="signup" />
          </PublicOnly>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireAuth>
            <DocumentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <RequireAuth>
            <DocumentPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
