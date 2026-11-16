import { cn } from '../../lib/cn';

export type StatusTone = 'success' | 'danger' | 'neutral';

const tones: Record<StatusTone, { badge: string; dot: string }> = {
  success: { badge: 'bg-success/12 text-success', dot: 'bg-success' },
  danger: { badge: 'bg-danger/12 text-danger', dot: 'bg-danger' },
  neutral: { badge: 'bg-surface-sunken text-ink-muted', dot: 'bg-ink-muted animate-pulse-dot' },
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: string;
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide',
        tones[tone].badge,
      )}
    >
      <span className={cn('size-2 rounded-full', tones[tone].dot)} aria-hidden="true" />
      {children}
    </span>
  );
}
