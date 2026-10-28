ALTER TABLE "Event" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "Event_tags_gin" ON "Event" USING GIN ("tags");
