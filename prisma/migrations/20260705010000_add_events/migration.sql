CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timeSlots" JSONB NOT NULL DEFAULT '[]',
    "ticketPrices" JSONB NOT NULL DEFAULT '[]',
    "saleTimes" JSONB NOT NULL DEFAULT '[]',
    "lineup" JSONB NOT NULL DEFAULT '[]',
    "externalLinks" JSONB NOT NULL DEFAULT '[]',
    "sortStart" TEXT,
    "sortEnd" TEXT,
    "coverAssetId" TEXT,
    "coverUrl" TEXT,
    "coverName" TEXT,
    "createdByUid" TEXT NOT NULL,
    "updatedByUid" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventPoster" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assetId" TEXT,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventPoster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
CREATE INDEX "Event_sortStart_idx" ON "Event"("sortStart");
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");
CREATE INDEX "Event_updatedAt_idx" ON "Event"("updatedAt");
CREATE INDEX "Event_deletedAt_idx" ON "Event"("deletedAt");
CREATE INDEX "Event_coverAssetId_idx" ON "Event"("coverAssetId");
CREATE INDEX "Event_createdByUid_idx" ON "Event"("createdByUid");
CREATE INDEX "Event_slug_trgm_idx" ON "Event" USING GIN ("slug" gin_trgm_ops);
CREATE INDEX "Event_title_trgm_idx" ON "Event" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "EventPoster_eventId_sortOrder_idx" ON "EventPoster"("eventId", "sortOrder");
CREATE INDEX "EventPoster_assetId_idx" ON "EventPoster"("assetId");

ALTER TABLE "Event" ADD CONSTRAINT "Event_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdByUid_fkey" FOREIGN KEY ("createdByUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_updatedByUid_fkey" FOREIGN KEY ("updatedByUid") REFERENCES "User"("uid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventPoster" ADD CONSTRAINT "EventPoster_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPoster" ADD CONSTRAINT "EventPoster_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
