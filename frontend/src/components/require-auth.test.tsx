import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COOK, healthy, mockApi, OWNER, signedInAs, signedOut } from '../test/mock-api';
import { renderRoute } from '../test/render-route';

describe('RequireAuth (role-based routes)', () => {
  it.each(['/owner', '/kitchen', '/waiter'])('redirects signed-out visitors from %s to /login', async (path) => {
    mockApi(signedOut);
    renderRoute(path);

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders the workspace for the matching role', async () => {
    mockApi(signedInAs(OWNER));
    renderRoute('/owner');

    expect(await screen.findByText('Owner workspace')).toBeInTheDocument();
  });

  it.each(['/owner', '/waiter'])('sends kitchen staff from %s back to their own workspace', async (path) => {
    mockApi(signedInAs(COOK));
    renderRoute(path);

    expect(await screen.findByText('Kitchen staff workspace')).toBeInTheDocument();
    expect(screen.queryByText('Owner workspace')).not.toBeInTheDocument();
  });

  it('shows an error state when the session cannot be checked', async () => {
    mockApi({ 'GET /auth/me': () => ({ status: 500, body: { statusCode: 500, message: 'Internal server error' } }) });
    renderRoute('/owner');

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not check your session');
  });

  it('treats a malformed /auth/me response as an error, never as a signed-in user', async () => {
    mockApi({ 'GET /auth/me': () => ({ status: 200, body: { id: 'x', fullName: 'X', email: 'x@x.x', role: 'ADMIN' } }) });
    renderRoute('/owner');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Owner workspace')).not.toBeInTheDocument();
  });
});

describe('AccountMenu', () => {
  it('shows a sign-in link for visitors', async () => {
    mockApi({ ...signedOut, ...healthy });
    renderRoute('/');

    expect(await screen.findByRole('link', { name: 'Staff sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the signed-in user and signs out via POST /auth/logout', async () => {
    const fetchMock = mockApi({ ...signedInAs(OWNER), ...healthy, 'POST /auth/logout': () => ({ status: 204 }) });
    renderRoute('/owner');

    expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    const logoutCall = fetchMock.mock.calls.find(([input]) => (input as string).endsWith('/auth/logout'));
    expect(logoutCall?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(screen.queryByText('Ayesha Khan')).not.toBeInTheDocument();
  });
});
