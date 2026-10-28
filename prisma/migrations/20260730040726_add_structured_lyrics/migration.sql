-- CreateEnum
CREATE TYPE "LyricType" AS ENUM ('plain', 'line', 'word');

-- AlterTable
ALTER TABLE "MusicTrack" ADD COLUMN     "lyricPlain" TEXT,
ADD COLUMN     "lyricSource" "MusicPlatform",
ADD COLUMN     "lyricType" "LyricType";
