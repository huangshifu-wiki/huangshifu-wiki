-- AlterTable
ALTER TABLE "MusicTrack" ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "music_tags_gin" ON "MusicTrack" USING GIN ("tags");
