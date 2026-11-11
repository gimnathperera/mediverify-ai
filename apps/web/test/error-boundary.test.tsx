import { screen } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RouteErrorBoundary } from '../src/components/ErrorBoundary';

import { renderWithProviders } from './render';

function Boom(): never {
  throw new Error('Results payload was malformed');
}

describe('RouteErrorBoundary', () => {
  it('replaces a crashed page with a recoverable message and resets on navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React logs caught errors
    const { user } = renderWithProviders(
      <>
        <Link to="/fine">go to fine</Link>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom />} />
            <Route path="/fine" element={<p>fine page</p>} />
          </Routes>
        </RouteErrorBoundary>
      </>,
      { route: '/broken' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/results payload was malformed/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents',
    );
    await user.click(screen.getByRole('link', { name: 'go to fine' }));
    expect(await screen.findByText('fine page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
