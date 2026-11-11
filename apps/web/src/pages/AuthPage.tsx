import { DEMO_DISCLAIMER, PASSWORD_MIN_LENGTH } from '@mediverify/shared/client';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { PasswordInput } from '../components/ui/password-input';
import { Alert, Button, Card, FieldError, Input, Label } from '../components/ui/primitives';
import { api, ApiRequestError } from '../lib/api';
import { qk, useConfig } from '../lib/queries';
import { usePageTitle } from '../lib/usePageTitle';
import { validateEmail, validatePassword, validatePasswordConfirmation } from '../lib/validation';

type Field = 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<Field, string>>;

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const ids = { email: useId(), password: useId(), confirm: useId() };
  const errorIds = { email: useId(), password: useId(), confirm: useId() };
  const hintId = useId();
  const formErrorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const focusField = (field: Field) =>
    ({ email: emailRef, password: passwordRef, confirm: confirmRef })[field].current?.focus();
  const [values, setValues] = useState({ email: '', password: '', confirm: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // A field is validated as the user types only once they have left it or tried to submit.
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';
  const fields: Field[] = isLogin ? ['email', 'password'] : ['email', 'password', 'confirm'];
  usePageTitle(isLogin ? 'Sign in' : 'Create an account');
  // Hidden only once the server says so; a failed config fetch keeps the default UI.
  const signupEnabled = useConfig().data?.signupEnabled !== false;

  const validate = (field: Field, v: typeof values): string | null => {
    if (field === 'email') return validateEmail(v.email);
    if (field === 'password') return validatePassword(v.password, mode);
    return validatePasswordConfirmation(v.password, v.confirm);
  };

  const setError = (field: Field, message: string | null) =>
    setFieldErrors((e) => {
      const next = { ...e };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });

  const change = (field: Field, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    if (touched[field]) setError(field, validate(field, next));
    // Editing the password re-checks a confirmation the user has already filled in.
    if (field === 'password' && touched.confirm) setError('confirm', validate('confirm', next));
  };

  const blur = (field: Field) => {
    // Leaving an empty, untouched field is not an error yet; leaving a filled one checks it.
    if (!touched[field] && !values[field]) return;
    setTouched((t) => ({ ...t, [field]: true }));
    setError(field, validate(field, values));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errors: FieldErrors = {};
    for (const f of fields) {
      const message = validate(f, values);
      if (message) errors[f] = message;
    }
    setFieldErrors(errors);
    setTouched(Object.fromEntries(fields.map((f) => [f, true])));
    const firstInvalid = fields.find((f) => errors[f]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return; // invalid input never reaches the API
    }
    setBusy(true);
    try {
      const credentials = { email: values.email.trim(), password: values.password };
      const user = isLogin ? await api.login(credentials) : await api.signup(credentials);
      qc.setQueryData(qk.me, user);
      const to = (location.state as { from?: string } | null)?.from ?? '/documents';
      void navigate(to, { replace: true });
    } catch (err) {
      // The server is the final authority: map its field issues back onto the fields.
      const field = err instanceof ApiRequestError ? serverFieldError(err) : null;
      if (field) {
        setError(field.field, field.message);
        focusField(field.field);
      } else {
        setFormError(
          err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /** Props linking an input to its value, its error message and (sign-up password) its hint. */
  const describe = (field: Field, extra?: string) => {
    const fieldError = Boolean(fieldErrors[field]);
    // Rejected sign-in credentials make both fields invalid (the server doesn't say which is wrong).
    const invalid = fieldError || Boolean(isLogin && formError);
    const describedBy = [fieldError ? errorIds[field] : null, extra, formError ? formErrorId : null]
      .filter(Boolean)
      .join(' ');
    return {
      id: ids[field],
      value: values[field],
      'aria-invalid': invalid || undefined,
      'aria-describedby': describedBy || undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => change(field, e.target.value),
      onBlur: () => blur(field),
    };
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-xl font-semibold text-slate-900">
        <ShieldCheck className="h-7 w-7 text-brand-700" aria-hidden /> MediVerify AI
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">{isLogin ? 'Sign in' : 'Create an account'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Verify discharge prescriptions against an institutional formulary.
        </p>
        {!isLogin && !signupEnabled ? (
          <Alert tone="info" title="Sign-up is disabled" className="mt-5">
            This deployment doesn&apos;t accept new accounts. Use the reviewer credentials from the
            README.
          </Alert>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={ids.email}>Email</Label>
              <Input
                ref={emailRef}
                {...describe('email')}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
              />
              {fieldErrors.email && (
                <FieldError id={errorIds.email}>{fieldErrors.email}</FieldError>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.password}>Password</Label>
              <PasswordInput
                ref={passwordRef}
                {...describe('password', isLogin ? undefined : hintId)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
              />
              {fieldErrors.password ? (
                <FieldError id={errorIds.password}>{fieldErrors.password}</FieldError>
              ) : (
                !isLogin && (
                  <p id={hintId} className="text-xs text-slate-500">
                    At least {PASSWORD_MIN_LENGTH} characters.
                  </p>
                )
              )}
            </div>
            {!isLogin && (
              <div className="space-y-1.5">
                <Label htmlFor={ids.confirm}>Confirm password</Label>
                <PasswordInput
                  ref={confirmRef}
                  {...describe('confirm')}
                  autoComplete="new-password"
                  required
                />
                {fieldErrors.confirm && (
                  <FieldError id={errorIds.confirm}>{fieldErrors.confirm}</FieldError>
                )}
              </div>
            )}
            {formError && (
              <div id={formErrorId}>
                <Alert tone="danger" title={isLogin ? 'Sign-in failed' : 'Sign-up failed'}>
                  {formError}
                </Alert>
              </div>
            )}
            <Button type="submit" className="w-full" loading={busy}>
              {isLogin ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-slate-600">
          {isLogin && !signupEnabled ? null : isLogin ? (
            <>
              No account?{' '}
              <Link className="text-brand-700 underline underline-offset-2" to="/signup">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already registered?{' '}
              <Link className="text-brand-700 underline underline-offset-2" to="/login">
                Sign in
              </Link>
            </>
          )}
        </p>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-slate-600">{DEMO_DISCLAIMER}</p>
    </main>
  );
}

/** A server error that belongs to one field: a taken email, or a schema issue on email/password. */
function serverFieldError(err: ApiRequestError): { field: Field; message: string } | null {
  if (err.code === 'EMAIL_TAKEN') return { field: 'email', message: err.message };
  if (err.code !== 'VALIDATION_FAILED' || !Array.isArray(err.details)) return null;
  const issue = (err.details as { path?: unknown; message?: unknown }[]).find(
    (d) => d.path === 'email' || d.path === 'password',
  );
  if (!issue || typeof issue.message !== 'string') return null;
  return { field: issue.path as 'email' | 'password', message: issue.message };
}
