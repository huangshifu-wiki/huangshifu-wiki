CREATE TYPE "TicketListingType" AS ENUM ('offer', 'request');

CREATE TABLE "TicketListing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "TicketListingType" NOT NULL,
    "eventId" TEXT,
    "customEventName" TEXT,
    "quantity" INTEGER NOT NULL,
    "ticketTier" TEXT NOT NULL,
    "seat" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL,
    "authorUid" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketListing_slug_key" ON "TicketListing"("slug");
CREATE INDEX "TicketListing_status_updatedAt_idx" ON "TicketListing"("status", "updatedAt");
CREATE INDEX "TicketListing_authorUid_updatedAt_idx" ON "TicketListing"("authorUid", "updatedAt");
CREATE INDEX "TicketListing_eventId_status_createdAt_idx" ON "TicketListing"("eventId", "status", "createdAt");
CREATE INDEX "TicketListing_deletedAt_idx" ON "TicketListing"("deletedAt");

ALTER TABLE "TicketListing" ADD CONSTRAINT "TicketListing_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketListing" ADD CONSTRAINT "TicketListing_authorUid_fkey" FOREIGN KEY ("authorUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "ModerationTargetType" ADD VALUE 'ticketListing';
