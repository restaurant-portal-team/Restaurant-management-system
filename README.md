# Restaurant Management Portal

Single-restaurant management web app with role-specific workspaces (Owner, Kitchen Staff, Waiter, Customer).

| Layer    | Stack                                                                 |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19 + Vite 8 + TypeScript 6 + Tailwind CSS 4, React Router 8, TanStack Query 5 |
| Backend  | NestJS 12 (ESM) + TypeScript 6, Prisma 7.10.1 (`@prisma/adapter-pg`)   |
| Database | PostgreSQL 17 (local Windows service, administered by the developer)  |
| Testing  | Vitest 5 (+ React Testing Library on the frontend, Supertest on the backend) |
| Linting  | ESLint 10 + typescript-eslint (strict, type-aware) in both apps       |

```text
.
├── frontend/   React app (port 5173)
├── backend/    NestJS API (port 3000, prefix /api/v1) + Prisma
└── docs/       Planning docs, progress tracker and endpoint list (Git-tracked)
```

> Scope note: this repository covers application development and local testing only.
> Containerisation, infrastructure, CI/CD and deployment are owned by the human developer.

## Prerequisites

- Node.js **>= 22.22** (developed on 24.x) and npm 11
- PostgreSQL 17 running locally on `127.0.0.1:5432`

## 1. Database setup (done by the developer, not by tooling)

Two roles and two databases are created manually (pgAdmin 4 or SQL Shell):

| Object                  | Purpose                                              | Owner                 |
| ----------------------- | ---------------------------------------------------- | --------------------- |
| `restaurant_dev`        | Development database                                 | `restaurant_migrator` |
| `restaurant-dev-shadow` | Prisma shadow database (wiped by Prisma, never real data) | `restaurant_migrator` |

| Role                  | Used by                         | Privileges |
| --------------------- | ------------------------------- | ---------- |
| `restaurant_app`      | NestJS runtime only             | LOGIN; no SUPERUSER/CREATEDB/CREATEROLE; CONNECT on `restaurant_dev`; USAGE on `public`; DML on future tables + USAGE/SELECT on future sequences via default privileges; no CREATE; cannot connect to the shadow DB |
| `restaurant_migrator` | Prisma CLI migrations only      | LOGIN; no SUPERUSER/CREATEDB/CREATEROLE; owns both databases; CREATE in `public` |

Default privileges (so future migrator-created objects are usable by the runtime role):

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE restaurant_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO restaurant_app;
ALTER DEFAULT PRIVILEGES FOR ROLE restaurant_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO restaurant_app;
```

Set passwords with SQL Shell's `\password <role>` so they never appear in query history.

## 2. Environment files (created by hand, Git-ignored)

| File                   | Variables                                       | Read by |
| ---------------------- | ----------------------------------------------- | ------- |
| `backend/.env`         | `DATABASE_URL` (restaurant_app), `PORT`, `HOST`, `CORS_ORIGIN`, `NODE_ENV`, throttling | NestJS runtime only |
| `backend/.env.migrate` | `MIGRATION_DATABASE_URL`, `SHADOW_DATABASE_URL` (restaurant_migrator) | `prisma.config.ts` and `scripts/db/*` only |
| `frontend/.env` (optional) | `VITE_API_BASE_URL` (public, never secrets) | Vite |

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item backend\.env.migrate.example backend\.env.migrate
```

Then open each file in your editor and replace `<RUNTIME_PASSWORD>` / `<MIGRATOR_PASSWORD>`.

**URL-encoding:** characters other than `A–Z a–z 0–9 - _ . ~` in a password must be percent-encoded inside the URL:

| Character | `@`   | `:`   | `/`   | `#`   | `?`   | `&`   | `%`   | `+`   | space |
| --------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Encoded   | `%40` | `%3A` | `%2F` | `%23` | `%3F` | `%26` | `%25` | `%2B` | `%20` |

Example: `Ab@1#x` becomes `Ab%401%23x`. The hyphenated database name `restaurant-dev-shadow` needs no encoding.

Credential separation guarantees:

- The API refuses to start if `MIGRATION_DATABASE_URL` or `SHADOW_DATABASE_URL` is present in its environment.
- `prisma.config.ts` reads only `backend/.env.migrate` (via `node:util.parseEnv`, not copied into `process.env`) and never reads `DATABASE_URL`. Prisma 7 does not auto-load `.env` files.
- Env validation and DB scripts never print URLs or passwords (only variable names, role names, booleans and SQLSTATE codes).

## 3. Install and run

```powershell
# Backend
cd backend
npm install            # also runs `prisma generate`
npm run start:dev      # http://127.0.0.1:3000/api/v1/health

# Frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

## 4. Quality checks

| Command (in `frontend/` or `backend/`) | Purpose |
| -------------------------------------- | ------- |
| `npm run lint`                         | ESLint (strict, type-aware), zero warnings allowed |
| `npm run typecheck`                    | TypeScript strict type check |
| `npm test`                             | Unit tests (Vitest) |
| `npm run test:e2e` (backend)           | HTTP e2e tests (Supertest, mocked DB) |
| `npm run build`                        | Production build |

## 5. Database scripts (backend)

| Script                        | What it does | Mutates DB? |
| ----------------------------- | ------------ | ----------- |
| `npm run prisma:validate`     | Validate Prisma schema/config | No |
| `npm run prisma:generate`     | Generate Prisma client into `src/generated/` | No |
| `npm run db:verify-roles`     | Read-only catalog checks of both roles, ownership, privileges and default privileges | No |
| `npm run db:assert-isolation` | Live check that the shadow DB is a different database (`-- --self-test` checks the guard refuses identical targets) | No |
| `npm run db:migrate:status`   | `prisma migrate status` | No |
| `npm run db:migrate:check-shadow` | Isolation preflight, then `prisma migrate diff --from-migrations --to-schema --exit-code` with the **shadow-only** config `prisma.shadow-check.config.ts` (no main-database URL is given to Prisma) | Shadow DB only (Prisma wipes/rebuilds it) |
| `npm run db:migrate:deploy`   | Isolation preflight, then `prisma migrate deploy` | **Yes — only with explicit approval** |
| `npm run test:db`             | Real-database suites: rollback-only runtime tests + read-only migrator checks (section 6.5) | No persistent data (sequence values advance) |
| `npm run unicode:generate`    | Regenerates the PostgreSQL 17 case table used for name keys (section 6.6); offline | No |

### Shadow-database safety (defense-in-depth, not an absolute guarantee)

Prisma **wipes the shadow database**. Two layers guard against pointing it at real data:

1. **Static guard (always active)** — `prisma.config.ts` runs on every Prisma CLI command, including direct `npx prisma ...`. It parses both URLs, normalises loopback hosts (`localhost`, `127.x`, `::1`), default ports, `?host=`/`?port=` overrides and percent-encoding, and refuses if they resolve to the same host/port/database, or if a URL cannot be parsed.
   *Limitation:* text-only; cannot detect different host names that resolve to the same server (machine hostname, LAN IP, hosts-file aliases, port forwarding, proxies).
2. **Live identity preflight** — `npm run db:assert-isolation` (run automatically by `db:migrate:*`) connects read-only and compares the server's own identity: `pg_postmaster_start_time()` + `inet_server_port()` (cluster) and the database OID.
   *Limitations:* only runs through npm scripts — **direct `npx prisma migrate ...` bypasses it** (the static guard still applies); reflects the moment it runs; theoretical collision if two clusters started in the same microsecond on the same port.

Always run migrations through the npm scripts, never accept a Prisma "reset" of `restaurant_dev` without explicit approval, and never point `SHADOW_DATABASE_URL` at `restaurant_dev`.

## 6. Database operations (F02)

All commands below run in `backend/`. Every database-changing step requires explicit human approval.

### 6.1 Role separation

| Role | Used by | Owns | May do |
| ---- | ------- | ---- | ------ |
| `restaurant_migrator` | Prisma CLI only (`backend/.env.migrate`) | `restaurant_dev`, `restaurant-dev-shadow`, all tables, sequence, enums | DDL via approved migrations |
| `restaurant_app` | NestJS runtime only (`backend/.env`) | nothing | DML on application tables (with the audit restrictions in 6.7); no DDL, no `_prisma_migrations`, no TEMP, no access to the shadow DB |

The API refuses to start if migration credentials are present in its environment; `prisma.config.ts` never reads `DATABASE_URL`.

### 6.2 Migration authoring policy (enforced by `scripts/db/migration-sql.spec.ts`)

- Schema changes are **new, additive migrations**. Applied migrations are never edited (the initial migration's SHA-256 is pinned in the test).
- Each `migration.sql` contains exactly one explicit `BEGIN; … COMMIT;`, sets `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout`, and is ASCII-only with LF line endings.
- **Forbidden in every migration:** `DROP`, `TRUNCATE`, `DELETE FROM`, `UPDATE`, `INSERT INTO`, `CONCURRENTLY`, `ALTER TYPE`, `GRANT`, `REVOKE`, `CREATE/ALTER/DROP ROLE`, `CREATE EXTENSION`, `VACUUM`, `ROLLBACK`, `SAVEPOINT`.
- **Single, narrowly scoped exception (human-approved Q1b remediation):** only migration `20261116153418_name_key_builtin_lower` may `DROP CONSTRAINT`, and only for exactly `menu_categories_name_key_normalised_chk`, `menu_items_name_key_normalised_chk` and `ingredients_name_key_normalised_chk`, each re-added with the same name in the same `ALTER TABLE` using `COLLATE "pg_c_utf8"`. This is **not** a general permission: no `IF EXISTS`, no other `DROP`, and no other migration may contain `DROP CONSTRAINT`. Any future destructive operation needs a new explicit approval and test change.
- CHECK constraints are hand-written in the migration SQL (Prisma does not track them). In the initial migration the Prisma-generated block must equal an offline `prisma migrate diff --from-empty --to-schema` (drift test).
- Migrations never contain role names or privilege statements; privileges are applied by a human (6.7).

### 6.3 Prohibited commands against `restaurant_dev`

- `prisma migrate reset`, `prisma db push`, and `prisma migrate dev`. There is intentionally **no** npm script for `prisma migrate dev` (the former `db:migrate:dev` script was removed after F02 because it targeted `restaurant_dev` through `MIGRATION_DATABASE_URL`). Running `npx prisma migrate dev` directly is still technically possible and remains prohibited by policy.
- `prisma migrate resolve` without explicit approval.
- Accepting any Prisma prompt to reset or drop data.

### 6.4 Normal migration deployment (approved gate sequence)

1. Offline: `npm run lint`, `npm run typecheck`, `npm test` (includes the migration policy tests), `npm run prisma:validate`.
2. Preflight (read-only): `npm run db:assert-isolation` and `npm run db:verify-roles`.
3. Shadow dry run: `npm run db:migrate:check-shadow` — expect exit 0 and "No difference detected".
4. `npm run db:migrate:status` — confirm exactly the expected pending migration(s).
5. Deploy (after approval): `npm run db:migrate:deploy`.
6. Verify: `npm run db:migrate:status` ("Database schema is up to date!"), `npm run test:db`, `npm run db:verify-roles`.

**Approved deviation (F02):** the shadow workflow uses `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` with the shadow-only config `prisma.shadow-check.config.ts` **instead of** `prisma migrate dev`. These commands are **not equivalent**: the dry run proves the migrations apply cleanly from scratch on `restaurant-dev-shadow` and match `schema.prisma`; it does not create migration files, does not inspect or modify `restaurant_dev`, and does not record history. New migration SQL is produced offline (`prisma migrate diff --from-empty`/review) and reviewed by a human.

### 6.5 Database verification tests

`npm run test:db` (requires `backend/.env` and `backend/.env.migrate`):

- `test/db/gate-c.db-spec.ts` — runs only as `restaurant_app` on `restaurant_dev` (refuses otherwise); every write inside `BEGIN … ROLLBACK`, expected failures inside `SAVEPOINT`s, no `COMMIT`. Covers the privilege matrix, DDL rejection (42501), all CHECK/UNIQUE/FK/NOT NULL constraints, UUID v7 via Prisma, the order lifecycle, audit-table restrictions and full-range Unicode compatibility.
- `test/db/migration-history.db-spec.ts` — forced read-only `restaurant_migrator` session: migration history and checksums, exact hardened ACLs.
- Sequence values (e.g. `orders_order_number_seq`) advance during tests; this is expected because sequences are non-transactional. No rows persist.

### 6.6 Unicode name keys

- Names are normalised with `normalizeName()` (`src/common/name-normalization.ts`); the key is `pgSimpleLower(name)`, never `String.prototype.toLowerCase()`.
- The database enforces `name_key = lower(btrim(name) COLLATE "pg_c_utf8")` (PostgreSQL 17 builtin provider, platform-independent).
- `npm run unicode:generate` regenerates `src/common/unicode/pg-simple-lower.generated.ts` from the installed PostgreSQL 17 headers (default `C:/Program Files/PostgreSQL/17/include/server/common`, override with `PG_COMMON_INCLUDE_DIR`). `scripts/unicode/pg-simple-lower.spec.ts` compares every code point when the headers are present.
- On any PostgreSQL major-version change: regenerate, run `npm test` and `npm run test:db` (full-range database comparison) before upgrading, and re-check existing `name_key` values.

### 6.7 Privilege-hardening runbook (human-executed in pgAdmin)

Execute as **`postgres`** (superuser; acts as the object owner) or as the owner **`restaurant_migrator`**, in a Query Tool connected to the **target database** (`restaurant_dev` here). Run one statement at a time and verify after each.

| Step | SQL | Expected effect |
| ---- | --- | --------------- |
| D1 | `REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations FROM restaurant_app;` | runtime cannot read/modify migration history (42501) |
| D2 | `REVOKE TEMPORARY ON DATABASE restaurant_dev FROM PUBLIC;` | runtime cannot create temp tables (42501); migrator keeps its own TEMP |
| E1 | `REVOKE UPDATE, DELETE ON TABLE public.inventory_movements FROM restaurant_app;` | stock ledger is append-only for the runtime (INSERT/SELECT kept) |
| E2 | `REVOKE DELETE ON TABLE public.payments FROM restaurant_app;` | payments cannot be deleted by the runtime (INSERT/SELECT/UPDATE kept) |

Verification (effective privileges, read-only):

```sql
SELECT has_table_privilege('restaurant_app','public._prisma_migrations','SELECT')    AS d1_sel,  -- false
       has_database_privilege('restaurant_app', current_database(), 'TEMPORARY')     AS d2_temp, -- false
       has_table_privilege('restaurant_app','public.inventory_movements','UPDATE')   AS e1_upd,  -- false
       has_table_privilege('restaurant_app','public.inventory_movements','DELETE')   AS e1_del,  -- false
       has_table_privilege('restaurant_app','public.payments','DELETE')              AS e2_del,  -- false
       has_table_privilege('restaurant_app','public.payments','UPDATE')              AS e2_upd,  -- true
       has_table_privilege('restaurant_migrator','public._prisma_migrations','INSERT') AS mig_ok; -- true
```

Then run `npm run test:db` (asserts the exact ACLs) and `npm run db:verify-roles`.

Rollback (restores the original ACLs exactly):

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations TO restaurant_app;
GRANT TEMPORARY ON DATABASE restaurant_dev TO PUBLIC;
GRANT UPDATE, DELETE ON TABLE public.inventory_movements TO restaurant_app;
GRANT DELETE ON TABLE public.payments TO restaurant_app;
```

**When to run it**

- **First-time setup of a fresh database:** after the human creates roles/databases and default privileges (section 1) and the **first** `npm run db:migrate:deploy` creates the tables and `_prisma_migrations`, run D1, D2, E1 and E2 immediately, then verify. Until then the runtime role holds DML on `_prisma_migrations` and the audit tables.
- **Normal deployments to an already-hardened database:** ACLs persist, so D1–E2 are not re-run; always verify afterwards (6.4 step 6). If a migration adds a **new table**, it automatically receives runtime DML (see 6.8) — review whether it needs restrictions (separate approval).

### 6.8 Default privileges risk and pending guard

`ALTER DEFAULT PRIVILEGES FOR ROLE restaurant_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO restaurant_app` grants runtime DML on **every future table** the migrator creates — including `_prisma_migrations` whenever Prisma creates it on an empty database, and any future audit table. A **post-migration privilege guard** (a read-only check that fails if the runtime role holds any privilege on `_prisma_migrations` or TEMP on the database) is **pending and not implemented**. Until it exists, the verification in 6.7 is **mandatory** after creating a fresh database and after every migration deployment.

## 7. API

All endpoints are served under `/api/v1`. The contract register lives in `docs/api-endpoints.txt`; the one-line-per-route list lives in `docs/endpoints.txt`. Both are Git-tracked.

- `GET /api/v1/health` — public, minimal: `{ "status": "ok"|"error", "database": "up"|"down", "timestamp" }`, `200` or `503`, `Cache-Control: no-store`. It intentionally exposes no versions, hosts or error details. Production readiness/diagnostic checks may require separate access controls.

Security baseline: Helmet headers, explicit CORS allowlist (no `*`), global ValidationPipe (`whitelist`, `forbidNonWhitelisted`), global rate limiting, centralised safe error responses with request IDs, `x-powered-by` disabled, API bound to `127.0.0.1` by default.

## 8. Git hygiene

Git operations are performed by the developer. `.gitignore` excludes all `.env*` files except `*.example`, build output and the generated Prisma client. `docs/` (including `implementation-plan.txt`, `progress-tracker.txt` and `endpoints.txt`) and `CLAUDE.md` are Git-tracked. Verify locally with:

```powershell
git check-ignore -v backend/.env backend/.env.migrate frontend/.env
git ls-files docs CLAUDE.md
git status
```
