-- CreateEnum
CREATE TYPE "MusicPlayableOverride" AS ENUM ('auto', 'enabled', 'disabled');

-- AlterTable
ALTER TABLE "MusicTrack" ADD COLUMN     "playableOverride" "MusicPlayableOverride" NOT NULL DEFAULT 'auto';
