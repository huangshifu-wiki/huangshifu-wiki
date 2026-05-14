DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorageType') THEN
    CREATE TYPE "StorageType" AS ENUM ('local', 's3', 'external');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VariantStatus') THEN
    CREATE TYPE "VariantStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CloudSyncStatus') THEN
    CREATE TYPE "CloudSyncStatus" AS ENUM ('pending', 'syncing', 'completed', 'skipped', 'failed');
  END IF;
END
$$;

ALTER TABLE "ImageMap"
  ADD COLUMN IF NOT EXISTS "externalUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "s3Url" TEXT,
  ADD COLUMN IF NOT EXISTS "storageType" "StorageType" NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS "blurhash" TEXT,
  ADD COLUMN IF NOT EXISTS "thumbhash" TEXT,
  ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "mediumUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "largeUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "variantStatus" "VariantStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "cloudSyncStatus" "CloudSyncStatus" NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ImageMap'
      AND column_name = 'superbedUrl'
  ) THEN
    EXECUTE '
      UPDATE "ImageMap"
      SET "externalUrl" = COALESCE("externalUrl", "superbedUrl")
      WHERE "externalUrl" IS NULL
        AND "superbedUrl" IS NOT NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ImageMap'
      AND column_name = 'smmsUrl'
  ) THEN
    EXECUTE '
      UPDATE "ImageMap"
      SET "externalUrl" = COALESCE("externalUrl", "smmsUrl")
      WHERE "externalUrl" IS NULL
        AND "smmsUrl" IS NOT NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ImageMap'
      AND column_name = 'weiboUrl'
  ) THEN
    EXECUTE '
      UPDATE "ImageMap"
      SET "externalUrl" = COALESCE("externalUrl", "weiboUrl")
      WHERE "externalUrl" IS NULL
        AND "weiboUrl" IS NOT NULL
    ';
  END IF;
END
$$;

UPDATE "ImageMap"
SET "storageType" = CASE
  WHEN "s3Url" IS NOT NULL THEN 's3'::"StorageType"
  WHEN "externalUrl" IS NOT NULL THEN 'external'::"StorageType"
  ELSE 'local'::"StorageType"
END;

ALTER TABLE "ImageMap"
  DROP COLUMN IF EXISTS "weiboUrl",
  DROP COLUMN IF EXISTS "smmsUrl",
  DROP COLUMN IF EXISTS "superbedUrl";
