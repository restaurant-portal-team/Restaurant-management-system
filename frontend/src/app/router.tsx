import type { RouteObject } from 'react-router';
import { RequireAuth } from '../components/require-auth';
import { RootLayout } from '../layouts/root-layout';
import { HomePage } from '../routes/home-page';
import { LoginPage } from '../routes/login-page';
import { NotFoundPage } from '../routes/not-found-page';
import { WorkspacePage } from '../routes/workspace-page';

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      {
        element: <RequireAuth roles={['OWNER']} />,
        children: [{ path: 'owner', element: <WorkspacePage role="OWNER" /> }],
      },
      {
        element: <RequireAuth roles={['KITCHEN_STAFF']} />,
        children: [{ path: 'kitchen', element: <WorkspacePage role="KITCHEN_STAFF" /> }],
      },
      {
        element: <RequireAuth roles={['WAITER']} />,
        children: [{ path: 'waiter', element: <WorkspacePage role="WAITER" /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
