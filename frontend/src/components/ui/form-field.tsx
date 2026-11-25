import {
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type SelectHTMLAttributes,
  useId,
} from 'react';
import { cn } from '../../lib/cn';

const controlClasses =
  'block h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors ' +
  'placeholder:text-ink-muted focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-invalid:border-danger';

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlClasses, 'pr-9', className)} {...props}>
      {children}
    </select>
  );
}

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

interface FormFieldProps {
  label: string;
  /** Exactly one control (TextInput, Select, textarea, ...). It receives id, aria-describedby and aria-invalid. */
  children: ReactElement<ControlProps>;
  hint?: string;
  /** Client-side message only; the server remains the authority for validation. */
  error?: string | null | undefined;
  required?: boolean;
  className?: string;
}

/** Label + control + hint + error, wired together for screen readers. */
export function FormField({ label, children, hint, error, required = false, className }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        ...(describedBy !== undefined && { 'aria-describedby': describedBy }),
        ...(error ? { 'aria-invalid': true } : {}),
        ...(required && { required: true }),
      })
    : children;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="mt-2">{control}</div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
