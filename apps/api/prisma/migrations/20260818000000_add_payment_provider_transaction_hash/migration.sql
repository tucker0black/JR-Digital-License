-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "providerTransactionHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTransactionHash_key" ON "Payment"("providerTransactionHash");