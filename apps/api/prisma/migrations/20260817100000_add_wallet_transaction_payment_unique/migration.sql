-- DropIndex
DROP INDEX "WalletTransaction_paymentId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_paymentId_key" ON "WalletTransaction"("paymentId");