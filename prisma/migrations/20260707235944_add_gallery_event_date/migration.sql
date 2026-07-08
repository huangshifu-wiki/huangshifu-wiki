-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN     "eventDate" TEXT;

-- CreateIndex
CREATE INDEX "Gallery_eventDate_idx" ON "Gallery"("eventDate");
