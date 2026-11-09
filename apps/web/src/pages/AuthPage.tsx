import { DEMO_DISCLAIMER } from '@mediverify/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { Alert, Button, Card, Input, Label } from '../components/ui/primitives';
import { api, ApiRequestError } from '../lib/api';
import { qk } from '../lib/queries';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const pwId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isLogin && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const user = isLogin
        ? await api.login({ email, password })
        : await api.signup({ email, password });
      qc.setQueryData(qk.me, user);
      const to = (location.state as { from?: string } | null)?.from ?? '/documents';
      void navigate(to, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-xl font-semibold text-slate-900">
        <ShieldCheck className="h-7 w-7 text-brand-700" aria-hidden /> MediVerify AI
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">{isLogin ? 'Sign in' : 'Create an account'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Verify discharge prescriptions against an institutional formulary.
        </p>
        <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={pwId}>Password</Label>
            <Input
              id={pwId}
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isLogin && <p className="text-xs text-slate-500">At least 8 characters.</p>}
          </div>
          {error && (
            <Alert tone="danger" title={isLogin ? 'Sign-in failed' : 'Sign-up failed'}>
              {error}
            </Alert>
          )}
          <Button type="submit" className="w-full" loading={busy}>
            {isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          {isLogin ? (
            <>
              No account?{' '}
              <Link className="text-brand-700 hover:underline" to="/signup">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already registered?{' '}
              <Link className="text-brand-700 hover:underline" to="/login">
                Sign in
              </Link>
            </>
          )}
        </p>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-slate-500">{DEMO_DISCLAIMER}</p>
    </div>
  );
}
