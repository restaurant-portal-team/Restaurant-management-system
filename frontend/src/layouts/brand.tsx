import { Link } from "react-router";

/** Logo + product name, linking to the given home path. */
export function Brand({
  to = "/",
  subtitle = "Next-generation restaurant system",
}: {
  to?: string;
  subtitle?: string;
}) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-lg">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-sm transition-transform duration-300 ease-out group-hover:-rotate-6 motion-reduce:transition-none motion-reduce:group-hover:rotate-0">
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5m4-5v5M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block font-display text-base leading-tight font-semibold tracking-tight">
          Restonex
        </span>
        <span className="block text-xs leading-tight text-ink-muted">
          {subtitle}
        </span>
      </span>
    </Link>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:shadow-(--shadow-card)"
    >
      Skip to content
    </a>
  );
}
