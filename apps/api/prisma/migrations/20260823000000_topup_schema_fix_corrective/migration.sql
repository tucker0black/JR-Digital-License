-- CORRECTIVE MIGRATION: Fix Top-Up schema after failed migrations
-- This migration safely creates missing tables/columns and fixes FK constraints
-- WITHOUT destroying any existing data.

-- ============================================================
-- 1. ENSURE TopUpProviderServiceStatus ENUM EXISTS (must be first)
-- ============================================================
DO $$ BEGIN
    CREATE TYPE "TopUpProviderServiceStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. ENSURE TopUpPackageNoteColor ENUM EXISTS
-- ============================================================
DO $$ BEGIN
    CREATE TYPE "TopUpPackageNoteColor" AS ENUM ('WARNING', 'INFO', 'SUCCESS', 'DANGER', 'PURPLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. CREATE TopUpProviderService TABLE (missing from failed migration)
-- ============================================================
CREATE TABLE IF NOT EXISTS "TopUpProviderService" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "providerId" UUID NOT NULL,
    "providerServiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TopUpProviderServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpProviderService_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one service ID per provider
-- NOTE: ADD CONSTRAINT ... UNIQUE creates an index, which raises 42P07 (duplicate_table)
-- rather than duplicate_object when it already exists. Check pg_constraint explicitly.
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'TopUpProviderService_providerId_providerServiceId_key' 
        AND conrelid = to_regclass('"TopUpProviderService"')
    )
    AND to_regclass('"TopUpProviderService_providerId_providerServiceId_key"') IS NULL THEN
        ALTER TABLE "TopUpProviderService" ADD CONSTRAINT "TopUpProviderService_providerId_providerServiceId_key" UNIQUE ("providerId", "providerServiceId");
    END IF;
END $$;

-- FK to TopUpProvider
DO $$ BEGIN
    ALTER TABLE "TopUpProviderService" ADD CONSTRAINT "TopUpProviderService_providerId_fkey" 
    FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "TopUpProviderService_providerId_idx" ON "TopUpProviderService"("providerId");
CREATE INDEX IF NOT EXISTS "TopUpProviderService_status_idx" ON "TopUpProviderService"("status");

-- ============================================================
-- 4. ADD providerServiceId COLUMN TO TopUpOrder
-- ============================================================
DO $$ BEGIN
    ALTER TABLE "TopUpOrder" ADD COLUMN "providerServiceId" UUID;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- FK to TopUpProviderService (nullable, SET NULL on delete)
DO $$ BEGIN
    ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_providerServiceId_fkey" 
    FOREIGN KEY ("providerServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TopUpOrder_providerServiceId_idx" ON "TopUpOrder"("providerServiceId");

-- ============================================================
-- 5. FIX TopUpGameConfig - ensure gameId FK and unique constraint
-- ============================================================
-- The gameId column exists but may not have FK constraint
DO $$ BEGIN
    ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_gameId_fkey" 
    FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unique constraint: check if it exists first (as constraint OR equivalent index)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'TopUpGameConfig_gameId_key' AND conrelid = to_regclass('"TopUpGameConfig"')
    )
    AND to_regclass('"TopUpGameConfig_gameId_key"') IS NULL THEN
        ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_gameId_key" UNIQUE ("gameId");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TopUpGameConfig_gameId_idx" ON "TopUpGameConfig"("gameId");

-- ============================================================
-- 6. RENAME TopUpPackage INDEXES from "TopUpPackage_new_*" to proper names
-- ============================================================
-- These were created by the failed migration that tried to rename the table
DO $$ BEGIN
    ALTER INDEX IF EXISTS "TopUpPackage_new_gameId_isActive_sortOrder_idx" RENAME TO "TopUpPackage_gameId_isActive_sortOrder_idx";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER INDEX IF EXISTS "TopUpPackage_new_providerId_isActive_idx" RENAME TO "TopUpPackage_providerId_isActive_idx";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER INDEX IF EXISTS "TopUpPackage_new_pkey" RENAME TO "TopUpPackage_pkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Ensure FK constraints exist on TopUpPackage
DO $$ BEGIN
    ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_gameId_fkey" 
    FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_providerId_fkey" 
    FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 7. ENSURE TopUpGame FK to TopUpProvider
-- ============================================================
DO $$ BEGIN
    ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_providerId_fkey" 
    FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 8. VERIFY DATA INTEGRITY
-- ============================================================
-- Check that all existing TopUpPackage.gameId values exist in TopUpGame
DO $$ 
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM "TopUpPackage" p
    LEFT JOIN "TopUpGame" g ON p."gameId" = g."id"
    WHERE g."id" IS NULL;
    
    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'Found % TopUpPackage records with invalid gameId', orphan_count;
    END IF;
END $$;

-- Check that all existing OrderItem.topUpPackageId values exist in TopUpPackage
DO $$ 
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM "OrderItem" oi
    LEFT JOIN "TopUpPackage" p ON oi."topUpPackageId" = p."id"
    WHERE oi."topUpPackageId" IS NOT NULL AND p."id" IS NULL;
    
    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'Found % OrderItem records with invalid topUpPackageId', orphan_count;
    END IF;
END $$;

-- Check that all existing TopUpOrder.topUpPackageId values exist in TopUpPackage
DO $$ 
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM "TopUpOrder" o
    LEFT JOIN "TopUpPackage" p ON o."topUpPackageId" = p."id"
    WHERE p."id" IS NULL;
    
    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'Found % TopUpOrder records with invalid topUpPackageId', orphan_count;
    END IF;
END $$;