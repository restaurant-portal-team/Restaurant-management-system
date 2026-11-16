import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary:
    'border border-line bg-surface-raised text-ink hover:bg-surface-sunken active:bg-line disabled:text-ink-muted',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:text-ink-muted',
};

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium',
        'transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
