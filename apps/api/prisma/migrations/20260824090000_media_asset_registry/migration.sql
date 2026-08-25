-- Application-owned media asset registry.
-- Uploaded images live in permanent server-owned storage; this table is the
-- ownership ledger that lets the API serve them at /api/media/<filename> and
-- refuse deletion while any record still references the file. Existing
-- imageUrl data everywhere is untouched (nullable-free additive migration).
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_filename_key" ON "MediaAsset"("filename");
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");
