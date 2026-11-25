import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, OWNER, signedInAs } from '../test/mock-api';
import { renderRoute } from '../test/render-route';

const TOKEN = 'A'.repeat(43);
const SETUP = { url: `http://localhost:5173/setup-password#token=${TOKEN}`, expiresAt: '2026-11-27T10:00:00.000Z' };

const member = (overrides: Record<string, unknown>) => ({
  id: 'id-1',
  fullName: 'Sara Khan',
  email: 'sara@example.com',
  role: 'WAITER',
  status: 'ACTIVE',
  createdAt: '2026-11-20T10:00:00.000Z',
  activatedAt: '2026-11-20T11:00:00.000Z',
  deactivatedAt: null,
  ...overrides,
});

const ACTIVE = member({ id: 'id-active', fullName: 'Sara Khan', email: 'sara@example.com' });
const PENDING = member({ id: 'id-pending', fullName: 'Ali Raza', email: 'ali@example.com', status: 'PENDING', activatedAt: null });
const NEVER_SET_UP = member({
  id: 'id-never',
  fullName: 'Old Pending',
  email: 'old@example.com',
  status: 'DEACTIVATED',
  activatedAt: null,
  deactivatedAt: '2026-11-21T10:00:00.000Z',
});
const FORMER = member({
  id: 'id-former',
  fullName: 'Former Cook',
  email: 'former@example.com',
  role: 'KITCHEN_STAFF',
  status: 'DEACTIVATED',
  deactivatedAt: '2026-11-22T10:00:00.000Z',
});

const listOf = (staff: unknown[]) => ({ 'GET /staff': () => ({ status: 200, body: { staff } }) });
const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse((init?.body as string | undefined) ?? 'null');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staff Management page (F05)', () => {
  it('lists real staff with status badges, filter counts and state-appropriate actions', async () => {
    mockApi({ ...signedInAs(OWNER), ...listOf([ACTIVE, PENDING, NEVER_SET_UP, FORMER]) });
    renderRoute('/owner/staff');

    const table = await screen.findByRole('table', { name: 'Staff members' });
    expect(screen.getByRole('heading', { level: 1, name: 'Staff Management' })).toBeInTheDocument();
    expect(within(table).getByText('Pending setup')).toBeInTheDocument();
    expect(within(table).getAllByText('Deactivated')).toHaveLength(2);

    expect(screen.getByRole('button', { name: /New setup link for Ali Raza/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New setup link for Sara Khan/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Sara Khan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate Former Cook' })).toBeInTheDocument();
    // Never set up and deactivated: cannot be reactivated.
    expect(screen.queryByRole('button', { name: 'Reactivate Old Pending' })).not.toBeInTheDocument();

    const filters = screen.getByRole('group', { name: 'Filter staff by status' });
    fireEvent.click(within(filters).getByRole('button', { name: /Pending/ }));
    expect(within(filters).getByRole('button', { name: /Pending/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).queryByText('Sara Khan')).not.toBeInTheDocument();
    expect(within(table).getByText('Ali Raza')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no staff yet', async () => {
    mockApi({ ...signedInAs(OWNER), ...listOf([]) });
    renderRoute('/owner/staff');
    expect(await screen.findByRole('heading', { name: 'No staff yet' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a retryable error state when the list fails', async () => {
    let calls = 0;
    mockApi({
      ...signedInAs(OWNER),
      'GET /staff': () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { message: 'Internal server error' } } : { status: 200, body: { staff: [ACTIVE] } };
      },
    });
    renderRoute('/owner/staff');
    expect(await screen.findByRole('alert')).toHaveTextContent('Staff could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Staff members' })).toBeInTheDocument();
  });

  it('rejects a malformed API response instead of rendering it', async () => {
    mockApi({ ...signedInAs(OWNER), ...listOf([{ ...ACTIVE, role: 'OWNER' }]) });
    renderRoute('/owner/staff');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected response from the server.');
  });

  it('creates a staff member and shows the one-time setup link with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let posted: unknown;
    const fetchMock = mockApi({
      ...signedInAs(OWNER),
      ...listOf([]),
      'POST /staff': (init) => {
        posted = bodyOf(init);
        return { status: 201, body: { staff: PENDING, setup: SETUP } };
      },
    });
    renderRoute('/owner/staff');

    fireEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const form = screen.getByRole('dialog', { name: 'Add staff member' });
    fireEvent.change(within(form).getByLabelText(/Full name/), { target: { value: '  Ali   Raza ' } });
    fireEvent.change(within(form).getByLabelText(/Email/), { target: { value: 'Ali@Example.com' } });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'KITCHEN_STAFF' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create and get link' }));

    const linkDialog = await screen.findByRole('dialog', { name: 'Ali Raza was added' });
    expect(posted).toEqual({ fullName: 'Ali Raza', email: 'ali@example.com', role: 'KITCHEN_STAFF' });
    expect(within(linkDialog).getByLabelText('Setup link for Ali Raza')).toHaveValue(SETUP.url);
    expect(linkDialog).toHaveAccessibleDescription(/shown only once/);

    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SETUP.url);
    });
    expect(await within(linkDialog).findByText('Link copied to the clipboard.')).toBeInTheDocument();

    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue(SETUP.url)).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  });

  it('validates the form on the client and does not call the API with invalid input', async () => {
    const fetchMock = mockApi({ ...signedInAs(OWNER), ...listOf([]) });
    renderRoute('/owner/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const form = screen.getByRole('dialog', { name: 'Add staff member' });
    fireEvent.change(within(form).getByLabelText(/Email/), { target: { value: 'not-an-email' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create and get link' }));

    expect(within(form).getByLabelText(/Full name/)).toHaveAccessibleDescription('Enter the full name.');
    expect(within(form).getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows the server message for a duplicate email', async () => {
    mockApi({
      ...signedInAs(OWNER),
      ...listOf([]),
      'POST /staff': () => ({ status: 409, body: { message: 'A staff member with this email already exists.' } }),
    });
    renderRoute('/owner/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const form = screen.getByRole('dialog', { name: 'Add staff member' });
    fireEvent.change(within(form).getByLabelText(/Full name/), { target: { value: 'Dup' } });
    fireEvent.change(within(form).getByLabelText(/Email/), { target: { value: 'sara@example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create and get link' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A staff member with this email already exists.');
  });

  it('edits an active member: email is locked and only changed fields are sent', async () => {
    let patched: unknown;
    mockApi({
      ...signedInAs(OWNER),
      ...listOf([ACTIVE]),
      'PATCH /staff/id-active': (init) => {
        patched = bodyOf(init);
        return { status: 200, body: { staff: { ...ACTIVE, role: 'KITCHEN_STAFF' } } };
      },
    });
    renderRoute('/owner/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sara Khan' }));
    const form = screen.getByRole('dialog', { name: 'Edit Sara Khan' });
    expect(within(form).getByLabelText(/Email/)).toBeDisabled();

    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'KITCHEN_STAFF' } });
    expect(within(form).getByLabelText('Role')).toHaveAccessibleDescription(/signs this person out/);
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Sara Khan was updated.')).toBeInTheDocument();
    expect(patched).toEqual({ role: 'KITCHEN_STAFF' });
  });

  it('deactivates only after confirmation', async () => {
    const fetchMock = mockApi({
      ...signedInAs(OWNER),
      ...listOf([ACTIVE]),
      'POST /staff/id-active/deactivate': () => ({
        status: 200,
        body: { staff: { ...ACTIVE, status: 'DEACTIVATED', deactivatedAt: '2026-11-26T10:00:00.000Z' } },
      }),
    });
    renderRoute('/owner/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Sara Khan' }));
    const confirm = screen.getByRole('dialog', { name: 'Deactivate Sara Khan?' });
    expect(confirm).toHaveAccessibleDescription(/signed out of every device/);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock.mock.calls.some(([input]) => (input as string).includes('/deactivate'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Sara Khan' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Sara Khan was deactivated and signed out.')).toBeInTheDocument();
  });

  it('issues a new setup link for a pending member', async () => {
    mockApi({
      ...signedInAs(OWNER),
      ...listOf([PENDING]),
      'POST /staff/id-pending/setup-link': () => ({ status: 200, body: { setup: SETUP } }),
    });
    renderRoute('/owner/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'New setup link for Ali Raza' }));
    const dialog = await screen.findByRole('dialog', { name: 'New setup link' });
    expect(within(dialog).getByLabelText('Setup link for Ali Raza')).toHaveValue(SETUP.url);
  });

  it('sends the user to sign in when the session has ended (401)', async () => {
    let signedIn = true;
    mockApi({
      'GET /auth/me': () => (signedIn ? { status: 200, body: OWNER } : { status: 401, body: { statusCode: 401 } }),
      'GET /staff': () => {
        signedIn = false;
        return { status: 401, body: { statusCode: 401, message: 'Authentication required.' } };
      },
    });
    renderRoute('/owner/staff');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });
});
