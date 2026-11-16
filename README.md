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
└── docs/       Local-only planning docs (Git-ignored)
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
| `npm run db:migrate:dev`      | Isolation preflight, then `prisma migrate dev` | **Yes — only with explicit approval (from F02)** |
| `npm run db:migrate:deploy`   | Isolation preflight, then `prisma migrate deploy` | **Yes — only with explicit approval** |

### Shadow-database safety (defense-in-depth, not an absolute guarantee)

Prisma **wipes the shadow database**. Two layers guard against pointing it at real data:

1. **Static guard (always active)** — `prisma.config.ts` runs on every Prisma CLI command, including direct `npx prisma ...`. It parses both URLs, normalises loopback hosts (`localhost`, `127.x`, `::1`), default ports, `?host=`/`?port=` overrides and percent-encoding, and refuses if they resolve to the same host/port/database, or if a URL cannot be parsed.
   *Limitation:* text-only; cannot detect different host names that resolve to the same server (machine hostname, LAN IP, hosts-file aliases, port forwarding, proxies).
2. **Live identity preflight** — `npm run db:assert-isolation` (run automatically by `db:migrate:*`) connects read-only and compares the server's own identity: `pg_postmaster_start_time()` + `inet_server_port()` (cluster) and the database OID.
   *Limitations:* only runs through npm scripts — **direct `npx prisma migrate ...` bypasses it** (the static guard still applies); reflects the moment it runs; theoretical collision if two clusters started in the same microsecond on the same port.

Always run migrations through the npm scripts, never accept a Prisma "reset" of `restaurant_dev` without explicit approval, and never point `SHADOW_DATABASE_URL` at `restaurant_dev`.

## 6. API

All endpoints are served under `/api/v1`. The contract register lives in `docs/api-endpoints.txt` (local only).

- `GET /api/v1/health` — public, minimal: `{ "status": "ok"|"error", "database": "up"|"down", "timestamp" }`, `200` or `503`, `Cache-Control: no-store`. It intentionally exposes no versions, hosts or error details. Production readiness/diagnostic checks may require separate access controls.

Security baseline: Helmet headers, explicit CORS allowlist (no `*`), global ValidationPipe (`whitelist`, `forbidNonWhitelisted`), global rate limiting, centralised safe error responses with request IDs, `x-powered-by` disabled, API bound to `127.0.0.1` by default.

## 7. Git hygiene

Git operations are performed by the developer. `.gitignore` excludes `/docs/`, all `.env*` files except `*.example`, build output and the generated Prisma client. Verify locally with:

```powershell
git check-ignore -v backend/.env backend/.env.migrate frontend/.env docs/implementation-plan.txt
git status
```
