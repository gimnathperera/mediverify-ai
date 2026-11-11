import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { AppShell } from './components/AppShell';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { DocumentPageSkeleton, DocumentsPageSkeleton, ShellSkeleton } from './components/skeletons';
import { Alert } from './components/ui/primitives';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';

// Signed-in pages are split out of the entry bundle; the sign-in page stays eager for first paint.
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const DocumentPage = lazy(() =>
  import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })),
);

/**
 * Signed-in routes. `skeleton` is the page's placeholder, shown while the session is checked and
 * while the page's code chunk loads, so the layout appears at once instead of a full-page spinner.
 */
export function RequireAuth({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <ShellSkeleton>{skeleton}</ShellSkeleton>;
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
        <Suspense fallback={skeleton}>{children}</Suspense>
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
          // Distinct keys: switching between sign-in and sign-up mounts a fresh form, so field values
          // and errors (e.g. a failed sign-in) never carry over to the other screen.
          <PublicOnly key="login">
            <AuthPage mode="login" />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly key="signup">
            <AuthPage mode="signup" />
          </PublicOnly>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireAuth skeleton={<DocumentsPageSkeleton />}>
            <DocumentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <RequireAuth skeleton={<DocumentPageSkeleton />}>
            <DocumentPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
