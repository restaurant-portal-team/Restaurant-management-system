import { Link, Outlet } from 'react-router';
import { AccountMenu } from './account-menu';

export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:shadow-(--shadow-card)"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-3 rounded-lg">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm transition-transform duration-300 ease-out group-hover:-rotate-6">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
                <path
                  d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5m4-5v5M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="font-display text-base font-semibold tracking-tight">
              Restaurant Portal
            </span>
          </Link>
          <AccountMenu />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-muted sm:px-6">
          Restaurant Management Portal · Development build
        </div>
      </footer>
    </div>
  );
}
