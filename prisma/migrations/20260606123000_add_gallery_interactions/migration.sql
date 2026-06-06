ALTER TYPE "FavoriteTargetType" ADD VALUE IF NOT EXISTS 'gallery';

ALTER TABLE "Gallery"
  ADD COLUMN IF NOT EXISTS "likesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dislikesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "favoritesCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "GalleryLike" (
  "id" TEXT NOT NULL,
  "galleryId" TEXT NOT NULL,
  "userUid" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GalleryDislike" (
  "id" TEXT NOT NULL,
  "galleryId" TEXT NOT NULL,
  "userUid" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryDislike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GalleryLike_galleryId_userUid_key" ON "GalleryLike"("galleryId", "userUid");
CREATE INDEX IF NOT EXISTS "GalleryLike_userUid_galleryId_idx" ON "GalleryLike"("userUid", "galleryId");
CREATE INDEX IF NOT EXISTS "GalleryLike_userUid_createdAt_idx" ON "GalleryLike"("userUid", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "GalleryDislike_galleryId_userUid_key" ON "GalleryDislike"("galleryId", "userUid");
CREATE INDEX IF NOT EXISTS "GalleryDislike_userUid_galleryId_idx" ON "GalleryDislike"("userUid", "galleryId");
CREATE INDEX IF NOT EXISTS "GalleryDislike_userUid_createdAt_idx" ON "GalleryDislike"("userUid", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryLike_galleryId_fkey'
  ) THEN
    ALTER TABLE "GalleryLike"
      ADD CONSTRAINT "GalleryLike_galleryId_fkey"
      FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryLike_userUid_fkey'
  ) THEN
    ALTER TABLE "GalleryLike"
      ADD CONSTRAINT "GalleryLike_userUid_fkey"
      FOREIGN KEY ("userUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryDislike_galleryId_fkey'
  ) THEN
    ALTER TABLE "GalleryDislike"
      ADD CONSTRAINT "GalleryDislike_galleryId_fkey"
      FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryDislike_userUid_fkey'
  ) THEN
    ALTER TABLE "GalleryDislike"
      ADD CONSTRAINT "GalleryDislike_userUid_fkey"
      FOREIGN KEY ("userUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
