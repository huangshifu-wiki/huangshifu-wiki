-- 统一公开内容 URL：每个栏目按创建时间递增生成数字 slug。

ALTER TABLE "Post" ADD COLUMN "slug" TEXT;
ALTER TABLE "Gallery" ADD COLUMN "slug" TEXT;
ALTER TABLE "MusicTrack" ADD COLUMN "slug" TEXT;
ALTER TABLE "Album" ADD COLUMN "slug" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC)::TEXT AS next_slug
  FROM "Post"
)
UPDATE "Post" AS target
SET "slug" = numbered.next_slug
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC)::TEXT AS next_slug
  FROM "Gallery"
)
UPDATE "Gallery" AS target
SET "slug" = numbered.next_slug
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
  SELECT "docId", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "docId" ASC)::TEXT AS next_slug
  FROM "MusicTrack"
)
UPDATE "MusicTrack" AS target
SET "slug" = numbered.next_slug
FROM numbered
WHERE target."docId" = numbered."docId";

WITH numbered AS (
  SELECT "docId", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "docId" ASC)::TEXT AS next_slug
  FROM "Album"
)
UPDATE "Album" AS target
SET "slug" = numbered.next_slug
FROM numbered
WHERE target."docId" = numbered."docId";

CREATE TEMP TABLE "_WikiSlugMap" ON COMMIT DROP AS
SELECT
  "slug" AS old_slug,
  ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "slug" ASC)::TEXT AS new_slug
FROM "WikiPage";

CREATE TEMP TABLE "_EventSlugMap" ON COMMIT DROP AS
SELECT
  "slug" AS old_slug,
  ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "slug" ASC)::TEXT AS new_slug
FROM "Event";

ALTER TABLE "WikiRevision" DROP CONSTRAINT IF EXISTS "WikiRevision_pageSlug_fkey";
ALTER TABLE "WikiBranch" DROP CONSTRAINT IF EXISTS "WikiBranch_pageSlug_fkey";
ALTER TABLE "WikiPullRequest" DROP CONSTRAINT IF EXISTS "WikiPullRequest_pageSlug_fkey";
ALTER TABLE "WikiLike" DROP CONSTRAINT IF EXISTS "WikiLike_pageSlug_fkey";
ALTER TABLE "WikiDislike" DROP CONSTRAINT IF EXISTS "WikiDislike_pageSlug_fkey";

UPDATE "WikiPage" AS page
SET "slug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE page."slug" = slug_map.old_slug;

UPDATE "WikiRevision" AS revision
SET
  "pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug,
  "slug" = CASE
    WHEN revision."slug" IS NULL THEN NULL
    WHEN revision."slug" = slug_map.old_slug THEN '__numeric_slug_migration__' || slug_map.new_slug
    ELSE revision."slug"
  END
FROM "_WikiSlugMap" AS slug_map
WHERE revision."pageSlug" = slug_map.old_slug;

UPDATE "WikiRevision" AS revision
SET "slug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE revision."slug" = slug_map.old_slug;

UPDATE "WikiBranch" AS branch
SET "pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE branch."pageSlug" = slug_map.old_slug;

UPDATE "WikiPullRequest" AS pr
SET "pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE pr."pageSlug" = slug_map.old_slug;

UPDATE "WikiLike" AS item
SET "pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE item."pageSlug" = slug_map.old_slug;

UPDATE "WikiDislike" AS item
SET "pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE item."pageSlug" = slug_map.old_slug;

UPDATE "Favorite" AS favorite
SET "targetId" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE favorite."targetType" = 'wiki'
  AND favorite."targetId" = slug_map.old_slug;

UPDATE "BrowsingHistory" AS history
SET "targetId" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE history."targetType" = 'wiki'
  AND history."targetId" = slug_map.old_slug;

UPDATE "ModerationLog" AS log
SET "targetId" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE log."targetType" = 'wiki'
  AND log."targetId" = slug_map.old_slug;

UPDATE "WikiImageEmbedding" AS embedding
SET "wikiPageSlug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE embedding."wikiPageSlug" = slug_map.old_slug;

UPDATE "TextEmbeddingChunk" AS chunk
SET "sourceId" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE chunk."sourceType" = 'wiki'
  AND chunk."sourceId" = slug_map.old_slug;

UPDATE "Notification" AS notification
SET "payload" = jsonb_set(notification."payload", '{targetSlug}', to_jsonb(slug_map.new_slug), true)
FROM "_WikiSlugMap" AS slug_map
WHERE notification."payload"->>'targetType' = 'wiki'
  AND (
    (
      NOT (notification."payload" ? 'targetSlug')
      AND notification."payload"->>'targetId' = slug_map.old_slug
    )
    OR notification."payload"->>'targetSlug' = slug_map.old_slug
  );

UPDATE "Notification" AS notification
SET "payload" = jsonb_set(notification."payload", '{targetSlug}', to_jsonb(post."slug"), true)
FROM "Post" AS post
WHERE notification."payload"->>'targetType' = 'post'
  AND notification."payload"->>'targetId' = post."id"
  AND (
    NOT (notification."payload" ? 'targetSlug')
    OR notification."payload"->>'targetSlug' = post."id"
  );

UPDATE "Notification" AS notification
SET "payload" = jsonb_set(notification."payload", '{targetSlug}', to_jsonb(gallery."slug"), true)
FROM "Gallery" AS gallery
WHERE notification."payload"->>'targetType' = 'gallery'
  AND notification."payload"->>'targetId' = gallery."id"
  AND (
    NOT (notification."payload" ? 'targetSlug')
    OR notification."payload"->>'targetSlug' = gallery."id"
  );

UPDATE "Notification" AS notification
SET "payload" = jsonb_set(notification."payload", '{postSlug}', to_jsonb(post."slug"), true)
FROM "Post" AS post
WHERE notification."payload"->>'postId' = post."id"
  AND (
    NOT (notification."payload" ? 'postSlug')
    OR notification."payload"->>'postSlug' = post."id"
  );

UPDATE "Notification" AS notification
SET "payload" = jsonb_set(notification."payload", '{gallerySlug}', to_jsonb(gallery."slug"), true)
FROM "Gallery" AS gallery
WHERE notification."payload"->>'galleryId' = gallery."id"
  AND (
    NOT (notification."payload" ? 'gallerySlug')
    OR notification."payload"->>'gallerySlug' = gallery."id"
  );

UPDATE "WikiPage" AS page
SET "relations" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN relation ? 'targetSlug' THEN
        jsonb_set(
          relation,
          '{targetSlug}',
          to_jsonb(COALESCE(slug_map.new_slug, relation->>'targetSlug'))
        )
      ELSE relation
    END
    ORDER BY ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(page."relations"::jsonb, '[]'::jsonb)) WITH ORDINALITY AS item(relation, ordinality)
  LEFT JOIN "_WikiSlugMap" AS slug_map ON slug_map.old_slug = relation->>'targetSlug'
)
WHERE jsonb_typeof(COALESCE(page."relations"::jsonb, '[]'::jsonb)) = 'array';

UPDATE "WikiRevision" AS revision
SET "relations" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN relation ? 'targetSlug' THEN
        jsonb_set(
          relation,
          '{targetSlug}',
          to_jsonb(COALESCE(slug_map.new_slug, relation->>'targetSlug'))
        )
      ELSE relation
    END
    ORDER BY ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(revision."relations"::jsonb, '[]'::jsonb)) WITH ORDINALITY AS item(relation, ordinality)
  LEFT JOIN "_WikiSlugMap" AS slug_map ON slug_map.old_slug = relation->>'targetSlug'
)
WHERE jsonb_typeof(COALESCE(revision."relations"::jsonb, '[]'::jsonb)) = 'array';

UPDATE "Event" AS event
SET "slug" = '__numeric_slug_migration__' || slug_map.new_slug
FROM "_EventSlugMap" AS slug_map
WHERE event."slug" = slug_map.old_slug;

UPDATE "WikiPage" AS page
SET "slug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE page."slug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiRevision" AS revision
SET
  "pageSlug" = slug_map.new_slug,
  "slug" = CASE
    WHEN revision."slug" = '__numeric_slug_migration__' || slug_map.new_slug THEN slug_map.new_slug
    ELSE revision."slug"
  END
FROM "_WikiSlugMap" AS slug_map
WHERE revision."pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiRevision" AS revision
SET "slug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE revision."slug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiBranch" AS branch
SET "pageSlug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE branch."pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiPullRequest" AS pr
SET "pageSlug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE pr."pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiLike" AS item
SET "pageSlug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE item."pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "WikiDislike" AS item
SET "pageSlug" = slug_map.new_slug
FROM "_WikiSlugMap" AS slug_map
WHERE item."pageSlug" = '__numeric_slug_migration__' || slug_map.new_slug;

UPDATE "Event" AS event
SET "slug" = slug_map.new_slug
FROM "_EventSlugMap" AS slug_map
WHERE event."slug" = '__numeric_slug_migration__' || slug_map.new_slug;

ALTER TABLE "Post" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Gallery" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "MusicTrack" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Album" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");
CREATE UNIQUE INDEX "Gallery_slug_key" ON "Gallery"("slug");
CREATE UNIQUE INDEX "MusicTrack_slug_key" ON "MusicTrack"("slug");
CREATE UNIQUE INDEX "Album_slug_key" ON "Album"("slug");

ALTER TABLE "WikiRevision"
  ADD CONSTRAINT "WikiRevision_pageSlug_fkey"
  FOREIGN KEY ("pageSlug") REFERENCES "WikiPage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiBranch"
  ADD CONSTRAINT "WikiBranch_pageSlug_fkey"
  FOREIGN KEY ("pageSlug") REFERENCES "WikiPage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiPullRequest"
  ADD CONSTRAINT "WikiPullRequest_pageSlug_fkey"
  FOREIGN KEY ("pageSlug") REFERENCES "WikiPage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiLike"
  ADD CONSTRAINT "WikiLike_pageSlug_fkey"
  FOREIGN KEY ("pageSlug") REFERENCES "WikiPage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiDislike"
  ADD CONSTRAINT "WikiDislike_pageSlug_fkey"
  FOREIGN KEY ("pageSlug") REFERENCES "WikiPage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
