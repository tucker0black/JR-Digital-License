-- Fix TopUp schema: migrate from old string-based game to UUID-based gameId

-- Step 1: Create TopUpGame entries for each unique game in old TopUpPackage
INSERT INTO "TopUpGame" ("id", "name", "imageUrl", "providerId", "providerServiceId", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid(),
    "game",
    NULL,
    NULL,
    NULL,
    true,
    0,
    MIN("createdAt"),
    MAX("updatedAt")
FROM "TopUpPackage"
GROUP BY "game"
ON CONFLICT ("name") DO NOTHING;

-- Step 2: Migrate packages from old TopUpPackage to TopUpPackage_new
INSERT INTO "TopUpPackage_new" ("id", "gameId", "name", "diamondAmount", "price", "currency", "providerId", "providerServiceId", "providerCost", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT 
    op."id",
    tg."id",
    op."name",
    op."diamondAmount",
    op."price",
    op."currency",
    op."providerId",
    op."providerServiceId",
    op."providerCost",
    op."isActive",
    op."sortOrder",
    op."createdAt",
    op."updatedAt"
FROM "TopUpPackage" op
JOIN "TopUpGame" tg ON tg."name" = op."game";

-- Step 3: Migrate TopUpGameConfig from old (game string) to new (gameId UUID)
-- First, add gameId column to TopUpGameConfig if it doesn't exist
ALTER TABLE "TopUpGameConfig" ADD COLUMN IF NOT EXISTS "gameId" UUID;

-- Update gameId based on game name
UPDATE "TopUpGameConfig" tgc
SET "gameId" = tg."id"
FROM "TopUpGame" tg
WHERE tgc."game" = tg."name";

-- Step 3.5: Drop foreign key constraints that depend on TopUpPackage
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_topUpPackageId_fkey";
ALTER TABLE "TopUpOrder" DROP CONSTRAINT IF EXISTS "TopUpOrder_topUpPackageId_fkey";

-- Step 4: Drop old TopUpPackage table
DROP TABLE "TopUpPackage";

-- Step 5: Rename TopUpPackage_new to TopUpPackage
ALTER TABLE "TopUpPackage_new" RENAME TO "TopUpPackage";

-- Step 6: Add foreign key constraints to the renamed TopUpPackage table
ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopUpPackage" ADD CONSTRAINT "TopUpPackage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 6.5: Recreate foreign key constraints from OrderItem and TopUpOrder
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_topUpPackageId_fkey" FOREIGN KEY ("topUpPackageId") REFERENCES "TopUpPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_topUpPackageId_fkey" FOREIGN KEY ("topUpPackageId") REFERENCES "TopUpPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 7: Recreate indexes on the new TopUpPackage table
CREATE INDEX "TopUpPackage_gameId_isActive_sortOrder_idx" ON "TopUpPackage"("gameId", "isActive", "sortOrder");
CREATE INDEX "TopUpPackage_providerId_isActive_idx" ON "TopUpPackage"("providerId", "isActive");

-- Step 8: Fix TopUpGameConfig - drop old unique index on "game", add unique on "gameId"
DROP INDEX IF EXISTS "TopUpGameConfig_game_key";
ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_gameId_key" UNIQUE ("gameId");
ALTER TABLE "TopUpGameConfig" ADD CONSTRAINT "TopUpGameConfig_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TopUpGameConfig_gameId_idx" ON "TopUpGameConfig"("gameId");

-- Step 9: Drop the old "game" column from TopUpGameConfig (optional, but clean)
ALTER TABLE "TopUpGameConfig" DROP COLUMN IF EXISTS "game";

-- Step 10: Ensure TopUpGame has proper foreign key to TopUpProvider
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'TopUpGame_providerId_fkey' 
        AND conrelid = '"TopUpGame"'::regclass
    ) THEN
        ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TopUpProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;