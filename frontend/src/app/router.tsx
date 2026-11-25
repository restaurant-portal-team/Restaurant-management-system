import type { RouteObject } from 'react-router';
import { RequireAuth } from '../components/require-auth';
import type { StaffRole } from '../features/auth/auth-api';
import { GuestShell } from '../layouts/guest-shell';
import { RootLayout } from '../layouts/root-layout';
import { StaffShell } from '../layouts/staff-shell';
import { HomePage } from '../routes/home-page';
import { LoginPage } from '../routes/login-page';
import { NotFoundPage } from '../routes/not-found-page';
import { SetupPasswordPage } from '../routes/setup-password-page';
import { StaffPage } from '../routes/staff-page';
import { ComingSoonPage, OverviewPage, ProfilePage } from '../routes/workspace-pages';
import { type NavItem, navItems, type ShellKind } from './navigation';

function pageFor(shell: ShellKind, item: NavItem) {
  switch (item.page.kind) {
    case 'overview':
      return shell === 'CUSTOMER' ? (
        <ComingSoonPage title={item.label} feature={item.page.feature} />
      ) : (
        <OverviewPage role={shell} feature={item.page.feature} />
      );
    case 'planned':
      return <ComingSoonPage title={item.label} feature={item.page.feature} />;
    case 'profile':
      return <ProfilePage title={item.label} />;
    case 'section':
      return <StaffPage />;
  }
}

/** Child routes generated from the navigation config, so every link has exactly one page. */
function shellRoutes(shell: ShellKind): RouteObject[] {
  return navItems(shell).map((item) => ({ path: item.to, element: pageFor(shell, item) }));
}

function staffWorkspace(role: StaffRole): RouteObject {
  return {
    element: <RequireAuth roles={[role]} />,
    children: [{ element: <StaffShell role={role} />, children: shellRoutes(role) }],
  };
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'setup-password', element: <SetupPasswordPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  staffWorkspace('OWNER'),
  staffWorkspace('KITCHEN_STAFF'),
  staffWorkspace('WAITER'),
  { element: <GuestShell />, children: shellRoutes('CUSTOMER') },
];
