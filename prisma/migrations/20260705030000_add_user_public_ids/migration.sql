ALTER TABLE "User" ADD COLUMN "publicId" TEXT;

WITH numbered AS (
  SELECT "uid", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "uid" ASC)::TEXT AS next_public_id
  FROM "User"
)
UPDATE "User" AS target
SET "publicId" = numbered.next_public_id
FROM numbered
WHERE target."uid" = numbered."uid";

ALTER TABLE "User" ALTER COLUMN "publicId" SET NOT NULL;

CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

CREATE SEQUENCE IF NOT EXISTS "User_publicId_seq";

SELECT setval(
  '"User_publicId_seq"',
  COALESCE(
    (SELECT MAX("publicId"::bigint) FROM "User" WHERE "publicId" ~ '^[0-9]+$'),
    0
  ) + 1,
  false
);
