import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { RequireAuth } from '../src/App';
import { AuthPage } from '../src/pages/AuthPage';

import { expectNoA11yViolations } from './a11y';
import { apiError, fx, server } from './msw';
import { renderWithProviders } from './render';

const signedOut = () =>
  server.use(http.get('/api/auth/me', () => apiError(401, 'UNAUTHENTICATED', 'Sign in')));

describe('AuthPage', () => {
  it('signs in and returns the user to the page they came from', async () => {
    let body: unknown;
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(fx.user());
      }),
    );
    const { user } = renderWithProviders(<AuthPage mode="login" />, { route: '/login' });
    expect(document.title).toBe('Sign in · MediVerify AI');
    await user.type(screen.getByLabelText('Email'), 'reviewer@mediverify.test');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/documents'));
    expect(body).toEqual({ email: 'reviewer@mediverify.test', password: 'correct-horse' });
  });

  it('shows the server error and links it to the email field', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
      ),
    );
    const { user } = renderWithProviders(<AuthPage mode="login" />, { route: '/login' });
    await user.type(screen.getByLabelText('Email'), 'reviewer@mediverify.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/incorrect/);
  });

  it('validates the password length before calling the API on sign-up', async () => {
    const { user } = renderWithProviders(<AuthPage mode="signup" />, { route: '/signup' });
    await screen.findByRole('button', { name: 'Create account' });
    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/);
  });

  it('hides the sign-up form when the server disables sign-up', async () => {
    server.use(
      http.get('/api/config', () => HttpResponse.json({ ...fx.config(), signupEnabled: false })),
    );
    renderWithProviders(<AuthPage mode="signup" />, { route: '/signup' });
    expect(await screen.findByText(/sign-up is disabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderWithProviders(<AuthPage mode="login" />, { route: '/login' });
    await screen.findByRole('button', { name: 'Sign in' });
    await expectNoA11yViolations(container);
  });
});

describe('RequireAuth', () => {
  const tree = (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route
        path="/documents"
        element={
          <RequireAuth skeleton={<p>page skeleton</p>}>
            <p>secret documents</p>
          </RequireAuth>
        }
      />
    </Routes>
  );

  it('redirects signed-out users to sign in', async () => {
    signedOut();
    renderWithProviders(tree, { route: '/documents' });
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret documents')).not.toBeInTheDocument();
  });

  it('renders the page inside the app shell with fixture-mode and demo banners', async () => {
    renderWithProviders(tree, { route: '/documents' });
    expect(await screen.findByText('secret documents')).toBeInTheDocument();
    expect(await screen.findByText(/fixture mode/i)).toBeInTheDocument();
    expect(screen.getByText(/demo only/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main',
    );
  });
});
