-- DropIndex
DROP INDEX "SmmService_productId_key";

-- CreateTable
CREATE TABLE "TopUpPackage" (
    "id" UUID NOT NULL,
    "game" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "diamondAmount" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopUpPackage_game_isActive_sortOrder_idx" ON "TopUpPackage"("game", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "SmmService_productId_status_idx" ON "SmmService"("productId", "status");
