-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'DELIVERED', 'DISABLED');

-- AlterEnum
ALTER TYPE "SupportTicketStatus" ADD VALUE 'WAITING_FOR_CUSTOMER';

-- CreateTable
CREATE TABLE "License" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'AVAILABLE',
    "orderId" UUID,
    "orderItemId" UUID,
    "reservedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "License_productId_status_idx" ON "License"("productId", "status");

-- CreateIndex
CREATE INDEX "License_orderId_idx" ON "License"("orderId");

-- CreateIndex
CREATE INDEX "License_orderItemId_idx" ON "License"("orderItemId");

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
