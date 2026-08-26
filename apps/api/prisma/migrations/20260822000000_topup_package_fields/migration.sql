-- Add new fields to TopUpPackage
ALTER TABLE "TopUpPackage" ADD COLUMN "icon" TEXT;
ALTER TABLE "TopUpPackage" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "TopUpPackage" ADD COLUMN "customerNote" TEXT;
ALTER TABLE "TopUpPackage" ADD COLUMN "noteColor" TEXT NOT NULL DEFAULT 'WARNING';

-- Create enum type for noteColor
DO $$ BEGIN
    CREATE TYPE "TopUpPackageNoteColor" AS ENUM ('WARNING', 'INFO', 'SUCCESS', 'DANGER', 'PURPLE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alter noteColor column to use enum
ALTER TABLE "TopUpPackage" ALTER COLUMN "noteColor" DROP DEFAULT;
ALTER TABLE "TopUpPackage" ALTER COLUMN "noteColor" TYPE "TopUpPackageNoteColor" USING "noteColor"::"TopUpPackageNoteColor";
ALTER TABLE "TopUpPackage" ALTER COLUMN "noteColor" SET DEFAULT 'WARNING';