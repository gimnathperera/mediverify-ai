import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { App, RequireAuth } from '../src/App';
import { api } from '../src/lib/api';
import { AuthPage } from '../src/pages/AuthPage';

import { expectNoA11yViolations } from './a11y';
import { apiError, fx, server } from './msw';
import { renderWithProviders } from './render';

const signedOut = () =>
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: null })));

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

  it('validates every field before calling the API on sign-up', async () => {
    let calls = 0;
    server.use(
      http.post('/api/auth/signup', () => {
        calls++;
        return HttpResponse.json(fx.user(), { status: 201 });
      }),
    );
    const { user } = renderWithProviders(<AuthPage mode="signup" />, { route: '/signup' });
    const email = await screen.findByLabelText('Email');
    const password = screen.getByLabelText('Password');
    const confirm = screen.getByLabelText('Confirm password');

    // Empty form: every field gets its own message; focus goes to the first invalid field.
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(email).toHaveAccessibleDescription('Enter your email address.');
    expect(password).toHaveAccessibleDescription('Enter your password.');
    expect(confirm).toHaveAccessibleDescription('Re-enter your password to confirm it.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveFocus();

    await user.type(email, 'not-an-email');
    expect(email).toHaveAccessibleDescription(/enter a valid email address/i);
    await user.type(password, 'short');
    expect(password).toHaveAccessibleDescription('Password must be at least 8 characters.');
    await user.type(confirm, 'different');
    expect(confirm).toHaveAccessibleDescription('Passwords do not match.');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(calls).toBe(0);

    // Messages clear as each field is corrected; then the form submits.
    await user.clear(email);
    await user.type(email, 'new@example.test');
    expect(email).not.toHaveAttribute('aria-invalid');
    await user.type(password, '-and-long');
    expect(password).toHaveAccessibleDescription('At least 8 characters.');
    await user.clear(confirm);
    await user.type(confirm, 'short-and-long');
    expect(confirm).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(calls).toBe(1));
  });

  it('shows a taken email under the email field', async () => {
    server.use(
      http.post('/api/auth/signup', () =>
        apiError(409, 'EMAIL_TAKEN', 'An account with this email already exists'),
      ),
    );
    const { user } = renderWithProviders(<AuthPage mode="signup" />, { route: '/signup' });
    const email = await screen.findByLabelText('Email');
    await user.type(email, 'taken@example.test');
    await user.type(screen.getByLabelText('Password'), 'long-enough');
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(email).toHaveAccessibleDescription('An account with this email already exists'),
    );
    expect(email).toHaveFocus();
  });

  it('shows and hides the password without moving focus or the caret', async () => {
    const { user } = renderWithProviders(<AuthPage mode="login" />, { route: '/login' });
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(password, 'secret-pass');
    (password as HTMLInputElement).setSelectionRange(3, 3);

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveFocus();
    expect((password as HTMLInputElement).selectionStart).toBe(3);
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.click(hide);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveFocus();
  });

  it('does not carry a failed sign-in error over to the sign-up screen', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      ),
    );
    signedOut();
    // The real route table: both screens share one position in the tree.
    const { user } = renderWithProviders(<App />, { route: '/login' });
    await user.type(await screen.findByLabelText('Email'), 'reviewer@mediverify.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');

    await user.click(screen.getByRole('link', { name: 'Sign up' }));
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
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

  it('has no detectable accessibility violations on sign-up, including inline errors', async () => {
    const { container, user } = renderWithProviders(<AuthPage mode="signup" />, {
      route: '/signup',
    });
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
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

  it('sends the user to sign in when the session expires mid-use (any 401)', async () => {
    let expired = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ user: expired ? null : fx.user() })),
      http.get('/api/documents', () =>
        expired
          ? apiError(401, 'UNAUTHENTICATED', 'Sign in')
          : HttpResponse.json({
              items: [],
              nextCursor: null,
              counts: { all: 0, processing: 0, completed: 0, failed: 0 },
            }),
      ),
    );
    const { client } = renderWithProviders(tree, { route: '/documents' });
    expect(await screen.findByText('secret documents')).toBeInTheDocument();
    expired = true;
    // Any request failing with 401 (here a list refresh) marks the session as gone.
    await client
      .fetchQuery({
        queryKey: ['documents', 'probe'],
        queryFn: () => api.documents({ status: 'all', q: '' }),
      })
      .catch(() => undefined);
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});
