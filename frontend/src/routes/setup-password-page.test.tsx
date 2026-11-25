import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../app/router';
import { mockApi, signedOut } from '../test/mock-api';

const TOKEN = 'Abc_def-123'.padEnd(43, 'x');

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function fill(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('Set up your account page (F05, public)', () => {
  it('explains a missing or malformed link instead of showing the form', () => {
    mockApi({});
    renderAt('/setup-password#token=too-short');
    expect(screen.getByRole('heading', { level: 1, name: 'This setup link is not valid' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('removes the token from the URL, validates locally, then activates the account once', async () => {
    let body: unknown;
    const fetchMock = mockApi({
      ...signedOut,
      'POST /staff/setup-password': (init) => {
        body = JSON.parse(init?.body as string);
        return { status: 204 };
      },
    });
    const router = renderAt(`/setup-password#token=${TOKEN}`);

    await waitFor(() => {
      expect(router.state.location.hash).toBe('');
    });
    expect(router.state.location.pathname).toBe('/setup-password');

    fill('short');
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 12 characters.');
    fill('a long enough password', 'a different password');
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.');
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts()).toHaveLength(0);

    fill('a long enough password');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your account is ready' })).toBeInTheDocument();
    expect(body).toEqual({ token: TOKEN, password: 'a long enough password' });
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the server message for an expired or used link', async () => {
    mockApi({
      'POST /staff/setup-password': () => ({
        status: 400,
        body: { message: 'This setup link is invalid or has expired. Ask the owner for a new link.' },
      }),
    });
    renderAt(`/setup-password#token=${TOKEN}`);
    fill('a long enough password');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  });

  it('is public: works signed out, shows no staff navigation and never sends the token in a URL', () => {
    const fetchMock = mockApi({ ...signedOut });
    renderAt(`/setup-password#token=${TOKEN}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Set up your account' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Owner navigation' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => (input as string).includes(TOKEN))).toBe(false);
  });
});
