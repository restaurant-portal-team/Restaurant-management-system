import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { roleHome, roleLabel } from '../features/auth/auth-api';
import { useLogout, useSession } from '../features/auth/use-auth';

/** Header account area: signed-in staff see their name, role and Sign out; others see a sign-in link. */
export function AccountMenu() {
  const session = useSession();
  const logoutMutation = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const user = session.data;
  if (!user) {
    if (session.isPending || location.pathname === '/login') return null;
    return (
      <Link
        to="/login"
        className="inline-flex h-9 items-center rounded-xl border border-line px-3.5 text-sm font-medium transition-colors hover:bg-surface-sunken"
      >
        Staff sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link to={roleHome(user.role)} className="hidden text-right sm:block" aria-label="Go to my workspace">
        <span className="block text-sm leading-tight font-medium">{user.fullName}</span>
        <span className="block text-xs leading-tight text-ink-muted">{roleLabel(user.role)}</span>
      </Link>
      <Button
        variant="secondary"
        className="h-9"
        disabled={logoutMutation.isPending}
        onClick={() => {
          logoutMutation.mutate(undefined, {
            onSettled: () => {
              void navigate('/login', { replace: true });
            },
          });
        }}
      >
        {logoutMutation.isPending ? <Spinner label="Signing out" /> : null}
        Sign out
      </Button>
    </div>
  );
}
