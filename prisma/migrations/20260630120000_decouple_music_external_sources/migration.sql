-- Decouple music entities from platform identity. Songs and albums are identified by docId;
-- platform IDs become optional external sources.

CREATE TYPE "MusicExternalResourceType" AS ENUM ('song', 'album');

CREATE TABLE "MusicExternalSource" (
    "id" TEXT NOT NULL,
    "resourceType" "MusicExternalResourceType" NOT NULL,
    "songDocId" TEXT,
    "albumDocId" TEXT,
    "platform" "MusicPlatform" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicExternalSource_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "songDocId",
    "platform",
    "sourceId",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'song_netease_' || "docId",
    'song'::"MusicExternalResourceType",
    "docId",
    'netease'::"MusicPlatform",
    "neteaseId",
    "primaryPlatform" = 'netease',
    "createdAt",
    NOW()
FROM "MusicTrack"
WHERE "neteaseId" IS NOT NULL AND btrim("neteaseId") <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "songDocId",
    "platform",
    "sourceId",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'song_tencent_' || "docId",
    'song'::"MusicExternalResourceType",
    "docId",
    'tencent'::"MusicPlatform",
    "tencentId",
    "primaryPlatform" = 'tencent',
    "createdAt",
    NOW()
FROM "MusicTrack"
WHERE "tencentId" IS NOT NULL AND btrim("tencentId") <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "songDocId",
    "platform",
    "sourceId",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'song_kugou_' || "docId",
    'song'::"MusicExternalResourceType",
    "docId",
    'kugou'::"MusicPlatform",
    "kugouId",
    "primaryPlatform" = 'kugou',
    "createdAt",
    NOW()
FROM "MusicTrack"
WHERE "kugouId" IS NOT NULL AND btrim("kugouId") <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "songDocId",
    "platform",
    "sourceId",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'song_baidu_' || "docId",
    'song'::"MusicExternalResourceType",
    "docId",
    'baidu'::"MusicPlatform",
    "baiduId",
    "primaryPlatform" = 'baidu',
    "createdAt",
    NOW()
FROM "MusicTrack"
WHERE "baiduId" IS NOT NULL AND btrim("baiduId") <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "songDocId",
    "platform",
    "sourceId",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'song_kuwo_' || "docId",
    'song'::"MusicExternalResourceType",
    "docId",
    'kuwo'::"MusicPlatform",
    "kuwoId",
    "primaryPlatform" = 'kuwo',
    "createdAt",
    NOW()
FROM "MusicTrack"
WHERE "kuwoId" IS NOT NULL AND btrim("kuwoId") <> ''
ON CONFLICT DO NOTHING;

UPDATE "MusicExternalSource" source
SET "isPrimary" = true
WHERE source."id" IN (
    SELECT DISTINCT ON ("songDocId") "id"
    FROM "MusicExternalSource"
    WHERE "resourceType" = 'song'::"MusicExternalResourceType"
      AND "songDocId" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM "MusicExternalSource" primary_source
          WHERE primary_source."resourceType" = 'song'::"MusicExternalResourceType"
            AND primary_source."songDocId" = "MusicExternalSource"."songDocId"
            AND primary_source."isPrimary" = true
      )
    ORDER BY "songDocId", "createdAt", "id"
);

INSERT INTO "MusicExternalSource" (
    "id",
    "resourceType",
    "albumDocId",
    "platform",
    "sourceId",
    "sourceUrl",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'album_primary_' || "docId",
    'album'::"MusicExternalResourceType",
    "docId",
    "platform",
    "sourceId",
    "platformUrl",
    true,
    "createdAt",
    NOW()
FROM "Album"
WHERE "sourceId" IS NOT NULL AND btrim("sourceId") <> ''
ON CONFLICT DO NOTHING;

DELETE FROM "MusicExternalSource" kept
USING "MusicExternalSource" removed
WHERE kept."resourceType" = removed."resourceType"
  AND kept."platform" = removed."platform"
  AND kept."sourceId" = removed."sourceId"
  AND kept."id" > removed."id";

CREATE UNIQUE INDEX "MusicExternalSource_resourceType_platform_sourceId_key"
    ON "MusicExternalSource"("resourceType", "platform", "sourceId");
CREATE INDEX "MusicExternalSource_songDocId_idx" ON "MusicExternalSource"("songDocId");
CREATE INDEX "MusicExternalSource_albumDocId_idx" ON "MusicExternalSource"("albumDocId");
CREATE INDEX "MusicExternalSource_platform_sourceId_idx" ON "MusicExternalSource"("platform", "sourceId");

ALTER TABLE "MusicExternalSource"
    ADD CONSTRAINT "MusicExternalSource_songDocId_fkey"
    FOREIGN KEY ("songDocId") REFERENCES "MusicTrack"("docId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MusicExternalSource"
    ADD CONSTRAINT "MusicExternalSource_albumDocId_fkey"
    FOREIGN KEY ("albumDocId") REFERENCES "Album"("docId") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Album_platform_sourceId_resourceType_key";
DROP INDEX IF EXISTS "Album_id_key";
DROP INDEX IF EXISTS "MusicTrack_id_key";
DROP INDEX IF EXISTS "MusicTrack_primaryPlatform_idx";
DROP INDEX IF EXISTS "MusicTrack_enabledPlatform_idx";
DROP INDEX IF EXISTS "MusicTrack_neteaseId_idx";
DROP INDEX IF EXISTS "MusicTrack_tencentId_idx";
DROP INDEX IF EXISTS "MusicTrack_kugouId_idx";
DROP INDEX IF EXISTS "MusicTrack_baiduId_idx";
DROP INDEX IF EXISTS "MusicTrack_kuwoId_idx";

ALTER TABLE "Album"
    DROP COLUMN "id",
    DROP COLUMN "platform",
    DROP COLUMN "sourceId";

ALTER TABLE "MusicTrack"
    DROP COLUMN "id",
    DROP COLUMN "primaryPlatform",
    DROP COLUMN "enabledPlatform",
    DROP COLUMN "neteaseId",
    DROP COLUMN "tencentId",
    DROP COLUMN "kugouId",
    DROP COLUMN "baiduId",
    DROP COLUMN "kuwoId";
