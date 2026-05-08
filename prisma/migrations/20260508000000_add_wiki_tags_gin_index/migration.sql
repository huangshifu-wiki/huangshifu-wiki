-- CreateIndex

CREATE INDEX IF NOT EXISTS "wiki_tags_gin" ON "WikiPage" USING GIN ("tags");
