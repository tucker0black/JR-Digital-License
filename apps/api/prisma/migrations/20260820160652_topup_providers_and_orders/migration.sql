-- CreateEnum
CREATE TYPE "TopUpProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TopUpOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "DeliveryType" ADD VALUE 'TOPUP';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "topUpPackageId" UUID;

-- AlterTable
ALTER TABLE "TopUpPackage" ADD COLUMN     "providerCost" DECIMAL(18,2),
ADD COLUMN     "providerId" UUID,
ADD COLUMN     "providerServiceId" TEXT;

-- CreateTable
CREATE TABLE "TopUpProvider" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "status" "TopUpProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "topUpPackageId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerOrderId" TEXT,
    "target" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "TopUpOrderStatus" NOT NULL DEFAULT 'PENDING',
    "lastProviderStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpProvider_name_key" ON "TopUpProvider"("name");

-- CreateIndex
CREATE INDEX "TopUpProvider_status_idx" ON "TopUpProvider"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpOrder_providerOrderId_key" ON "TopUpOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "TopUpOrder_status_updatedAt_idx" ON "TopUpOrder"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TopUpOrder_orderId_idx" ON "TopUpOrder"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_topUpPackageId_idx" ON "OrderItem"("topUpPackageId");

-- CreateIndex
CREATE INDEX "TopUpPackage_providerId_isActive_idx" ON "TopUpPackage"("providerId", "isActive");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_topUpPackageId_fkey" FOREIGN KEY ("topUpPackageId") REFERENCES "TopUpPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_topUpPackageId_fkey" FOREIGN KEY ("topUpPackageId") REFERENCES "TopUpPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
