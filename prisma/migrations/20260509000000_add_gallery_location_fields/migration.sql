-- CreateMigration: 20260509000000_add_missing_location_fields
-- Description: Add missing location fields and other columns to Post, WikiPage, and Gallery tables
-- This migration fixes the error: "The column Gallery.locationDetail does not exist"
-- Generated: 2026-05-09
-- Updated: Use safe column addition with existence checks (handles pre-existing columns)

-- ============================================================================
-- Helper function: Safely add column if it doesn't exist
-- ============================================================================

DO $$
BEGIN
    -- ============================================================================
    -- 1. POST TABLE - Add missing columns (with safety checks)
    -- ============================================================================
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'musicDocId'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "musicDocId" TEXT;
        RAISE NOTICE 'Added column Post.musicDocId';
    ELSE
        RAISE NOTICE 'Column Post.musicDocId already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'albumDocId'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "albumDocId" TEXT;
        RAISE NOTICE 'Added column Post.albumDocId';
    ELSE
        RAISE NOTICE 'Column Post.albumDocId already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'locationCode'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "locationCode" TEXT;
        RAISE NOTICE 'Added column Post.locationCode';
    ELSE
        RAISE NOTICE 'Column Post.locationCode already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'locationDetail'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "locationDetail" TEXT;
        RAISE NOTICE 'Added column Post.locationDetail';
    ELSE
        RAISE NOTICE 'Column Post.locationDetail already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'isPinned'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Added column Post.isPinned';
    ELSE
        RAISE NOTICE 'Column Post.isPinned already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'dislikesCount'
    ) THEN
        ALTER TABLE "Post" ADD COLUMN "dislikesCount" INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column Post.dislikesCount';
    ELSE
        RAISE NOTICE 'Column Post.dislikesCount already exists, skipping';
    END IF;

    -- ============================================================================
    -- 2. POSTCOMMENT TABLE - Add galleryId for threaded comments
    -- ============================================================================
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'PostComment' AND column_name = 'galleryId'
    ) THEN
        ALTER TABLE "PostComment" ADD COLUMN "galleryId" TEXT;
        RAISE NOTICE 'Added column PostComment.galleryId';
    ELSE
        RAISE NOTICE 'Column PostComment.galleryId already exists, skipping';
    END IF;

    -- ============================================================================
    -- 3. WIKIPAGE TABLE - Add missing columns (with safety checks)
    -- ============================================================================
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'titleKey'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "titleKey" TEXT NOT NULL DEFAULT '';
        RAISE NOTICE 'Added column WikiPage.titleKey';
    ELSE
        RAISE NOTICE 'Column WikiPage.titleKey already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'locationCode'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "locationCode" TEXT;
        RAISE NOTICE 'Added column WikiPage.locationCode';
    ELSE
        RAISE NOTICE 'Column WikiPage.locationCode already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'locationDetail'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "locationDetail" TEXT;
        RAISE NOTICE 'Added column WikiPage.locationDetail';
    ELSE
        RAISE NOTICE 'Column WikiPage.locationDetail already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'isPinned'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Added column WikiPage.isPinned';
    ELSE
        RAISE NOTICE 'Column WikiPage.isPinned already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'likesCount'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "likesCount" INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column WikiPage.likesCount';
    ELSE
        RAISE NOTICE 'Column WikiPage.likesCount already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'dislikesCount'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "dislikesCount" INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column WikiPage.dislikesCount';
    ELSE
        RAISE NOTICE 'Column WikiPage.dislikesCount already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WikiPage' AND column_name = 'favoritesCount'
    ) THEN
        ALTER TABLE "WikiPage" ADD COLUMN "favoritesCount" INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column WikiPage.favoritesCount';
    ELSE
        RAISE NOTICE 'Column WikiPage.favoritesCount already exists, skipping';
    END IF;

    -- ============================================================================
    -- 4. GALLERY TABLE - Add missing columns (with safety checks)
    -- ============================================================================
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Gallery' AND column_name = 'copyright'
    ) THEN
        ALTER TABLE "Gallery" ADD COLUMN "copyright" TEXT;
        RAISE NOTICE 'Added column Gallery.copyright';
    ELSE
        RAISE NOTICE 'Column Gallery.copyright already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Gallery' AND column_name = 'published'
    ) THEN
        ALTER TABLE "Gallery" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Added column Gallery.published';
    ELSE
        RAISE NOTICE 'Column Gallery.published already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Gallery' AND column_name = 'publishedAt'
    ) THEN
        ALTER TABLE "Gallery" ADD COLUMN "publishedAt" TIMESTAMP(3);
        RAISE NOTICE 'Added column Gallery.publishedAt';
    ELSE
        RAISE NOTICE 'Column Gallery.publishedAt already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Gallery' AND column_name = 'locationCode'
    ) THEN
        ALTER TABLE "Gallery" ADD COLUMN "locationCode" TEXT;
        RAISE NOTICE 'Added column Gallery.locationCode';
    ELSE
        RAISE NOTICE 'Column Gallery.locationCode already exists, skipping';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Gallery' AND column_name = 'locationDetail'
    ) THEN
        ALTER TABLE "Gallery" ADD COLUMN "locationDetail" TEXT;
        RAISE NOTICE 'Added column Gallery.locationDetail';
    ELSE
        RAISE NOTICE 'Column Gallery.locationDetail already exists, skipping';
    END IF;

END $$;

-- ============================================================================
-- Create indexes (IF NOT EXISTS is safe for indexes)
-- ============================================================================

-- Post table indexes
CREATE INDEX IF NOT EXISTS "Post_musicDocId_idx" ON "Post"("musicDocId");
CREATE INDEX IF NOT EXISTS "Post_albumDocId_idx" ON "Post"("albumDocId");
CREATE INDEX IF NOT EXISTS "Post_locationCode_idx" ON "Post"("locationCode");
CREATE INDEX IF NOT EXISTS "Post_isPinned_idx" ON "Post"("isPinned");

-- PostComment index
CREATE INDEX IF NOT EXISTS "PostComment_galleryId_idx" ON "PostComment"("galleryId");

-- WikiPage indexes
CREATE UNIQUE INDEX IF NOT EXISTS "WikiPage_titleKey_key" ON "WikiPage"("titleKey");
CREATE INDEX IF NOT EXISTS "WikiPage_locationCode_idx" ON "WikiPage"("locationCode");
CREATE INDEX IF NOT EXISTS "WikiPage_isPinned_idx" ON "WikiPage"("isPinned");

-- Gallery indexes
CREATE INDEX IF NOT EXISTS "Gallery_published_idx" ON "Gallery"("published", "updatedAt");
CREATE INDEX IF NOT EXISTS "Gallery_authorUid_idx" ON "Gallery"("authorUid");
CREATE INDEX IF NOT EXISTS "Gallery_locationCode_idx" ON "Gallery"("locationCode");

-- ============================================================================
-- Add foreign key constraints (with existence checks)
-- ============================================================================

DO $$
BEGIN
    -- Post -> MusicTrack
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Post_musicDocId_fkey'
    ) THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_musicDocId_fkey"
            FOREIGN KEY ("musicDocId") REFERENCES "MusicTrack"("docId")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint Post_musicDocId_fkey';
    ELSE
        RAISE NOTICE 'Constraint Post_musicDocId_fkey already exists, skipping';
    END IF;

    -- Post -> Album
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Post_albumDocId_fkey'
    ) THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_albumDocId_fkey"
            FOREIGN KEY ("albumDocId") REFERENCES "Album"("docId")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint Post_albumDocId_fkey';
    ELSE
        RAISE NOTICE 'Constraint Post_albumDocId_fkey already exists, skipping';
    END IF;

    -- Post -> Region (only if Region table exists - it may be created by seed)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'Region'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Post_locationCode_fkey'
    ) THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_locationCode_fkey"
            FOREIGN KEY ("locationCode") REFERENCES "Region"("code")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint Post_locationCode_fkey';
    ELSE
        RAISE NOTICE 'Skipped constraint Post_locationCode_fkey (Region table or constraint already exists)';
    END IF;

    -- PostComment -> Gallery
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PostComment_galleryId_fkey'
    ) THEN
        ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_galleryId_fkey"
            FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint PostComment_galleryId_fkey';
    ELSE
        RAISE NOTICE 'Constraint PostComment_galleryId_fkey already exists, skipping';
    END IF;

    -- WikiPage -> Region (only if Region table exists - it may be created by seed)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'Region'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WikiPage_locationCode_fkey'
    ) THEN
        ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_locationCode_fkey"
            FOREIGN KEY ("locationCode") REFERENCES "Region"("code")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint WikiPage_locationCode_fkey';
    ELSE
        RAISE NOTICE 'Skipped constraint WikiPage_locationCode_fkey (Region table or constraint already exists)';
    END IF;

    -- Gallery -> Region (only if Region table exists - it may be created by seed)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'Region'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Gallery_locationCode_fkey'
    ) THEN
        ALTER TABLE "Gallery" ADD CONSTRAINT "Gallery_locationCode_fkey"
            FOREIGN KEY ("locationCode") REFERENCES "Region"("code")
            ON DELETE SET NULL ON UPDATE CASCADE;
        RAISE NOTICE 'Added constraint Gallery_locationCode_fkey';
    ELSE
        RAISE NOTICE 'Skipped constraint Gallery_locationCode_fkey (Region table or constraint already exists)';
    END IF;

END $$;
