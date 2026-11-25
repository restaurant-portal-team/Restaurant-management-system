import type { IconName } from '../components/ui/icon';
import type { StaffRole } from '../features/auth/auth-api';

/** A feature from docs/implementation-plan.txt that will deliver a section (shown on "coming soon" pages). */
export interface PlannedFeature {
  id: string;
  name: string;
}

export interface NavItem {
  label: string;
  /** Absolute path. */
  to: string;
  icon: IconName;
  /** Index/overview link: active only on an exact match. */
  end?: boolean;
  /** What the page renders until its feature exists (decision U2: no fake data). */
  page:
    | { kind: 'overview'; feature: PlannedFeature }
    | { kind: 'planned'; feature: PlannedFeature }
    | { kind: 'profile' }
    /** A built section (F05 onward): the router maps the id to its page component. */
    | { kind: 'section'; id: 'staff' };
}

export interface NavGroup {
  /** Optional visible group heading (e.g. "Inventory"). */
  label?: string;
  items: NavItem[];
}

export type ShellKind = StaffRole | 'CUSTOMER';

const F = {
  F06: { id: 'F06', name: 'Restaurant tables management' },
  F07: { id: 'F07', name: 'Ingredient inventory catalog' },
  F08: { id: 'F08', name: 'Inventory restock and adjustments' },
  F09: { id: 'F09', name: 'Menu categories and dishes' },
  F11: { id: 'F11', name: 'Customer menu and order placement' },
  F12: { id: 'F12', name: 'Kitchen incoming orders and accept-to-prepare' },
  F13: { id: 'F13', name: 'Kitchen preparation and ready handoff' },
  F14: { id: 'F14', name: 'Waiter ready-to-serve workflow' },
  F15: { id: 'F15', name: 'Order visibility and status tracking' },
  F16: { id: 'F16', name: 'Billing and cash payment' },
  F17: { id: 'F17', name: 'Automatic low-stock alerts' },
  F18: { id: 'F18', name: 'Owner dashboard and basic analytics' },
  F19: { id: 'F19', name: 'Kitchen overview dashboard' },
  F20: { id: 'F20', name: 'Waiter overview dashboard' },
} as const satisfies Record<string, PlannedFeature>;

/**
 * Single source of truth for every shell's navigation (requirements section 5). Routes are generated
 * from this config, so a link can never point to a page that does not exist. Visibility here is UX only:
 * the API enforces every permission server-side.
 */
export const NAVIGATION: Record<ShellKind, NavGroup[]> = {
  OWNER: [
    {
      items: [
        { label: 'Dashboard', to: '/owner', icon: 'dashboard', end: true, page: { kind: 'overview', feature: F.F18 } },
        { label: 'Menu Management', to: '/owner/menu', icon: 'menuBook', page: { kind: 'planned', feature: F.F09 } },
        { label: 'All Orders', to: '/owner/orders', icon: 'orders', page: { kind: 'planned', feature: F.F15 } },
      ],
    },
    {
      label: 'Inventory',
      items: [
        { label: 'Ingredients', to: '/owner/inventory/ingredients', icon: 'inventory', page: { kind: 'planned', feature: F.F07 } },
        { label: 'Stock In & Adjustments', to: '/owner/inventory/adjustments', icon: 'list', page: { kind: 'planned', feature: F.F08 } },
        { label: 'Stock History', to: '/owner/inventory/history', icon: 'history', page: { kind: 'planned', feature: F.F08 } },
        { label: 'Low Stock Alerts', to: '/owner/inventory/alerts', icon: 'alert', page: { kind: 'planned', feature: F.F17 } },
      ],
    },
    {
      label: 'Restaurant',
      items: [
        { label: 'Tables', to: '/owner/tables', icon: 'table', page: { kind: 'planned', feature: F.F06 } },
        { label: 'Staff Management', to: '/owner/staff', icon: 'users', page: { kind: 'section', id: 'staff' } },
        { label: 'Billing', to: '/owner/billing', icon: 'receipt', page: { kind: 'planned', feature: F.F16 } },
        { label: 'Settings', to: '/owner/settings', icon: 'settings', page: { kind: 'profile' } },
      ],
    },
  ],
  KITCHEN_STAFF: [
    {
      items: [
        { label: 'Kitchen Overview', to: '/kitchen', icon: 'dashboard', end: true, page: { kind: 'overview', feature: F.F19 } },
        { label: 'New Orders', to: '/kitchen/new', icon: 'flame', page: { kind: 'planned', feature: F.F12 } },
        { label: 'Preparing Orders', to: '/kitchen/preparing', icon: 'clock', page: { kind: 'planned', feature: F.F13 } },
        { label: 'Ready Orders', to: '/kitchen/ready', icon: 'checkCircle', page: { kind: 'planned', feature: F.F13 } },
        { label: 'Order History', to: '/kitchen/history', icon: 'history', page: { kind: 'planned', feature: F.F15 } },
        { label: 'My Profile', to: '/kitchen/profile', icon: 'user', page: { kind: 'profile' } },
      ],
    },
  ],
  WAITER: [
    {
      items: [
        { label: 'Waiter Overview', to: '/waiter', icon: 'dashboard', end: true, page: { kind: 'overview', feature: F.F20 } },
        { label: 'Tables', to: '/waiter/tables', icon: 'table', page: { kind: 'planned', feature: F.F20 } },
        { label: 'Active Orders', to: '/waiter/orders', icon: 'orders', page: { kind: 'planned', feature: F.F15 } },
        { label: 'Ready to Serve', to: '/waiter/ready', icon: 'checkCircle', page: { kind: 'planned', feature: F.F14 } },
        { label: 'Served Orders', to: '/waiter/served', icon: 'tray', page: { kind: 'planned', feature: F.F14 } },
        { label: 'My Profile', to: '/waiter/profile', icon: 'user', page: { kind: 'profile' } },
      ],
    },
  ],
  CUSTOMER: [
    {
      items: [
        { label: 'Menu', to: '/menu', icon: 'menuBook', page: { kind: 'planned', feature: F.F11 } },
        { label: 'Cart', to: '/cart', icon: 'cart', page: { kind: 'planned', feature: F.F11 } },
        { label: 'My Orders', to: '/my-orders', icon: 'orders', page: { kind: 'planned', feature: F.F15 } },
      ],
    },
  ],
};

export function navItems(shell: ShellKind): NavItem[] {
  return NAVIGATION[shell].flatMap((group) => group.items);
}

/** The shell's base path, i.e. the first (overview) item. */
export function shellBasePath(shell: ShellKind): string {
  return navItems(shell)[0]?.to ?? '/';
}
