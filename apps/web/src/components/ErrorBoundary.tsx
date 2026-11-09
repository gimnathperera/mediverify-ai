import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Alert, Button } from './ui/primitives';

/** Last-resort UI for render errors: never leave the user on a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-xl p-6">
          <Alert
            tone="danger"
            title="Something went wrong displaying this page"
            action={
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
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
