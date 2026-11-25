import { NavLink, Outlet } from 'react-router';
import { navItems } from '../app/navigation';
import { Icon } from '../components/ui/icon';
import { cn } from '../lib/cn';
import { Brand, SkipLink } from './brand';

/**
 * Public customer shell (decision A2: customers are unauthenticated guests). Contains no staff links,
 * no account menu and no staff data. Table identification is decided before F11 (decision U1).
 */
export function GuestShell() {
  const items = navItems('CUSTOMER');

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Brand to="/menu" subtitle="Order from your table" />
          <nav aria-label="Customer navigation" className="-mx-1 overflow-x-auto">
            <ul className="flex gap-1">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors',
                        isActive
                          ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100'
                          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                      )
                    }
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-ink-muted sm:px-6">
          Prices and availability are confirmed by the restaurant when you order.
        </div>
      </footer>
    </div>
  );
}
