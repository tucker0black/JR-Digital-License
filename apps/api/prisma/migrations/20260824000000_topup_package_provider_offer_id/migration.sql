-- External provider offer/product ID (e.g. FazerCards offer_id) stored
-- separately from the internal package UUID. Nullable: packages that are not
-- provider-linked stay NULL. Existing rows and prices are untouched.
ALTER TABLE "TopUpPackage" ADD COLUMN "providerOfferId" TEXT;

CREATE INDEX "TopUpPackage_providerOfferId_idx" ON "TopUpPackage"("providerOfferId");