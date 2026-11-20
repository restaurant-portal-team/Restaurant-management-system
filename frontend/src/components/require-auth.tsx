import { Navigate, Outlet, useLocation } from 'react-router';
import { roleHome, type StaffRole } from '../features/auth/auth-api';
import { useSession } from '../features/auth/use-auth';
import { Spinner } from './ui/spinner';

interface RequireAuthProps {
  roles: readonly StaffRole[];
}

/**
 * Route guard (UX only). Signed-out users go to /login (and come back afterwards);
 * signed-in users with another role go to their own workspace. The API enforces access itself.
 */
export function RequireAuth({ roles }: RequireAuthProps) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <div className="grid min-h-60 place-items-center text-ink-muted">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (session.isError) {
    return (
      <div role="alert" className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-display text-xl font-semibold">We could not check your session</h1>
        <p className="mt-2 text-sm text-ink-muted">Make sure the backend is running, then refresh the page.</p>
      </div>
    );
  }

  const user = session.data;
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}
