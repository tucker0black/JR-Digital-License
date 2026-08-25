-- Generic provider-driven account verification for game top-ups.
-- No per-game columns: verified values live in a dynamic JSON map.
ALTER TABLE "TopUpGameConfig" ADD COLUMN "allowUnverifiedPurchase" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "TopUpVerificationStatus" AS ENUM ('VALID', 'CONSUMED', 'SUPERSEDED');

CREATE TABLE "TopUpVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "providerId" UUID,
    "providerServiceId" UUID,
    "categoryId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "fieldsHash" TEXT NOT NULL,
    "status" "TopUpVerificationStatus" NOT NULL DEFAULT 'VALID',
    "playerName" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "orderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopUpVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopUpVerification_userId_packageId_status_expiresAt_idx" ON "TopUpVerification"("userId", "packageId", "status", "expiresAt");
CREATE INDEX "TopUpVerification_fieldsHash_idx" ON "TopUpVerification"("fieldsHash");

ALTER TABLE "TopUpVerification" ADD CONSTRAINT "TopUpVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopUpVerification" ADD CONSTRAINT "TopUpVerification_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TopUpPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopUpVerification" ADD CONSTRAINT "TopUpVerification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;