import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PageHeaderProps {
  title: string;
  /** Small uppercase label above the title (e.g. "Owner workspace"). */
  eyebrow?: string;
  description?: string;
  /** Primary page actions (buttons/links), right-aligned on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** Every page starts with exactly one PageHeader, which renders the page's single <h1>. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn('flex animate-fade-up flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-pretty text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
