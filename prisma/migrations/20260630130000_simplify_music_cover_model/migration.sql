-- Simplify music ownership and cover selection.
-- Songs and albums no longer store cover URLs directly; they select cover records.

ALTER TABLE "MusicTrack"
    ADD COLUMN "coverId" TEXT,
    ADD COLUMN "coverAlbumDocId" TEXT;

ALTER TABLE "Album"
    ADD COLUMN "coverId" TEXT;

UPDATE "MusicTrack" song
SET "coverId" = substring(song."defaultCoverSource" FROM length('song_cover:') + 1)
WHERE song."defaultCoverSource" LIKE 'song_cover:%'
  AND EXISTS (
      SELECT 1
      FROM "SongCover" cover
      WHERE cover."id" = substring(song."defaultCoverSource" FROM length('song_cover:') + 1)
        AND cover."songDocId" = song."docId"
  );

UPDATE "Album" album
SET "coverId" = substring(album."defaultCoverSource" FROM length('album_cover:') + 1)
WHERE album."defaultCoverSource" LIKE 'album_cover:%'
  AND EXISTS (
      SELECT 1
      FROM "AlbumCover" cover
      WHERE cover."id" = substring(album."defaultCoverSource" FROM length('album_cover:') + 1)
        AND cover."albumDocId" = album."docId"
  );

UPDATE "MusicTrack" song
SET "coverAlbumDocId" = cover."albumDocId"
FROM "AlbumCover" cover
WHERE song."defaultCoverSource" LIKE 'album_cover:%'
  AND cover."id" = substring(song."defaultCoverSource" FROM length('album_cover:') + 1);

INSERT INTO "SongCover" (
    "id",
    "songDocId",
    "assetId",
    "storageKey",
    "publicUrl",
    "isDefault",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy_song_cover_' || song."docId",
    song."docId",
    NULL,
    'legacy/song/' || song."docId",
    song."cover",
    true,
    COALESCE(max_cover."nextSortOrder", 0),
    song."createdAt",
    NOW()
FROM "MusicTrack" song
LEFT JOIN LATERAL (
    SELECT MAX("sortOrder") + 1 AS "nextSortOrder"
    FROM "SongCover"
    WHERE "songDocId" = song."docId"
) max_cover ON true
WHERE song."cover" IS NOT NULL
  AND btrim(song."cover") <> ''
  AND song."coverId" IS NULL
  AND song."coverAlbumDocId" IS NULL
ON CONFLICT ("storageKey") DO NOTHING;

UPDATE "MusicTrack" song
SET "coverId" = 'legacy_song_cover_' || song."docId"
WHERE song."coverId" IS NULL
  AND song."coverAlbumDocId" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "SongCover" cover
      WHERE cover."id" = 'legacy_song_cover_' || song."docId"
        AND cover."songDocId" = song."docId"
  );

INSERT INTO "AlbumCover" (
    "id",
    "albumDocId",
    "assetId",
    "storageKey",
    "publicUrl",
    "isDefault",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy_album_cover_' || album."docId",
    album."docId",
    NULL,
    'legacy/album/' || album."docId",
    album."cover",
    true,
    COALESCE(max_cover."nextSortOrder", 0),
    album."createdAt",
    NOW()
FROM "Album" album
LEFT JOIN LATERAL (
    SELECT MAX("sortOrder") + 1 AS "nextSortOrder"
    FROM "AlbumCover"
    WHERE "albumDocId" = album."docId"
) max_cover ON true
WHERE album."cover" IS NOT NULL
  AND btrim(album."cover") <> ''
  AND album."coverId" IS NULL
ON CONFLICT ("storageKey") DO NOTHING;

UPDATE "Album" album
SET "coverId" = 'legacy_album_cover_' || album."docId"
WHERE album."coverId" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "AlbumCover" cover
      WHERE cover."id" = 'legacy_album_cover_' || album."docId"
        AND cover."albumDocId" = album."docId"
  );

UPDATE "SongCover" cover
SET "isDefault" = EXISTS (
    SELECT 1
    FROM "MusicTrack" song
    WHERE song."coverId" = cover."id"
);

UPDATE "AlbumCover" cover
SET "isDefault" = EXISTS (
    SELECT 1
    FROM "Album" album
    WHERE album."coverId" = cover."id"
);

ALTER TABLE "MusicTrack"
    DROP CONSTRAINT IF EXISTS "MusicTrack_addedBy_fkey";

DROP INDEX IF EXISTS "MusicTrack_addedBy_idx";

ALTER TABLE "MusicTrack"
    DROP COLUMN IF EXISTS "cover",
    DROP COLUMN IF EXISTS "defaultCoverSource",
    DROP COLUMN IF EXISTS "customPlatformIds",
    DROP COLUMN IF EXISTS "addedBy";

ALTER TABLE "Album"
    DROP COLUMN IF EXISTS "resourceType",
    DROP COLUMN IF EXISTS "cover",
    DROP COLUMN IF EXISTS "platformUrl",
    DROP COLUMN IF EXISTS "defaultCoverSource";

DROP TYPE IF EXISTS "MusicCollectionType";

CREATE INDEX "MusicTrack_coverId_idx" ON "MusicTrack"("coverId");
CREATE INDEX "MusicTrack_coverAlbumDocId_idx" ON "MusicTrack"("coverAlbumDocId");
CREATE INDEX "Album_coverId_idx" ON "Album"("coverId");

ALTER TABLE "MusicTrack"
    ADD CONSTRAINT "MusicTrack_coverId_fkey"
    FOREIGN KEY ("coverId") REFERENCES "SongCover"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MusicTrack"
    ADD CONSTRAINT "MusicTrack_coverAlbumDocId_fkey"
    FOREIGN KEY ("coverAlbumDocId") REFERENCES "Album"("docId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Album"
    ADD CONSTRAINT "Album_coverId_fkey"
    FOREIGN KEY ("coverId") REFERENCES "AlbumCover"("id") ON DELETE SET NULL ON UPDATE CASCADE;
