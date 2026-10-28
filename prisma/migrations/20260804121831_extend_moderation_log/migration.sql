-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAction" ADD VALUE 'restore';
ALTER TYPE "ModerationAction" ADD VALUE 'permanentDelete';
ALTER TYPE "ModerationAction" ADD VALUE 'update';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationTargetType" ADD VALUE 'music';
ALTER TYPE "ModerationTargetType" ADD VALUE 'album';
ALTER TYPE "ModerationTargetType" ADD VALUE 'event';
ALTER TYPE "ModerationTargetType" ADD VALUE 'announcement';
ALTER TYPE "ModerationTargetType" ADD VALUE 'section';
ALTER TYPE "ModerationTargetType" ADD VALUE 'imageMap';
ALTER TYPE "ModerationTargetType" ADD VALUE 'wikiCategory';
ALTER TYPE "ModerationTargetType" ADD VALUE 'config';
ALTER TYPE "ModerationTargetType" ADD VALUE 'user';
