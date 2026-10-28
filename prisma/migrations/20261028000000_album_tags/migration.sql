ALTER TABLE "Album" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "album_tags_gin" ON "Album" USING GIN ("tags");
