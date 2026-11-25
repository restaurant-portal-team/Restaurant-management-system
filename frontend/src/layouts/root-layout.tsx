import { Outlet } from 'react-router';
import { AccountMenu } from './account-menu';
import { Brand, SkipLink } from './brand';

/** Public layout for the landing page, /login and the 404 page. Workspaces use StaffShell / GuestShell. */
export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />

      <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <AccountMenu />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 outline-none sm:px-6 sm:py-14">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-muted sm:px-6">
          Restonex · Next-generation restaurant system · Development build
        </div>
      </footer>
    </div>
  );
}
