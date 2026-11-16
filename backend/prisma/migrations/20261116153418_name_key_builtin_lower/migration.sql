-- =============================================================================
-- F02 Q1b remediation - deterministic Unicode name keys (human-approved 2026-11-16).
-- PostgreSQL 17.
--
-- Replaces EXACTLY three CHECK constraints so that name_key is validated with PostgreSQL 17's builtin
-- Unicode simple lowercase (collation "pg_c_utf8"), which is platform-independent, instead of the
-- database default libc locale (Windows "English_United States.1252"), which left U+0130 unchanged
-- and could differ from the application. The application computes name_key with the same
-- PostgreSQL case table (src/common/unicode/pg-simple-lower.generated.ts).
--
-- Safety:
--   * One explicit transaction; each table's DROP + ADD happens in a single ALTER TABLE statement,
--     so no table is ever left without its constraint, even inside the transaction.
--   * Same constraint names; no other objects touched. No DROP TABLE/COLUMN/INDEX, no data changes,
--     no GRANT/REVOKE. Tables are validated on ADD (they are empty at the time of approval).
--   * The already-applied migration 20261116145432_init_schema is NOT modified.
--   * Apply ONLY via `npm run db:migrate:deploy` after shadow verification and explicit approval.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ===== BEGIN HAND-WRITTEN CONSTRAINT REPLACEMENT (Q1b) =====

ALTER TABLE "menu_categories"
  DROP CONSTRAINT "menu_categories_name_key_normalised_chk",
  ADD CONSTRAINT "menu_categories_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name") COLLATE "pg_c_utf8"));

ALTER TABLE "menu_items"
  DROP CONSTRAINT "menu_items_name_key_normalised_chk",
  ADD CONSTRAINT "menu_items_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name") COLLATE "pg_c_utf8"));

ALTER TABLE "ingredients"
  DROP CONSTRAINT "ingredients_name_key_normalised_chk",
  ADD CONSTRAINT "ingredients_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name") COLLATE "pg_c_utf8"));

-- ===== END HAND-WRITTEN CONSTRAINT REPLACEMENT (Q1b) =====

COMMIT;
