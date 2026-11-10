import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import { Alert, Button } from './ui/primitives';

interface Props {
  children: ReactNode;
  /** When this value changes (e.g. the route), a caught error is cleared and children re-render. */
  resetKey?: string;
}

/** Last-resort UI for render errors: never leave the user on a blank screen. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-xl p-6">
          <Alert
            tone="danger"
            title="Something went wrong displaying this page"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
                  Try again
                </Button>
                <Button size="sm" variant="outline" asChild>
                  {/* Plain link: this boundary may sit outside the router's error-free tree. */}
                  <a href="/documents">Back to documents</a>
                </Button>
              </div>
            }
          >
            {this.state.error.message}
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Per-route boundary: an error on one page doesn't survive navigating to another. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
