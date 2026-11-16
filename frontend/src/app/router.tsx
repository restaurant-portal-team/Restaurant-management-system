import type { RouteObject } from 'react-router';
import { RootLayout } from '../layouts/root-layout';
import { HomePage } from '../routes/home-page';
import { NotFoundPage } from '../routes/not-found-page';

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
