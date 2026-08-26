-- Production schema alignment: bring the migrated database up to schema.prisma.
-- Generated from `prisma migrate diff --from-migrations --to-schema-datamodel`
-- against a full replay of every prior migration, with two safety adjustments:
--   * TopUpGame / TopUpPackage "providerServiceId" is converted TEXT -> UUID
--     in place instead of DROP COLUMN + ADD COLUMN, keeping any valid UUID
--     values and nulling anything that is not a valid UUID.
--   * No destructive statement beyond what Prisma itself generated.
--
-- Idempotency adjustment: some databases were patched manually while this
-- migration had never been recorded in _prisma_migrations. Every statement
-- below is therefore guarded (IF NOT EXISTS / pg_type / pg_constraint checks)
-- so `prisma migrate deploy` converges both pristine and pre-patched
-- databases without touching existing rows.

-- CreateEnum (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TopUpInputValidation') THEN
        CREATE TYPE "TopUpInputValidation" AS ENUM ('NUMERIC', 'TEXT');
    END IF;
END $$;

-- DropIndex (idempotent)
DROP INDEX IF EXISTS "TopUpOrder_providerServiceId_idx";

-- AlterTable (SET DATA TYPE to the same type is a harmless no-op)
ALTER TABLE "Banner" ALTER COLUMN "startsAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endsAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "startAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CouponUsage" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerNotification" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Favorite" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FlashDeal" ALTER COLUMN "startsAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endsAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable (idempotent)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isHandDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (idempotent; TEXT -> UUID conversion only when still TEXT)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'TopUpGame'
        AND column_name = 'providerServiceId'
        AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE "TopUpGame" ALTER COLUMN "providerServiceId" SET DATA TYPE UUID
        USING CASE
            WHEN "providerServiceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN "providerServiceId"::uuid
            ELSE NULL
        END;
    END IF;
END $$;

-- AlterTable (no-op safe when already applied)
ALTER TABLE "TopUpGame" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable (idempotent)
ALTER TABLE "TopUpGameConfig" ADD COLUMN IF NOT EXISTS "playerIdValidation" "TopUpInputValidation" NOT NULL DEFAULT 'TEXT',
ADD COLUMN IF NOT EXISTS "serverIdValidation" "TopUpInputValidation" NOT NULL DEFAULT 'TEXT',
ADD COLUMN IF NOT EXISTS "verificationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "verificationProviderId" UUID,
ADD COLUMN IF NOT EXISTS "verificationServiceId" UUID,
ALTER COLUMN "gameId" SET NOT NULL;

-- AlterTable (idempotent; TEXT -> UUID conversion only when still TEXT)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'TopUpPackage'
        AND column_name = 'providerServiceId'
        AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE "TopUpPackage" ALTER COLUMN "providerServiceId" SET DATA TYPE UUID
        USING CASE
            WHEN "providerServiceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN "providerServiceId"::uuid
            ELSE NULL
        END;
    END IF;
END $$;

-- AlterTable (no-op safe when already applied)
ALTER TABLE "TopUpPackage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable (no-op safe when already applied)
ALTER TABLE "TopUpProviderService" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "ManualDelivery" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deliveredBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "ManualDelivery_orderItemId_key" ON "ManualDelivery"("orderItemId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "ManualDelivery_orderId_idx" ON "ManualDelivery"("orderId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "ManualDelivery_orderItemId_idx" ON "ManualDelivery"("orderItemId");

-- CreateIndex
-- The unique indexes below already exist from 20260824120000 as PARTIAL
-- indexes (WHERE "..." IS NOT NULL). schema.prisma defines full indexes,
-- so replace them. Full uniques still allow multiple NULLs in PostgreSQL.
DROP INDEX IF EXISTS "Coupon_code_idx";
CREATE INDEX IF NOT EXISTS "Coupon_code_idx" ON "Coupon"("code");

DROP INDEX IF EXISTS "CustomerNotification_dedupeKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerNotification_dedupeKey_key" ON "CustomerNotification"("dedupeKey");

DROP INDEX IF EXISTS "SmmOrder_providerRequestKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SmmOrder_providerRequestKey_key" ON "SmmOrder"("providerRequestKey");

DROP INDEX IF EXISTS "TopUpOrder_providerRequestKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TopUpOrder_providerRequestKey_key" ON "TopUpOrder"("providerRequestKey");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "TopUpOrder_orderItemId_idx" ON "TopUpOrder"("orderItemId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "SmmOrder_orderItemId_idx" ON "SmmOrder"("orderItemId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "TopUpPackage_providerServiceId_idx" ON "TopUpPackage"("providerServiceId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "TopUpGame_providerServiceId_idx" ON "TopUpGame"("providerServiceId");

-- RenameForeignKey
-- The corrective migration 20260823000000 may have already added a duplicate
-- "TopUpPackage_providerId_fkey" while the renamed "_new_" constraint still
-- existed under its old name. Reconcile deterministically:
--   both exist            -> drop the redundant "_new_" constraint
--   only "_new_" exists   -> rename it to the canonical name
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TopUpPackage_new_providerId_fkey'
        AND conrelid = '"TopUpPackage"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'TopUpPackage_providerId_fkey'
            AND conrelid = '"TopUpPackage"'::regclass
        ) THEN
            ALTER TABLE "TopUpPackage" DROP CONSTRAINT "TopUpPackage_new_providerId_fkey";
        ELSE
            ALTER TABLE "TopUpPackage" RENAME CONSTRAINT "TopUpPackage_new_providerId_fkey" TO "TopUpPackage_providerId_fkey";
        END IF;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TopUpGame_providerServiceId_fkey'
        AND conrelid = '"TopUpGame"'::regclass
    ) THEN
        ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_providerServiceId_fkey" FOREIGN KEY ("providerServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TopUpPackage_providerServiceId_fkey'
        AND conrelid = '"TopUpPackage"'::regclass
    ) THEN
        ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_providerServiceId_fkey" FOREIGN KEY ("providerServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TopUpGameConfig_verificationProviderId_fkey'
        AND conrelid = '"TopUpGameConfig"'::regclass
    ) THEN
        ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_verificationProviderId_fkey" FOREIGN KEY ("verificationProviderId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TopUpGameConfig_verificationServiceId_fkey'
        AND conrelid = '"TopUpGameConfig"'::regclass
    ) THEN
        ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_verificationServiceId_fkey" FOREIGN KEY ("verificationServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ManualDelivery_orderItemId_fkey'
        AND conrelid = '"ManualDelivery"'::regclass
    ) THEN
        ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ManualDelivery_orderId_fkey'
        AND conrelid = '"ManualDelivery"'::regclass
    ) THEN
        ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ManualDelivery_productId_fkey'
        AND conrelid = '"ManualDelivery"'::regclass
    ) THEN
        ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
