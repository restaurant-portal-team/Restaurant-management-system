/// <reference types="node" />
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAVIGATION, navItems, type ShellKind } from '../app/navigation';
import { COOK, mockApi, OWNER, signedInAs } from '../test/mock-api';
import { renderRoute } from '../test/render-route';

const WAITER = { id: 'u-waiter', fullName: 'Sana Iqbal', email: 'waiter@example.com', role: 'WAITER' } as const;
const USERS = { OWNER, KITCHEN_STAFF: COOK, WAITER } as const;
const NAV_NAME = { OWNER: 'Owner navigation', KITCHEN_STAFF: 'Kitchen staff navigation', WAITER: 'Waiter navigation' };

function linkNames(shell: ShellKind): string[] {
  return navItems(shell).map((item) => item.label);
}

describe('staff shells (OWNER, KITCHEN_STAFF, WAITER)', () => {
  it.each(['OWNER', 'KITCHEN_STAFF', 'WAITER'] as const)(
    '%s shell renders its own navigation only, with the overview marked as current',
    async (role) => {
      mockApi(signedInAs(USERS[role]));
      const base = navItems(role)[0]?.to ?? '/';
      renderRoute(base);

      const nav = await screen.findByRole('navigation', { name: NAV_NAME[role] });
      const names = within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(names).toEqual(linkNames(role));

      const others = (['OWNER', 'KITCHEN_STAFF', 'WAITER', 'CUSTOMER'] as const).filter((r) => r !== role);
      for (const other of others) {
        for (const item of navItems(other)) {
          if (!linkNames(role).includes(item.label)) {
            expect(within(nav).queryByRole('link', { name: item.label })).not.toBeInTheDocument();
          }
        }
      }

      expect(within(nav).getByRole('link', { name: navItems(role)[0]?.label ?? '' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Welcome, /);
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    },
  );

  it('groups the owner inventory links under a visible heading', async () => {
    mockApi(signedInAs(OWNER));
    renderRoute('/owner');
    const nav = await screen.findByRole('navigation', { name: 'Owner navigation' });
    expect(within(nav).getByText('Inventory')).toBeInTheDocument();
    expect(NAVIGATION.OWNER.map((group) => group.label)).toEqual([undefined, 'Inventory', 'Restaurant']);
  });

  it('shows an honest "coming soon" state (no fake data) for sections not built yet', async () => {
    mockApi(signedInAs(OWNER));
    renderRoute('/owner/inventory/ingredients');

    expect(await screen.findByRole('heading', { level: 1, name: 'Ingredients' })).toBeInTheDocument();
    expect(screen.getByText('Coming in F07')).toBeInTheDocument();
    expect(screen.getByText(/Ingredient inventory catalog/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Owner navigation' });
    expect(within(nav).getByRole('link', { name: 'Ingredients' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('My Profile shows the real signed-in account from /auth/me', async () => {
    mockApi(signedInAs(COOK));
    renderRoute('/kitchen/profile');

    expect(await screen.findByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument();
    expect(screen.getByText('cook@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Kitchen staff').length).toBeGreaterThan(0);
  });

  it('keeps every staff page behind RequireAuth (signed-out visitors go to /login)', async () => {
    mockApi({ 'GET /auth/me': () => ({ status: 401, body: { statusCode: 401 } }) });
    renderRoute('/owner/staff');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Owner navigation' })).not.toBeInTheDocument();
  });
});

describe('mobile navigation drawer', () => {
  it('opens as a labelled dialog, closes with Escape and returns focus to the menu button', async () => {
    mockApi(signedInAs(WAITER));
    renderRoute('/waiter');
    const button = await screen.findByRole('button', { name: 'Open navigation menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    button.focus();
    fireEvent.click(button);
    const drawer = await screen.findByRole('dialog', { name: 'Waiter menu' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByRole('navigation', { name: 'Waiter navigation (mobile)' })).toBeInTheDocument();

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Waiter navigation (mobile)' })).not.toBeInTheDocument();
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('closes after choosing a link and navigates there', async () => {
    mockApi(signedInAs(WAITER));
    renderRoute('/waiter');
    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
    const mobileNav = await screen.findByRole('navigation', { name: 'Waiter navigation (mobile)' });

    fireEvent.click(within(mobileNav).getByRole('link', { name: 'Ready to Serve' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ready to Serve' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Waiter navigation (mobile)' })).not.toBeInTheDocument();
  });

  it('has a Close button inside the drawer', async () => {
    mockApi(signedInAs(OWNER));
    renderRoute('/owner');
    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Owner menu' });

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Owner navigation (mobile)' })).not.toBeInTheDocument();
    });
  });
});

describe('customer guest shell (decision A2)', () => {
  it('renders the guest navigation without staff links, account menu or session lookups', async () => {
    const fetchMock = mockApi({});
    renderRoute('/menu');

    const nav = await screen.findByRole('navigation', { name: 'Customer navigation' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Menu', 'Cart', 'My Orders']);
    expect(within(nav).getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByText('Coming in F11')).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Staff sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    for (const staffLabel of ['Dashboard', 'Staff Management', 'New Orders', 'Ready to Serve']) {
      expect(screen.queryByRole('link', { name: staffLabel })).not.toBeInTheDocument();
    }
    expect(fetchMock.mock.calls.some(([input]) => (input as string).includes('/auth/'))).toBe(false);
  });

  it.each([
    ['/cart', 'Cart', 'Coming in F11'],
    ['/my-orders', 'My Orders', 'Coming in F15'],
  ])('%s renders its placeholder', async (path, title, coming) => {
    mockApi({});
    renderRoute(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(coming)).toBeInTheDocument();
  });
});

describe('navigation config', () => {
  it('every link path is unique and starts with its shell base path', () => {
    const all = (Object.keys(NAVIGATION) as ShellKind[]).flatMap((shell) => navItems(shell).map((item) => item.to));
    expect(new Set(all).size).toBe(all.length);
    for (const role of ['OWNER', 'KITCHEN_STAFF', 'WAITER'] as const) {
      const base = navItems(role)[0]?.to ?? '';
      for (const item of navItems(role)) expect(item.to.startsWith(base)).toBe(true);
    }
  });

  it('matches the role screens in requirements section 5', () => {
    expect(linkNames('OWNER')).toEqual([
      'Dashboard',
      'Menu Management',
      'All Orders',
      'Ingredients',
      'Stock In & Adjustments',
      'Stock History',
      'Low Stock Alerts',
      'Tables',
      'Staff Management',
      'Billing',
      'Settings',
    ]);
    expect(linkNames('KITCHEN_STAFF')).toEqual([
      'Kitchen Overview',
      'New Orders',
      'Preparing Orders',
      'Ready Orders',
      'Order History',
      'My Profile',
    ]);
    expect(linkNames('WAITER')).toEqual([
      'Waiter Overview',
      'Tables',
      'Active Orders',
      'Ready to Serve',
      'Served Orders',
      'My Profile',
    ]);
  });
});

describe('reduced motion', () => {
  it('the global stylesheet disables animations and transitions for prefers-reduced-motion', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/);
  });

  it('the drawer panel opts out of its slide animation when motion is reduced', async () => {
    mockApi(signedInAs(OWNER));
    renderRoute('/owner');
    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Owner menu' });
    const panel = drawer.firstElementChild;
    expect(panel?.className).toContain('animate-slide-in-left');
    expect(panel?.className).toContain('motion-reduce:animate-none');
  });
});
