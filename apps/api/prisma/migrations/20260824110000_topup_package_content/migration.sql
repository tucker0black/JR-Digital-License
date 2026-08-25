-- Generic customer-facing package content. Existing diamondAmount values are
-- intentionally preserved for legacy packages and API consumers.
ALTER TABLE "TopUpPackage" ADD COLUMN "content" TEXT;
