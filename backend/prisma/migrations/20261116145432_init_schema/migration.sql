-- =============================================================================
-- F02 initial schema - Restaurant Management Portal
-- Human-approved design (S1/S2, 2026-11-16). PostgreSQL 17.
--
-- Safety:
--   * Explicit transaction: every statement below is transactional DDL (CREATE TYPE / TABLE /
--     INDEX without CONCURRENTLY / ADD CONSTRAINT). If any statement fails, nothing is kept.
--   * No DROP, no data changes, no GRANT/REVOKE, no ALTER TYPE ... ADD VALUE, no extensions.
--   * SET LOCAL timeouts prevent the migration from hanging on locks.
--   * Apply ONLY via `npm run db:migrate:deploy` (isolation preflight + prisma migrate deploy)
--     as restaurant_migrator, after a successful shadow dry run (Gate A) and explicit approval (Gate B).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ===== BEGIN PRISMA-GENERATED (prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script) =====
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('OWNER', 'KITCHEN_STAFF', 'WAITER');

-- CreateEnum
CREATE TYPE "ingredient_unit" AS ENUM ('G', 'ML', 'PCS');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH');

-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('INITIAL_STOCK', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'WASTE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" "staff_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMPTZ(6),
    "deactivated_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_setup_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tables" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "label" VARCHAR(60),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ordering_token_hash" VARCHAR(128),
    "ordering_token_rotated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "name_key" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_key" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "price" DECIMAL(10,2) NOT NULL,
    "image_url" VARCHAR(500),
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "stock_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimum_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "menu_item_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity_per_dish" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("menu_item_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" SERIAL NOT NULL,
    "table_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "tracking_token_hash" VARCHAR(128) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "accepted_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "ready_by_id" UUID,
    "ready_at" TIMESTAMPTZ(6),
    "served_by_id" UUID,
    "served_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(300),
    "inventory_deducted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name_snapshot" VARCHAR(120) NOT NULL,
    "unit_price_snapshot" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instructions" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ingredient_requirements" (
    "order_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "required_quantity" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_ingredient_requirements_pkey" PRIMARY KEY ("order_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "order_id" UUID,
    "type" "inventory_movement_type" NOT NULL,
    "quantity_delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "reason" VARCHAR(300),
    "unit_cost" DECIMAL(10,2),
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL DEFAULT 'CASH',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "users_created_by_id_idx" ON "users"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_setup_tokens_token_hash_key" ON "staff_setup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_setup_tokens_user_id_idx" ON "staff_setup_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tables_number_key" ON "restaurant_tables"("number");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tables_ordering_token_hash_key" ON "restaurant_tables"("ordering_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_name_key_key" ON "menu_categories"("name_key");

-- CreateIndex
CREATE INDEX "menu_items_category_id_is_archived_is_available_idx" ON "menu_items"("category_id", "is_archived", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_category_id_name_key_key" ON "menu_items"("category_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key_key" ON "ingredients"("name_key");

-- CreateIndex
CREATE INDEX "recipe_ingredients_ingredient_id_idx" ON "recipe_ingredients"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_token_hash_key" ON "orders"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_table_id_status_idx" ON "orders"("table_id", "status");

-- CreateIndex
CREATE INDEX "orders_payment_status_status_idx" ON "orders"("payment_status", "status");

-- CreateIndex
CREATE INDEX "orders_accepted_by_id_idx" ON "orders"("accepted_by_id");

-- CreateIndex
CREATE INDEX "orders_ready_by_id_ready_at_idx" ON "orders"("ready_by_id", "ready_at");

-- CreateIndex
CREATE INDEX "orders_served_by_id_served_at_idx" ON "orders"("served_by_id", "served_at");

-- CreateIndex
CREATE INDEX "orders_cancelled_by_id_idx" ON "orders"("cancelled_by_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_menu_item_id_idx" ON "order_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "order_ingredient_requirements_ingredient_id_idx" ON "order_ingredient_requirements"("ingredient_id");

-- CreateIndex
CREATE INDEX "inventory_movements_ingredient_id_created_at_idx" ON "inventory_movements"("ingredient_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_actor_id_idx" ON "inventory_movements"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_order_id_ingredient_id_type_key" ON "inventory_movements"("order_id", "ingredient_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_recorded_by_id_idx" ON "payments"("recorded_by_id");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "staff_setup_tokens" ADD CONSTRAINT "staff_setup_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_ready_by_id_fkey" FOREIGN KEY ("ready_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_served_by_id_fkey" FOREIGN KEY ("served_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_ingredient_requirements" ADD CONSTRAINT "order_ingredient_requirements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_ingredient_requirements" ADD CONSTRAINT "order_ingredient_requirements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ===== END PRISMA-GENERATED =====

-- ===== BEGIN HAND-WRITTEN CHECK CONSTRAINTS =====
-- Not expressible in Prisma schema; Prisma Migrate does not track or drop them.
-- Only invariants that must never break are enforced here. Changeable business policy
-- (pay only after SERVED, cancellation rules, max quantity per line, price > 0) lives in services/DTOs.

-- users
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalised_chk"
    CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1),
  ADD CONSTRAINT "users_full_name_not_blank_chk"
    CHECK (length(btrim("full_name")) > 0),
  ADD CONSTRAINT "users_active_requires_setup_chk"
    CHECK (NOT "is_active" OR ("password_hash" IS NOT NULL AND "activated_at" IS NOT NULL));

-- staff_setup_tokens
ALTER TABLE "staff_setup_tokens"
  ADD CONSTRAINT "staff_setup_tokens_expiry_chk"
    CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "staff_setup_tokens_used_after_created_chk"
    CHECK ("used_at" IS NULL OR "used_at" >= "created_at");

-- restaurant_tables
ALTER TABLE "restaurant_tables"
  ADD CONSTRAINT "restaurant_tables_number_positive_chk"
    CHECK ("number" > 0),
  ADD CONSTRAINT "restaurant_tables_label_not_blank_chk"
    CHECK ("label" IS NULL OR length(btrim("label")) > 0);

-- menu_categories (case-insensitive unique names via name_key)
ALTER TABLE "menu_categories"
  ADD CONSTRAINT "menu_categories_name_not_blank_chk"
    CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "menu_categories_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name")));

-- menu_items (case-insensitive unique names within a category via (category_id, name_key))
ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_name_not_blank_chk"
    CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "menu_items_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name"))),
  ADD CONSTRAINT "menu_items_price_non_negative_chk"
    CHECK ("price" >= 0);

-- ingredients (never negative inventory - requirements section 8)
ALTER TABLE "ingredients"
  ADD CONSTRAINT "ingredients_name_not_blank_chk"
    CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "ingredients_name_key_normalised_chk"
    CHECK ("name_key" = lower(btrim("name"))),
  ADD CONSTRAINT "ingredients_stock_non_negative_chk"
    CHECK ("stock_quantity" >= 0),
  ADD CONSTRAINT "ingredients_minimum_non_negative_chk"
    CHECK ("minimum_stock" >= 0);

-- recipe_ingredients
ALTER TABLE "recipe_ingredients"
  ADD CONSTRAINT "recipe_ingredients_quantity_positive_chk"
    CHECK ("quantity_per_dish" > 0);

-- orders: audit-trail consistency for each reached state (actor + timestamp recorded together)
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subtotal_non_negative_chk"
    CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "orders_version_non_negative_chk"
    CHECK ("version" >= 0),
  ADD CONSTRAINT "orders_accepted_pair_chk"
    CHECK (("accepted_at" IS NULL) = ("accepted_by_id" IS NULL)),
  ADD CONSTRAINT "orders_ready_pair_chk"
    CHECK (("ready_at" IS NULL) = ("ready_by_id" IS NULL)),
  ADD CONSTRAINT "orders_served_pair_chk"
    CHECK (("served_at" IS NULL) = ("served_by_id" IS NULL)),
  ADD CONSTRAINT "orders_pending_not_accepted_chk"
    CHECK ("status" <> 'PENDING' OR ("accepted_at" IS NULL AND "inventory_deducted_at" IS NULL)),
  ADD CONSTRAINT "orders_accepted_state_chk"
    CHECK ("status" NOT IN ('PREPARING', 'READY', 'SERVED')
           OR ("accepted_at" IS NOT NULL AND "inventory_deducted_at" IS NOT NULL)),
  ADD CONSTRAINT "orders_ready_state_chk"
    CHECK ("status" NOT IN ('READY', 'SERVED') OR "ready_at" IS NOT NULL),
  ADD CONSTRAINT "orders_served_state_chk"
    CHECK ("status" <> 'SERVED' OR "served_at" IS NOT NULL),
  ADD CONSTRAINT "orders_cancelled_state_chk"
    CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  ADD CONSTRAINT "orders_cancel_fields_chk"
    CHECK (("cancelled_by_id" IS NULL AND "cancel_reason" IS NULL) OR "cancelled_at" IS NOT NULL);

-- order_items
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive_chk"
    CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_unit_price_non_negative_chk"
    CHECK ("unit_price_snapshot" >= 0),
  ADD CONSTRAINT "order_items_name_snapshot_not_blank_chk"
    CHECK (length(btrim("name_snapshot")) > 0);

-- order_ingredient_requirements
ALTER TABLE "order_ingredient_requirements"
  ADD CONSTRAINT "order_ingredient_requirements_quantity_positive_chk"
    CHECK ("required_quantity" > 0);

-- inventory_movements (append-only ledger; corrections are new rows)
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_delta_non_zero_chk"
    CHECK ("quantity_delta" <> 0),
  ADD CONSTRAINT "inventory_movements_balance_non_negative_chk"
    CHECK ("balance_after" >= 0),
  ADD CONSTRAINT "inventory_movements_sign_by_type_chk"
    CHECK (("type" IN ('INITIAL_STOCK', 'STOCK_IN') AND "quantity_delta" > 0)
           OR ("type" IN ('STOCK_OUT', 'WASTE') AND "quantity_delta" < 0)
           OR "type" = 'ADJUSTMENT'),
  ADD CONSTRAINT "inventory_movements_stock_out_order_chk"
    CHECK (("type" = 'STOCK_OUT') = ("order_id" IS NOT NULL)),
  ADD CONSTRAINT "inventory_movements_reason_required_chk"
    CHECK ("type" NOT IN ('ADJUSTMENT', 'WASTE')
           OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
  ADD CONSTRAINT "inventory_movements_unit_cost_chk"
    CHECK ("unit_cost" IS NULL
           OR ("unit_cost" >= 0 AND "type" IN ('INITIAL_STOCK', 'STOCK_IN')));

-- payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_subtotal_non_negative_chk"
    CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "payments_discount_range_chk"
    CHECK ("discount_amount" >= 0 AND "discount_amount" <= "subtotal"),
  ADD CONSTRAINT "payments_total_consistent_chk"
    CHECK ("total_amount" = "subtotal" - "discount_amount");

-- ===== END HAND-WRITTEN CHECK CONSTRAINTS =====

COMMIT;
