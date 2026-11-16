import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md animate-fade-up py-16 text-center">
      <p className="font-display text-6xl font-semibold text-brand-600">404</p>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-ink-muted">The page you are looking for does not exist.</p>
      <Link
        to="/"
        className="mt-8 inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        Back to home
      </Link>
    </section>
  );
}
