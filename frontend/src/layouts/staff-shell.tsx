import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { NAVIGATION, shellBasePath } from '../app/navigation';
import { Dialog } from '../components/ui/dialog';
import { Icon } from '../components/ui/icon';
import { roleLabel, type StaffRole } from '../features/auth/auth-api';
import { AccountMenu } from './account-menu';
import { Brand, SkipLink } from './brand';
import { SidebarNav } from './sidebar-nav';

/**
 * Authenticated workspace frame for OWNER, KITCHEN_STAFF and WAITER (always rendered inside RequireAuth).
 * Desktop (lg+): persistent sidebar. Smaller screens: a menu button opens the same navigation in a
 * modal drawer (native <dialog>: focus trap, Escape, focus returns to the button).
 */
export function StaffShell({ role }: { role: StaffRole }) {
  const { pathname } = useLocation();
  // The drawer remembers the path it was opened on, so any route change (link, back/forward) closes it.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = menuOpenedAt === pathname;
  const groups = NAVIGATION[role];
  const label = roleLabel(role);
  const navLabel = `${label} navigation`;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SkipLink />

      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto border-r border-line bg-surface-raised px-4 py-5 lg:flex">
        <Brand to={shellBasePath(role)} subtitle={label} />
        <SidebarNav groups={groups} label={navLabel} />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2 lg:invisible">
              <button
                type="button"
                onClick={() => {
                  setMenuOpenedAt(pathname);
                }}
                aria-label="Open navigation menu"
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                className="grid size-11 place-items-center rounded-xl text-ink transition-colors hover:bg-surface-sunken lg:hidden"
              >
                <Icon name="menu" />
              </button>
              <span className="lg:hidden">
                <Brand to={shellBasePath(role)} />
              </span>
            </div>
            <AccountMenu />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10">
          <Outlet />
        </main>
      </div>

      <Dialog
        open={menuOpen}
        onClose={() => {
          setMenuOpenedAt(null);
        }}
        title={`${label} menu`}
        placement="left"
      >
        <SidebarNav
          groups={groups}
          label={`${navLabel} (mobile)`}
          onNavigate={() => {
            setMenuOpenedAt(null);
          }}
        />
      </Dialog>
    </div>
  );
}
