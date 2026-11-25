import type { PlannedFeature } from '../app/navigation';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { EmptyState } from '../components/ui/states';
import { roleLabel, type StaffRole } from '../features/auth/auth-api';
import { useSession } from '../features/auth/use-auth';

/** Role landing page. Shows a welcome and an honest empty state until the role's dashboard feature exists. */
export function OverviewPage({ role, feature }: { role: StaffRole; feature: PlannedFeature }) {
  const session = useSession();
  const firstName = session.data?.fullName.split(' ')[0] ?? '';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${roleLabel(role)} workspace`}
        title={firstName ? `Welcome, ${firstName}` : 'Welcome'}
        description="Use the navigation to move between sections. Live figures appear here once the dashboard is built."
      />
      <EmptyState
        icon="dashboard"
        title={`Dashboard arrives in ${feature.id}`}
        description={`${feature.name}. No figures are shown until they come from real data.`}
      />
    </div>
  );
}

/** Placeholder for a section whose feature is not built yet (decision U2: no fake data). */
export function ComingSoonPage({ title, feature }: { title: string; feature: PlannedFeature }) {
  return (
    <div className="space-y-8">
      <PageHeader title={title} />
      <EmptyState
        title={`Coming in ${feature.id}`}
        description={`This section is delivered by ${feature.id} - ${feature.name}. There is no data to show yet.`}
      />
    </div>
  );
}

/** Real profile data from GET /auth/me (only rendered for signed-in staff). */
export function ProfilePage({ title }: { title: string }) {
  const session = useSession();
  const user = session.data;

  return (
    <div className="space-y-8">
      <PageHeader title={title} description="Your staff account. Contact the owner to change your role or email." />
      {user ? (
        <Card className="max-w-xl animate-fade-up">
          <dl className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <dt className="text-sm text-ink-muted">Full name</dt>
            <dd className="font-medium">{user.fullName}</dd>
            <dt className="text-sm text-ink-muted">Email</dt>
            <dd className="font-medium break-all">{user.email}</dd>
            <dt className="text-sm text-ink-muted">Role</dt>
            <dd className="font-medium">{roleLabel(user.role)}</dd>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
