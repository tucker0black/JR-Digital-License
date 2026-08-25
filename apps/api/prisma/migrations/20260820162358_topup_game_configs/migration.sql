-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "customFieldValues" JSONB,
ADD COLUMN     "serverId" TEXT;

-- AlterTable
ALTER TABLE "TopUpOrder" ADD COLUMN     "customFieldValues" JSONB,
ADD COLUMN     "serverId" TEXT;

-- CreateTable
CREATE TABLE "TopUpGameConfig" (
    "id" UUID NOT NULL,
    "game" TEXT NOT NULL,
    "requirePlayerId" BOOLEAN NOT NULL DEFAULT true,
    "requireServerId" BOOLEAN NOT NULL DEFAULT false,
    "customerNote" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpGameConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpGameConfig_game_key" ON "TopUpGameConfig"("game");

-- CreateIndex
CREATE INDEX "TopUpGameConfig_game_idx" ON "TopUpGameConfig"("game");
