-- Production schema alignment: bring the migrated database up to schema.prisma.
-- Generated from `prisma migrate diff --from-migrations --to-schema-datamodel`
-- against a full replay of every prior migration, with two safety adjustments:
--   * TopUpGame / TopUpPackage "providerServiceId" is converted TEXT -> UUID
--     in place instead of DROP COLUMN + ADD COLUMN, keeping any valid UUID
--     values and nulling anything that is not a valid UUID.
--   * No destructive statement beyond what Prisma itself generated.

-- CreateEnum
CREATE TYPE "TopUpInputValidation" AS ENUM ('NUMERIC', 'TEXT');

-- DropIndex
DROP INDEX "TopUpOrder_providerServiceId_idx";

-- AlterTable
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

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "isHandDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TopUpGame" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "providerServiceId" SET DATA TYPE UUID
USING CASE
    WHEN "providerServiceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN "providerServiceId"::uuid
    ELSE NULL
END;

-- AlterTable
ALTER TABLE "TopUpGameConfig" ADD COLUMN "playerIdValidation" "TopUpInputValidation" NOT NULL DEFAULT 'TEXT',
ADD COLUMN "serverIdValidation" "TopUpInputValidation" NOT NULL DEFAULT 'TEXT',
ADD COLUMN "verificationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "verificationProviderId" UUID,
ADD COLUMN "verificationServiceId" UUID,
ALTER COLUMN "gameId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TopUpPackage" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "providerServiceId" SET DATA TYPE UUID
USING CASE
    WHEN "providerServiceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN "providerServiceId"::uuid
    ELSE NULL
END;

-- AlterTable
ALTER TABLE "TopUpProviderService" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ManualDelivery" (
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

-- CreateIndex
CREATE UNIQUE INDEX "ManualDelivery_orderItemId_key" ON "ManualDelivery"("orderItemId");

-- CreateIndex
CREATE INDEX "ManualDelivery_orderId_idx" ON "ManualDelivery"("orderId");

-- CreateIndex
CREATE INDEX "ManualDelivery_orderItemId_idx" ON "ManualDelivery"("orderItemId");

-- CreateIndex
-- The unique indexes below already exist from 20260824120000 as PARTIAL
-- indexes (WHERE "..." IS NOT NULL). schema.prisma defines full indexes,
-- so replace them. Full uniques still allow multiple NULLs in PostgreSQL.
DROP INDEX IF EXISTS "Coupon_code_idx";
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

DROP INDEX IF EXISTS "CustomerNotification_dedupeKey_key";
CREATE UNIQUE INDEX "CustomerNotification_dedupeKey_key" ON "CustomerNotification"("dedupeKey");

DROP INDEX IF EXISTS "SmmOrder_providerRequestKey_key";
CREATE UNIQUE INDEX "SmmOrder_providerRequestKey_key" ON "SmmOrder"("providerRequestKey");

DROP INDEX IF EXISTS "TopUpOrder_providerRequestKey_key";
CREATE UNIQUE INDEX "TopUpOrder_providerRequestKey_key" ON "TopUpOrder"("providerRequestKey");

-- CreateIndex
CREATE INDEX "TopUpOrder_orderItemId_idx" ON "TopUpOrder"("orderItemId");

-- CreateIndex
CREATE INDEX "SmmOrder_orderItemId_idx" ON "SmmOrder"("orderItemId");

-- CreateIndex
CREATE INDEX "TopUpPackage_providerServiceId_idx" ON "TopUpPackage"("providerServiceId");

-- CreateIndex
CREATE INDEX "TopUpGame_providerServiceId_idx" ON "TopUpGame"("providerServiceId");

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

-- AddForeignKey
ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_providerServiceId_fkey" FOREIGN KEY ("providerServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_providerServiceId_fkey" FOREIGN KEY ("providerServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_verificationProviderId_fkey" FOREIGN KEY ("verificationProviderId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_verificationServiceId_fkey" FOREIGN KEY ("verificationServiceId") REFERENCES "TopUpProviderService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDelivery" ADD CONSTRAINT "ManualDelivery_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
