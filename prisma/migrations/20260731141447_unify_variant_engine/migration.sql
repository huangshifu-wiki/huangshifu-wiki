-- AlterTable
ALTER TABLE "AlbumCover" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "variantGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "variantStatus" "VariantStatus" NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "SongCover" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "variantGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "variantStatus" "VariantStatus" NOT NULL DEFAULT 'pending';

-- Backfill: existing thumbnails are completed variants; rows without one stay pending so the startup recover pass completes them.
UPDATE "SongCover" SET "variantStatus" = 'completed' WHERE "thumbnailUrl" IS NOT NULL;
UPDATE "SongCover" SET "variantStatus" = 'pending' WHERE "thumbnailUrl" IS NULL;
UPDATE "AlbumCover" SET "variantStatus" = 'completed' WHERE "thumbnailUrl" IS NOT NULL;
UPDATE "AlbumCover" SET "variantStatus" = 'pending' WHERE "thumbnailUrl" IS NULL;
