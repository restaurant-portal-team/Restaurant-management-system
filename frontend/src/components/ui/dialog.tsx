import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './icon';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Action buttons (e.g. Cancel / Confirm). */
  footer?: ReactNode;
  /** "center" for confirmations/forms; "left" for the mobile navigation drawer. */
  placement?: 'center' | 'left';
  className?: string;
}

/**
 * Accessible modal built on the native <dialog> element (showModal): the browser traps focus, makes the
 * page behind it inert and handles Escape. Focus returns to the element that opened it. Clicking the
 * backdrop closes it. Content is only rendered while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = 'center',
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      returnFocusTo.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: keep React state as the single source of truth.
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'm-0 max-h-dvh max-w-none bg-transparent p-0 text-ink backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]',
        placement === 'center' && 'fixed inset-0 m-auto h-fit w-[min(32rem,calc(100vw-2rem))]',
        placement === 'left' && 'fixed inset-y-0 left-0 h-dvh w-[min(20rem,85vw)]',
      )}
    >
      {open ? (
        <div
          className={cn(
            'flex flex-col bg-surface-raised shadow-(--shadow-card) motion-reduce:animate-none',
            placement === 'center' && 'animate-fade-up rounded-(--radius-card) p-6',
            placement === 'left' && 'h-full animate-slide-in-left border-r border-line p-4',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="close" />
            </button>
          </div>
          {children ? <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
