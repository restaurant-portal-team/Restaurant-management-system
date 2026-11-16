import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { StatusBadge } from '../components/ui/status-badge';
import { useHealth } from '../features/system/use-health';

export function HomePage() {
  return (
    <div className="space-y-10">
      <section className="max-w-2xl animate-fade-up">
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">
          Single-restaurant operations
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Restaurant Management Portal
        </h1>
        <p className="mt-4 text-lg text-pretty text-ink-muted">
          Orders, kitchen, service, inventory and billing in one place. Role-based workspaces for
          owners, kitchen staff, waiters and customers are being built feature by feature.
        </p>
      </section>

      <SystemStatusCard />
    </div>
  );
}

function SystemStatusCard() {
  const health = useHealth();

  return (
    <Card
      aria-labelledby="system-status-heading"
      className="max-w-xl animate-fade-up [animation-delay:120ms]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="system-status-heading" className="font-display text-lg font-semibold">
            System status
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Connection to the backend API and database.</p>
        </div>
        <div aria-live="polite">
          {health.isPending ? (
            <StatusBadge tone="neutral">Checking</StatusBadge>
          ) : health.isError ? (
            <StatusBadge tone="danger">Unavailable</StatusBadge>
          ) : (
            <StatusBadge tone={health.data.database === 'up' ? 'success' : 'danger'}>
              {health.data.database === 'up' ? 'Operational' : 'Degraded'}
            </StatusBadge>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-surface-sunken p-4 text-sm">
        <div>
          <dt className="text-ink-muted">API</dt>
          <dd className="mt-1 font-medium">
            {health.isPending ? '—' : health.isError ? 'Unreachable' : 'Reachable'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Database</dt>
          <dd className="mt-1 font-medium">
            {health.isSuccess ? (health.data.database === 'up' ? 'Connected' : 'Not connected') : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-xs text-ink-muted">
          {health.dataUpdatedAt > 0
            ? `Last checked ${new Date(health.dataUpdatedAt).toLocaleTimeString()}`
            : health.isError
              ? 'Make sure the backend is running on port 3000.'
              : 'Checking connection…'}
        </p>
        <Button
          variant="secondary"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          {health.isFetching ? <Spinner label="Refreshing status" /> : null}
          Refresh
        </Button>
      </div>
    </Card>
  );
}
