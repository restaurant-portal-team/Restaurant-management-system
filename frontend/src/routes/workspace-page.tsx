import { Card } from '../components/ui/card';
import { roleLabel, type StaffRole } from '../features/auth/auth-api';
import { useSession } from '../features/auth/use-auth';

const DESCRIPTIONS: Record<StaffRole, string> = {
  OWNER: 'Menu, inventory, tables, staff, billing and the dashboard will live here.',
  KITCHEN_STAFF: 'Incoming, preparing and ready orders will live here.',
  WAITER: 'Ready-to-serve orders and active tables will live here.',
};

/**
 * F03 placeholder workspace per role (rendered only behind RequireAuth).
 * The full role shells with sidebars are delivered in F04.
 */
export function WorkspacePage({ role }: { role: StaffRole }) {
  const session = useSession();
  const firstName = session.data?.fullName.split(' ')[0] ?? '';

  return (
    <section className="max-w-2xl animate-fade-up">
      <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">{roleLabel(role)} workspace</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
        Welcome{firstName ? `, ${firstName}` : ''}
      </h1>
      <Card className="mt-8">
        <p className="text-ink-muted">{DESCRIPTIONS[role]}</p>
        <p className="mt-3 text-sm text-ink-muted">
          You are signed in securely. The full workspace arrives with the next features.
        </p>
      </Card>
    </section>
  );
}
