import { useMutation } from '@tanstack/react-query';
import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { Spinner } from '../components/ui/spinner';
import { completeSetup } from '../features/staff/staff-api';
import { ApiError } from '../lib/api-client';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/** Reads the one-time token from the URL fragment (#token=...), which is never sent to any server. */
function tokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return value !== null && TOKEN_PATTERN.test(value) ? value : null;
}

function setupErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (error.status === null) return 'The server could not be reached. Please try again.';
    if (error.status === 400 && error.message !== 'The request failed.') return error.message;
  }
  return 'Your password could not be set. Please try again.';
}

/** Public page for staff to complete their one-time account setup (F05, requirements section 9). */
export function SetupPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read once; the fragment is then removed from the address bar and browser history.
  const [token] = useState(() => tokenFromHash(location.hash));
  const setup = useMutation({
    mutationFn: (password: string) => completeSetup(token ?? '', password),
  });

  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const errorId = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash) void navigate({ pathname: location.pathname, hash: '' }, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  if (setup.isSuccess) {
    return (
      <div className="mx-auto max-w-md animate-fade-up py-6 text-center sm:py-12">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/12 text-success">
          <Icon name="checkCircle" className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">Your account is ready</h1>
        <p className="mt-2 text-sm text-ink-muted">Sign in with your email and the password you just created.</p>
        <Link
          to="/login"
          className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (token === null) {
    return (
      <div role="alert" className="mx-auto max-w-md animate-fade-up py-6 text-center sm:py-12">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
          <Icon name="alert" className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">This setup link is not valid</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Open the full link you received, or ask the owner for a new one. Links work once and expire after 24 hours.
        </p>
      </div>
    );
  }

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_LENGTH) {
      setFormError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password.length > MAX_LENGTH) {
      setFormError(`Use at most ${MAX_LENGTH} characters.`);
      return;
    }
    if (password.trim() !== password) {
      setFormError('The password must not start or end with spaces.');
      return;
    }
    if (password !== confirm) {
      setFormError('The two passwords do not match.');
      return;
    }
    setFormError(null);
    setup.mutate(password, {
      onError: (error) => {
        setFormError(setupErrorMessage(error));
      },
    });
  }

  const busy = setup.isPending;
  const inputClass =
    'block h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm transition-colors focus:border-brand-500 disabled:opacity-60';

  return (
    <div className="mx-auto max-w-md animate-fade-up py-6 sm:py-12">
      <div className="mb-8 text-center">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
          Staff account
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Set up your account</h1>
        <p className="mt-2 text-sm text-ink-muted">Choose the password you will use to sign in.</p>
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
              <label htmlFor={passwordId} className="block text-sm font-medium">
                New password
              </label>
              <div className="relative mt-2">
                <input
                  id={passwordId}
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  maxLength={MAX_LENGTH}
                  aria-describedby={hintId}
                  aria-invalid={tooShort || undefined}
                  value={password}
                  disabled={busy}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  className={`${inputClass} pr-20`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShow((v) => !v);
                  }}
                  aria-pressed={show}
                  aria-controls={`${passwordId} ${confirmId}`}
                  className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <p
                id={hintId}
                className={`mt-1.5 text-xs transition-colors ${password.length >= MIN_LENGTH ? 'text-success' : 'text-ink-muted'}`}
              >
                At least {MIN_LENGTH} characters. A short sentence is easy to remember and hard to guess.
              </p>
            </div>
            <div>
              <label htmlFor={confirmId} className="block text-sm font-medium">
                Confirm password
              </label>
              <input
                id={confirmId}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                required
                maxLength={MAX_LENGTH}
                value={confirm}
                disabled={busy}
                onChange={(e) => {
                  setConfirm(e.target.value);
                }}
                className={`${inputClass} mt-2`}
              />
            </div>
          </div>
          <Button type="submit" className="mt-7 h-11 w-full" disabled={busy}>
            {busy ? <Spinner label="Setting password" /> : null}
            {busy ? 'Setting password…' : 'Set password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
