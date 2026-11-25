import { type SubmitEvent, useId, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { roleHome } from '../features/auth/auth-api';
import { useLogin, useSession } from '../features/auth/use-auth';
import { ApiError } from '../lib/api-client';

/** Only same-app paths are accepted as a post-login destination (no open redirects). */
function safeReturnPath(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null;
  const { from } = state;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/login'
    ? from
    : null;
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Invalid email or password.';
    if (error.status === 429) return 'Too many sign-in attempts. Please wait a minute and try again.';
    if (error.status === null) return 'The server could not be reached. Please try again.';
  }
  return 'Sign-in failed. Please try again.';
}

export function LoginPage() {
  const session = useSession();
  const loginMutation = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (session.data && !loginMutation.isPending) {
    return <Navigate to={roleHome(session.data.role)} replace />;
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setFormError(null);
    loginMutation.mutate(
      { email: trimmedEmail, password },
      {
        onSuccess: (user) => {
          setPassword('');
          void navigate(safeReturnPath(location.state) ?? roleHome(user.role), { replace: true });
        },
        onError: (error) => {
          setPassword('');
          setFormError(loginErrorMessage(error));
        },
      },
    );
  }

  const busy = loginMutation.isPending;

  return (
    <div className="mx-auto max-w-md animate-fade-up py-6 sm:py-12">
      <div className="mb-8 text-center">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">Staff portal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-ink-muted">Owner, kitchen and waiter accounts only.</p>
      </div>

      <Card>
        <form noValidate onSubmit={handleSubmit} aria-describedby={formError ? errorId : undefined}>
          {formError ? (
            <p
              id={errorId}
              role="alert"
              className="mb-5 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger"
            >
              {formError}
            </p>
          ) : null}

          <div className="space-y-5">
            <div>
              <label htmlFor={emailId} className="block text-sm font-medium">
                Email
              </label>
              <input
                id={emailId}
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                disabled={busy}
                className="mt-2 block h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm transition-colors focus:border-brand-500 disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor={passwordId} className="block text-sm font-medium">
                Password
              </label>
              <div className="relative mt-2">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  disabled={busy}
                  className="block h-11 w-full rounded-xl border border-line bg-surface pr-20 pl-3.5 text-sm transition-colors focus:border-brand-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword((value) => !value);
                  }}
                  aria-pressed={showPassword}
                  aria-controls={passwordId}
                  className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          <Button type="submit" className="mt-7 w-full" disabled={busy}>
            {busy ? <Spinner label="Signing in" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-xs text-ink-muted">
        New staff accounts are created by the owner. Customers order from their table without an account.
      </p>
    </div>
  );
}
