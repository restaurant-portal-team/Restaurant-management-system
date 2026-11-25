import { type SubmitEvent, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { type Column, DataTable } from '../components/ui/data-table';
import { Dialog } from '../components/ui/dialog';
import { FormField, Select, TextInput } from '../components/ui/form-field';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { Spinner } from '../components/ui/spinner';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/states';
import { StatusBadge, type StatusTone } from '../components/ui/status-badge';
import { roleLabel } from '../features/auth/auth-api';
import {
  MANAGED_ROLES,
  type ManagedRole,
  type SetupLink,
  STATUS_LABEL,
  type StaffInput,
  type StaffMember,
  type StaffStatus,
} from '../features/staff/staff-api';
import {
  useActivateStaff,
  useCreateStaff,
  useDeactivateStaff,
  useRegenerateSetupLink,
  useStaffList,
  useUpdateStaff,
} from '../features/staff/use-staff';
import { ApiError } from '../lib/api-client';
import { cn } from '../lib/cn';

const STATUS_TONE: Record<StaffStatus, StatusTone> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  DEACTIVATED: 'inactive',
};
const FILTERS = ['ALL', 'ACTIVE', 'PENDING', 'DEACTIVATED'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  ALL: 'All',
  ACTIVE: 'Active',
  PENDING: 'Pending',
  DEACTIVATED: 'Deactivated',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Client-side failures (unreachable server, malformed response) carry a safe message already.
    if (error.status === null) return error.message;
    if (error.status === 401) return 'Your session has ended. Please sign in again.';
    if (error.status === 429) return 'Too many requests. Please wait a moment and try again.';
    if (error.message !== 'The request failed.') return error.message;
  }
  return 'The change could not be saved. Please try again.';
}

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; member: StaffMember }
  | { kind: 'confirm'; action: 'deactivate' | 'activate'; member: StaffMember }
  | { kind: 'link'; name: string; link: SetupLink; isNew: boolean }
  | null;

/** F05 Owner staff management. All data comes from /api/v1/staff; the API enforces OWNER-only access. */
export function StaffPage() {
  const list = useStaffList();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const regenerate = useRegenerateSetupLink();

  const staff = list.data ?? [];
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, f === 'ALL' ? staff.length : staff.filter((m) => m.status === f).length]),
  ) as Record<Filter, number>;
  const rows = filter === 'ALL' ? staff : staff.filter((m) => m.status === filter);
  const close = () => {
    setDialog(null);
  };

  function issueLink(member: StaffMember) {
    setNotice(null);
    regenerate.mutate(member.id, {
      onSuccess: (link) => {
        setDialog({ kind: 'link', name: member.fullName, link, isNew: false });
      },
      onError: (error) => {
        setNotice(errorMessage(error));
      },
    });
  }

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => (
        <div className="min-w-44">
          <p className="font-medium">{m.fullName}</p>
          <p className="text-xs break-all text-ink-muted">{m.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (m) => roleLabel(m.role) },
    {
      key: 'status',
      header: 'Status',
      cell: (m) => <StatusBadge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusBadge>,
    },
    {
      key: 'added',
      header: 'Added',
      cell: (m) => <time dateTime={m.createdAt}>{dateFormat.format(new Date(m.createdAt))}</time>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            className="h-11"
            aria-label={`Edit ${m.fullName}`}
            onClick={() => {
              setDialog({ kind: 'edit', member: m });
            }}
          >
            <Icon name="edit" className="size-4" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          {m.status === 'PENDING' ? (
            <Button
              variant="ghost"
              className="h-11"
              aria-label={`New setup link for ${m.fullName}`}
              disabled={regenerate.isPending}
              onClick={() => {
                issueLink(m);
              }}
            >
              <Icon name="link" className="size-4" />
              <span className="hidden sm:inline">Setup link</span>
            </Button>
          ) : null}
          {m.status === 'DEACTIVATED' ? (
            m.activatedAt !== null ? (
              <Button
                variant="ghost"
                className="h-11"
                aria-label={`Reactivate ${m.fullName}`}
                onClick={() => {
                  setDialog({ kind: 'confirm', action: 'activate', member: m });
                }}
              >
                Reactivate
              </Button>
            ) : null
          ) : (
            <Button
              variant="ghost"
              className="h-11 text-danger hover:text-danger"
              aria-label={`Deactivate ${m.fullName}`}
              onClick={() => {
                setDialog({ kind: 'confirm', action: 'deactivate', member: m });
              }}
            >
              Deactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Restaurant"
        title="Staff Management"
        description="Add kitchen staff and waiters, share their one-time setup link, and control who can sign in."
        actions={
          <Button
            onClick={() => {
              setNotice(null);
              setDialog({ kind: 'create' });
            }}
          >
            <Icon name="plus" className="size-4" />
            Add staff
          </Button>
        }
      />

      <p role="status" aria-live="polite" className={cn('text-sm', notice ? 'animate-fade-up' : 'sr-only')}>
        {notice}
      </p>

      {list.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only" role="status">
            Loading staff
          </span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState
          title="Staff could not be loaded"
          message={errorMessage(list.error)}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div role="group" aria-label="Filter staff by status" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                }}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
                  filter === f
                    ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100'
                    : 'border-line text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {FILTER_LABEL[f]}
                <span className="rounded-full bg-surface-sunken px-2 text-xs tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>

          <DataTable
            caption="Staff members"
            columns={columns}
            rows={rows}
            getRowKey={(m) => m.id}
            empty={
              <EmptyState
                icon="users"
                title={staff.length === 0 ? 'No staff yet' : `No ${FILTER_LABEL[filter].toLowerCase()} staff`}
                description={
                  staff.length === 0
                    ? 'Add your first kitchen staff member or waiter. They set their own password with a one-time link.'
                    : 'Choose another filter to see the rest of your team.'
                }
              />
            }
          />
        </div>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <StaffFormDialog
          member={dialog.kind === 'edit' ? dialog.member : null}
          onClose={close}
          onCreated={(member, link) => {
            setDialog({
              kind: 'link',
              name: member.fullName,
              link,
              isNew: true,
            });
          }}
          onSaved={(member) => {
            setNotice(`${member.fullName} was updated.`);
            close();
          }}
        />
      ) : null}

      {dialog?.kind === 'confirm' ? (
        <ConfirmDialog
          action={dialog.action}
          member={dialog.member}
          onClose={close}
          onDone={(member) => {
            setNotice(
              dialog.action === 'deactivate'
                ? `${member.fullName} was deactivated and signed out.`
                : `${member.fullName} can sign in again.`,
            );
            close();
          }}
        />
      ) : null}

      <SetupLinkDialog state={dialog?.kind === 'link' ? dialog : null} onClose={close} />
    </div>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StaffFormDialog({
  member,
  onClose,
  onCreated,
  onSaved,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onCreated: (member: StaffMember, link: SetupLink) => void;
  onSaved: (member: StaffMember) => void;
}) {
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const [fullName, setFullName] = useState(member?.fullName ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState<ManagedRole>(member?.role ?? 'WAITER');
  const [errors, setErrors] = useState<{ fullName?: string; email?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const emailLocked = member !== null && member.status !== 'PENDING';
  const busy = create.isPending || update.isPending;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fullName.trim().replace(/\s+/g, ' ');
    const mail = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (!name) next.fullName = 'Enter the full name.';
    else if (name.length > 120) next.fullName = 'Use at most 120 characters.';
    if (!EMAIL_PATTERN.test(mail) || mail.length > 254) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (next.fullName || next.email) return;
    setFormError(null);

    if (member === null) {
      create.mutate(
        { fullName: name, email: mail, role },
        {
          onSuccess: ({ staff, setup }) => {
            onCreated(staff, setup);
          },
          onError: (error) => {
            setFormError(errorMessage(error));
          },
        },
      );
      return;
    }

    const changes: Partial<StaffInput> = {};
    if (name !== member.fullName) changes.fullName = name;
    if (!emailLocked && mail !== member.email) changes.email = mail;
    if (role !== member.role) changes.role = role;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: member.id, changes },
      {
        onSuccess: onSaved,
        onError: (error) => {
          setFormError(errorMessage(error));
        },
      },
    );
  }

  const roleChanged = member !== null && role !== member.role;

  return (
    <Dialog
      open
      onClose={onClose}
      title={member ? `Edit ${member.fullName}` : 'Add staff member'}
      description={
        member
          ? 'Changes apply immediately.'
          : 'The account stays pending until they set their own password with the one-time link.'
      }
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {formError ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <FormField label="Full name" error={errors.fullName} required>
          <TextInput
            autoComplete="off"
            maxLength={120}
            value={fullName}
            disabled={busy}
            onChange={(e) => {
              setFullName(e.target.value);
            }}
          />
        </FormField>
        <FormField
          label="Email"
          error={errors.email}
          required
          hint={emailLocked ? 'Email can only be changed before account setup is completed.' : 'Used to sign in.'}
        >
          <TextInput
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            disabled={busy || emailLocked}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </FormField>
        <FormField
          label="Role"
          {...(roleChanged && {
            hint: 'Changing the role signs this person out of every device.',
          })}
        >
          <Select
            value={role}
            disabled={busy}
            onChange={(e) => {
              setRole(e.target.value as ManagedRole);
            }}
          >
            {MANAGED_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : null}
            {member ? 'Save changes' : 'Create and get link'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog({
  action,
  member,
  onClose,
  onDone,
}: {
  action: 'deactivate' | 'activate';
  member: StaffMember;
  onClose: () => void;
  onDone: (member: StaffMember) => void;
}) {
  const deactivate = useDeactivateStaff();
  const activate = useActivateStaff();
  const mutation = action === 'deactivate' ? deactivate : activate;
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open
      onClose={onClose}
      title={action === 'deactivate' ? `Deactivate ${member.fullName}?` : `Reactivate ${member.fullName}?`}
      description={
        action === 'deactivate'
          ? 'They are signed out of every device on their next request, cannot sign in, and any unused setup link stops working.'
          : 'They can sign in again with their existing password.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            className={
              action === 'deactivate'
                ? 'bg-danger text-white hover:bg-danger/90 active:bg-danger dark:text-surface'
                : undefined
            }
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate(member.id, {
                onSuccess: onDone,
                onError: (e) => {
                  setError(errorMessage(e));
                },
              });
            }}
          >
            {mutation.isPending ? <Spinner label="Saving" /> : null}
            {action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** Shows the one-time setup link. It lives only in component state and is gone when the dialog closes. */
function SetupLinkDialog({
  state,
  onClose,
}: {
  state: { name: string; link: SetupLink; isNew: boolean } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.link.url);
      setCopied('yes');
    } catch {
      inputRef.current?.select();
      setCopied('manual');
    }
  }

  return (
    <Dialog
      open={state !== null}
      onClose={() => {
        setCopied(null);
        onClose();
      }}
      title={state?.isNew ? `${state.name} was added` : 'New setup link'}
      description="Copy this link now and share it privately. It is shown only once, works one time and expires after 24 hours."
      footer={
        <Button
          onClick={() => {
            setCopied(null);
            onClose();
          }}
        >
          Done
        </Button>
      }
    >
      {state ? (
        <div className="space-y-3">
          <FormField label={`Setup link for ${state.name}`}>
            <input
              readOnly
              value={state.link.url}
              ref={inputRef}
              onFocus={(e) => {
                e.target.select();
              }}
              className="block h-11 w-full rounded-xl border border-line bg-surface-sunken px-3.5 font-mono text-xs text-ink"
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                void copy();
              }}
            >
              <Icon name={copied === 'yes' ? 'check' : 'copy'} className="size-4" />
              {copied === 'yes' ? 'Copied' : 'Copy link'}
            </Button>
            <p role="status" aria-live="polite" className="text-sm text-ink-muted">
              {copied === 'yes'
                ? 'Link copied to the clipboard.'
                : copied === 'manual'
                  ? 'Press Ctrl+C to copy the selected link.'
                  : `Expires ${dateTimeFormat.format(new Date(state.link.expiresAt))}.`}
            </p>
          </div>
          <p className="flex gap-2 rounded-xl bg-warning/12 px-4 py-3 text-sm text-warning">
            <Icon name="alert" className="mt-0.5 size-4" />
            Anyone with this link can set the password for this account. Do not post it in shared groups.
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}
