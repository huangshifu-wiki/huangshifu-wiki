ALTER TABLE "MusicTrack"
  ADD COLUMN IF NOT EXISTS "artists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "lyricists" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "composers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "arrangers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "vocals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "releaseDate" DATE,
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'MusicTrack'
      AND column_name = 'artist'
  ) THEN
    EXECUTE '
      UPDATE "MusicTrack"
      SET "artists" = ARRAY["artist"]
      WHERE cardinality("artists") = 0
        AND NULLIF(btrim("artist"), '''') IS NOT NULL
    ';
  END IF;
END $$;

ALTER TABLE "MusicTrack"
  DROP COLUMN IF EXISTS "artist";

ALTER TABLE "Album"
  ADD COLUMN IF NOT EXISTS "releaseDate" DATE;
