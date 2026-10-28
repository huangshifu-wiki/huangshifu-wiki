-- Establish the canonical ImageMap to logical MediaAsset relationship.
-- This migration intentionally performs no content or MD5 inference.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "photoAssetId" TEXT;

ALTER TABLE "MediaAsset"
  ADD COLUMN IF NOT EXISTS "imageMapId" TEXT;

ALTER TABLE "MediaAsset"
  ALTER COLUMN "storageKey" DROP NOT NULL,
  ALTER COLUMN "publicUrl" DROP NOT NULL;

ALTER TABLE "ImageMap"
  ADD COLUMN IF NOT EXISTS "s3Key" TEXT,
  ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "MediaAsset_storageKey_key";

CREATE INDEX IF NOT EXISTS "User_photoAssetId_idx"
  ON "User"("photoAssetId");
DROP INDEX IF EXISTS "SongCover_storageKey_key";
DROP INDEX IF EXISTS "AlbumCover_storageKey_key";

CREATE INDEX IF NOT EXISTS "MediaAsset_imageMapId_idx"
  ON "MediaAsset"("imageMapId");

CREATE INDEX IF NOT EXISTS "MediaAsset_status_idx"
  ON "MediaAsset"("status");

CREATE INDEX IF NOT EXISTS "ImageMap_retiredAt_idx"
  ON "ImageMap"("retiredAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_photoAssetId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_photoAssetId_fkey"
      FOREIGN KEY ("photoAssetId") REFERENCES "MediaAsset"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MediaAsset_imageMapId_fkey'
  ) THEN
    ALTER TABLE "MediaAsset"
      ADD CONSTRAINT "MediaAsset_imageMapId_fkey"
      FOREIGN KEY ("imageMapId") REFERENCES "ImageMap"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
