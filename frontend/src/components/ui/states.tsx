import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Icon, type IconName } from './icon';
import { Spinner } from './spinner';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconName;
  /** Optional call to action (e.g. "Add ingredient"). */
  action?: ReactNode;
  className?: string;
}

/** Shown when a list or section has no data. Never fill it with sample/fake data. */
export function EmptyState({ title, description, icon = 'sparkle', action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex animate-fade-up flex-col items-center rounded-(--radius-card) border border-dashed border-line px-6 py-14 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
        <Icon name={icon} className="size-6" />
      </span>
      <h2 className="mt-4 font-display text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-pretty text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  /** User-safe message only (ApiError messages are safe by design). */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Recoverable error with an optional retry. Announced to assistive technology (role="alert"). */
export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again in a moment.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-(--radius-card) border border-danger/30 bg-danger/6 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-danger/12 text-danger">
        <Icon name="alert" className="size-6" />
      </span>
      <h2 className="mt-4 font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-pretty text-ink-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Centered spinner with a visible label, for whole-section loading. */
export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-48 flex-col items-center justify-center gap-3 text-ink-muted', className)}>
      <Spinner label={label} />
      <p aria-hidden="true" className="text-sm">
        {label}…
      </p>
    </div>
  );
}

/** Placeholder block for content that is loading (shape only, no fake values). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none', className)}
    />
  );
}
