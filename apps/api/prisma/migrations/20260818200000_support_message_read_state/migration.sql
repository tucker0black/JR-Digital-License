-- AlterTable
-- Existing messages are treated as already read so customers/admins do not
-- receive retroactive notification counts.
ALTER TABLE "SupportMessage" ADD COLUMN "adminReadAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SupportMessage" ADD COLUMN "customerReadAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
