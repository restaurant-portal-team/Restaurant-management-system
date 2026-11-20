-- =============================================================================
-- F03 staff sessions (human-approved 2026-11-20, decision D1). PostgreSQL 17.
--
-- Adds ONE table for server-side staff login sessions. The browser holds an opaque random token in an
-- HttpOnly cookie; only its lowercase hex SHA-256 hash is stored here. Sessions are revoked by setting
-- revoked_at; the runtime role must not DELETE them (decision D5, applied by a human after deploy:
-- REVOKE DELETE ON TABLE public.staff_sessions FROM restaurant_app;).
--
-- Safety:
--   * Additive only: no existing object is altered or dropped; no data changes; no GRANT/REVOKE.
--   * One explicit transaction with local lock and statement timeouts.
--   * Apply ONLY via `npm run db:migrate:deploy` after the shadow dry run.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ===== BEGIN PRISMA-GENERATED (prisma migrate diff, schema before F03 -> schema with StaffSession) =====
-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_user_id_revoked_at_idx" ON "staff_sessions"("user_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- ===== END PRISMA-GENERATED =====

-- ===== BEGIN HAND-WRITTEN CHECK CONSTRAINTS (not tracked by Prisma) =====

ALTER TABLE "staff_sessions"
  ADD CONSTRAINT "staff_sessions_token_hash_format_chk"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "staff_sessions_expiry_after_creation_chk"
    CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "staff_sessions_last_seen_after_creation_chk"
    CHECK ("last_seen_at" >= "created_at"),
  ADD CONSTRAINT "staff_sessions_revoked_after_creation_chk"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

-- ===== END HAND-WRITTEN CHECK CONSTRAINTS =====

COMMIT;
