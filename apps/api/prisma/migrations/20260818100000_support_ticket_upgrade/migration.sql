-- CreateEnum
CREATE TYPE "SupportMessageSender" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN "sender" "SupportMessageSender" NOT NULL DEFAULT 'USER';

-- AlterTable
CREATE SEQUENCE "SupportTicket_number_seq";
ALTER TABLE "SupportTicket" ADD COLUMN "number" INTEGER;

-- Backfill sequential ticket numbers for existing tickets
UPDATE "SupportTicket" SET "number" = nextval('"SupportTicket_number_seq"') WHERE "number" IS NULL;

-- Set NOT NULL and attach sequence
ALTER TABLE "SupportTicket" ALTER COLUMN "number" SET DEFAULT nextval('"SupportTicket_number_seq"');
ALTER TABLE "SupportTicket" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "SupportTicket_number_seq" OWNED BY "SupportTicket"."number";

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
