-- CreateIndex
CREATE INDEX IF NOT EXISTS "Gallery_published_createdAt_idx" ON "Gallery" ("published", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WikiPage_category_status_updatedAt_idx" ON "WikiPage" ("category", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_section_status_hotScore_idx" ON "Post" ("section", "status", "hotScore" DESC);
