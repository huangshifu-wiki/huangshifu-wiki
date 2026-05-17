-- Enable pg_trgm extension for trigram similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Add GIN indexes for trigram search on WikiPage
CREATE INDEX IF NOT EXISTS "WikiPage_title_trgm_idx" ON "WikiPage" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WikiPage_slug_trgm_idx" ON "WikiPage" USING GIN ("slug" gin_trgm_ops);

-- Add GIN index for Post title search
CREATE INDEX IF NOT EXISTS "Post_title_trgm_idx" ON "Post" USING GIN ("title" gin_trgm_ops);

-- Add B-tree indexes for common search patterns
CREATE INDEX IF NOT EXISTS "WikiPage_status_updatedAt_idx" ON "WikiPage" ("status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "Post_status_createdAt_idx" ON "Post" ("status", "createdAt" DESC);
