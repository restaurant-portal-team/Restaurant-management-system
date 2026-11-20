import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, OWNER, COOK, signedInAs, signedOut } from '../test/mock-api';
import { renderRoute } from '../test/render-route';

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('renders an accessible sign-in form', async () => {
    mockApi(signedOut);
    renderRoute('/login');

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('validates empty fields without calling the API', async () => {
    const fetchMock = mockApi(signedOut);
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email and password.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('toggles password visibility', async () => {
    mockApi(signedOut);
    renderRoute('/login');
    const toggle = await screen.findByRole('button', { name: 'Show' });

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('signs in with credentials included and redirects to the role workspace', async () => {
    const fetchMock = mockApi({ ...signedOut, 'POST /auth/login': () => ({ status: 200, body: { user: OWNER } }) });
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fillAndSubmit('  owner@example.com ', 'correct horse battery');

    expect(await screen.findByRole('heading', { name: 'Welcome, Ayesha' })).toBeInTheDocument();
    expect(screen.getByText('Owner workspace')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(loginCall?.[1]).toMatchObject({ credentials: 'include' });
    expect(JSON.parse(loginCall?.[1]?.body as string)).toEqual({
      email: 'owner@example.com',
      password: 'correct horse battery',
    });
  });

  it('shows the generic error on 401 and clears the password', async () => {
    mockApi({
      ...signedOut,
      'POST /auth/login': () => ({ status: 401, body: { statusCode: 401, message: 'Invalid email or password.' } }),
    });
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fillAndSubmit('owner@example.com', 'wrong password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('explains rate limiting (429)', async () => {
    mockApi({ ...signedOut, 'POST /auth/login': () => ({ status: 429, body: { statusCode: 429 } }) });
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fillAndSubmit('owner@example.com', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many sign-in attempts/);
  });

  it('sends already signed-in staff to their own workspace', async () => {
    mockApi(signedInAs(COOK));
    renderRoute('/login');

    expect(await screen.findByText('Kitchen staff workspace')).toBeInTheDocument();
  });

  it('returns to the originally requested page after signing in (same-app paths only)', async () => {
    mockApi({ ...signedOut, 'POST /auth/login': () => ({ status: 200, body: { user: COOK } }) });
    renderRoute('/kitchen');
    await screen.findByRole('heading', { name: 'Sign in' });

    fillAndSubmit('cook@example.com', 'correct horse battery');

    await waitFor(() => {
      expect(screen.getByText('Kitchen staff workspace')).toBeInTheDocument();
    });
  });
});
