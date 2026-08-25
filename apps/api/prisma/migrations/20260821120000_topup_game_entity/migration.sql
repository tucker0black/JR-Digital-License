-- CreateTable
CREATE TABLE "TopUpGame" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "providerId" UUID,
    "providerServiceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpGame_name_key" ON "TopUpGame"("name");

-- CreateIndex
CREATE INDEX "TopUpGame_isActive_sortOrder_idx" ON "TopUpGame"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "TopUpGame_providerId_idx" ON "TopUpGame"("providerId");

-- CreateTable
CREATE TABLE "TopUpPackage_new" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "diamondAmount" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "providerId" UUID,
    "providerServiceId" TEXT,
    "providerCost" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpPackage_new_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopUpPackage_new_gameId_isActive_sortOrder_idx" ON "TopUpPackage_new"("gameId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "TopUpPackage_new_providerId_isActive_idx" ON "TopUpPackage_new"("providerId", "isActive");

-- AddForeignKey
ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpPackage_new" ADD CONSTRAINT "TopUpPackage_new_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpPackage_new" ADD CONSTRAINT "TopUpPackage_new_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;