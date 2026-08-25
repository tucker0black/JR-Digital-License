-- Additive purchase-safety metadata.
-- Existing order, provider, and notification rows remain valid; nullable
-- columns allow a zero-downtime deployment before the new code writes them.

ALTER TABLE "OrderItem"
  ADD COLUMN "providerIdSnapshot" UUID,
  ADD COLUMN "providerServiceExternalIdSnapshot" TEXT,
  ADD COLUMN "providerOfferIdSnapshot" TEXT,
  ADD COLUMN "providerCostSnapshot" DECIMAL(18,2);

ALTER TABLE "TopUpOrder"
  ADD COLUMN "orderItemId" UUID,
  ADD COLUMN "providerServiceExternalId" TEXT,
  ADD COLUMN "providerOfferId" TEXT,
  ADD COLUMN "providerRequestKey" TEXT,
  ADD COLUMN "providerRequestStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE "SmmOrder"
  ADD COLUMN "orderItemId" UUID,
  ADD COLUMN "providerRequestKey" TEXT;

ALTER TABLE "CustomerNotification"
  ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "TopUpOrder_orderItemId_key"
  ON "TopUpOrder"("orderItemId")
  WHERE "orderItemId" IS NOT NULL;

CREATE UNIQUE INDEX "TopUpOrder_providerRequestKey_key"
  ON "TopUpOrder"("providerRequestKey")
  WHERE "providerRequestKey" IS NOT NULL;

CREATE UNIQUE INDEX "SmmOrder_orderItemId_key"
  ON "SmmOrder"("orderItemId")
  WHERE "orderItemId" IS NOT NULL;

CREATE UNIQUE INDEX "SmmOrder_providerRequestKey_key"
  ON "SmmOrder"("providerRequestKey")
  WHERE "providerRequestKey" IS NOT NULL;

CREATE UNIQUE INDEX "CustomerNotification_dedupeKey_key"
  ON "CustomerNotification"("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

ALTER TABLE "TopUpOrder"
  ADD CONSTRAINT "TopUpOrder_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SmmOrder"
  ADD CONSTRAINT "SmmOrder_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
