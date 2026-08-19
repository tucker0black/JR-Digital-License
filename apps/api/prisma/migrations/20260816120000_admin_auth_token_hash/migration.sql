-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "authTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Admin_authTokenHash_key" ON "Admin"("authTokenHash");