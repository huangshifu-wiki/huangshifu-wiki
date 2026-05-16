-- NOTE: This migration uses CREATE INDEX CONCURRENTLY which cannot run inside a transaction.
-- Prisma migrations run inside transactions by default.
-- Apply this migration manually during low-traffic periods:
--   1. prisma migrate resolve --rolled-back 20260514000000_add_search_indexes
--   2. Run the SQL statements below directly against the database using psql or another client
--   3. prisma migrate resolve --applied 20260514000000_add_search_indexes

-- Enable pg_trgm extension for trigram similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Add GIN indexes for trigram search on WikiPage
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WikiPage_title_trgm_idx" ON "WikiPage" USING GIN ("title" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WikiPage_slug_trgm_idx" ON "WikiPage" USING GIN ("slug" gin_trgm_ops);

-- Add GIN index for Post title search
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_title_trgm_idx" ON "Post" USING GIN ("title" gin_trgm_ops);

-- Add B-tree indexes for common search patterns
CREATE INDEX IF NOT EXISTS "WikiPage_status_updatedAt_idx" ON "WikiPage" ("status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "Post_status_createdAt_idx" ON "Post" ("status", "createdAt" DESC);
