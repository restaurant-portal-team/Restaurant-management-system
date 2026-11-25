/**
 * In-memory stand-in for the Prisma calls used by AuthService, SessionService and StaffService.
 * Supports exactly the query shapes those services use (equality, null, in, not, gt) and emulates
 * transaction rollback by restoring a snapshot when the callback throws. No database is touched.
 *
 * Concurrency and real constraint behaviour are verified separately against PostgreSQL
 * (test/db-isolated/f05-staff-concurrency.db-spec.ts).
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;

export interface FakeUser extends Row {
  id: string;
  fullName: string;
  email: string;
  role: 'OWNER' | 'KITCHEN_STAFF' | 'WAITER';
  passwordHash: string | null;
  isActive: boolean;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function matchCondition(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition === 'object') {
    const c = condition as Record<string, unknown>;
    if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
    if ('not' in c) {
      if (c.not === null ? value === null || value === undefined : matchCondition(value, c.not)) return false;
    }
    if ('gt' in c && !(value instanceof Date && value.getTime() > (c.gt as Date).getTime())) return false;
    return true;
  }
  return value === condition;
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => matchCondition(row[key], condition));
}

class UniqueViolation extends Error {
  code = 'P2002';
}

function table(rows: Row[], unique: string[], defaults: () => Row, relations: Record<string, () => Row[]> = {}) {
  const withRelations = (row: Row, select?: Record<string, unknown>): Row => {
    const copy: Row = { ...row };
    for (const [name, source] of Object.entries(relations)) {
      if (select?.[name]) copy[name] = { ...source().find((r) => r.id === row.userId) };
    }
    return copy;
  };
  return {
    rows,
    findUnique: ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
      const row = rows.find((r) => matches(r, where));
      return Promise.resolve(row ? withRelations(row, select) : null);
    },
    findFirst: ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
      const row = rows.find((r) => matches(r, where));
      return Promise.resolve(row ? withRelations(row, select) : null);
    },
    findMany: ({ where, take }: { where?: Row; take?: number }) =>
      Promise.resolve(
        rows
          .filter((r) => matches(r, where))
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .slice(0, take ?? rows.length)
          .map((r) => ({ ...r })),
      ),
    create: ({ data }: { data: Row }) => {
      const row: Row = { ...defaults(), id: randomUUID(), ...data };
      for (const key of unique) {
        if (rows.some((r) => r[key] === row[key])) return Promise.reject(new UniqueViolation(key));
      }
      rows.push(row);
      return Promise.resolve({ ...row });
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows.filter((r) => matches(r, where));
      for (const key of unique) {
        if (key in data && hits.length > 0 && rows.some((r) => !hits.includes(r) && r[key] === data[key])) {
          return Promise.reject(new UniqueViolation(key));
        }
      }
      for (const row of hits) Object.assign(row, data, { updatedAt: new Date() });
      return Promise.resolve({ count: hits.length });
    },
  };
}

export function createFakeStaffDb(initialUsers: FakeUser[]) {
  const users: Row[] = initialUsers.map((u) => ({ ...u }));
  const tokens: Row[] = [];
  const sessions: Row[] = [];
  const now = () => new Date();

  const base = {
    users: users as FakeUser[],
    tokens,
    sessions,
    $queryRaw: () => Promise.resolve([]),
    $disconnect: () => Promise.resolve(),
    user: table(users, ['email'], () => ({
      passwordHash: null,
      isActive: false,
      activatedAt: null,
      deactivatedAt: null,
      createdById: null,
      createdAt: now(),
      updatedAt: now(),
    })),
    staffSetupToken: table(tokens, ['tokenHash'], () => ({ usedAt: null, createdAt: now() }), { user: () => users }),
    staffSession: table(sessions, ['tokenHash'], () => ({ createdAt: now(), lastSeenAt: now(), revokedAt: null }), {
      user: () => users,
    }),
  };
  return Object.assign(base, {
    async $transaction<T>(fn: (tx: typeof base) => Promise<T>): Promise<T> {
      const snapshot = [users, tokens, sessions].map((list) => list.map((r) => ({ ...r })));
      try {
        return await fn(base);
      } catch (error) {
        [users, tokens, sessions].forEach((list, i) => list.splice(0, list.length, ...(snapshot[i] ?? [])));
        throw error;
      }
    },
  });
}

export type FakeStaffDb = ReturnType<typeof createFakeStaffDb>;

export function fakeUser(overrides: Partial<FakeUser> & Pick<FakeUser, 'id' | 'role'>): FakeUser {
  const created = new Date('2026-11-01T09:00:00Z');
  return {
    fullName: `User ${overrides.id}`,
    email: `${overrides.id}@example.com`,
    passwordHash: null,
    isActive: false,
    activatedAt: null,
    deactivatedAt: null,
    createdById: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}
