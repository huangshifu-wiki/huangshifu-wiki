CREATE TABLE "WikiCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "order" INTEGER NOT NULL DEFAULT 0,
  "requiresAdminEdit" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WikiCategory_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WikiCategory" ("id", "name", "description", "order", "requiresAdminEdit")
VALUES
  ('biography', '人物介绍', '人物相关百科页面', 10, false),
  ('music', '音乐作品', '音乐作品相关百科页面', 20, true),
  ('album', '专辑一览', '专辑相关百科页面', 30, false),
  ('timeline', '时间轴', '时间线与节点相关百科页面', 40, false),
  ('event', '活动记录', '活动与演出相关百科页面', 50, false)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "order" = EXCLUDED."order",
  "requiresAdminEdit" = EXCLUDED."requiresAdminEdit";

INSERT INTO "WikiCategory" ("id", "name", "description", "order", "requiresAdminEdit")
SELECT DISTINCT page."category", page."category", '', 1000, false
FROM "WikiPage" page
WHERE page."category" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "WikiCategory" category WHERE category."id" = page."category"
  );

CREATE INDEX "WikiCategory_order_createdAt_idx" ON "WikiCategory"("order", "createdAt");
CREATE INDEX "WikiCategory_deletedAt_idx" ON "WikiCategory"("deletedAt");

ALTER TABLE "WikiPage"
  ADD CONSTRAINT "WikiPage_category_fkey"
  FOREIGN KEY ("category") REFERENCES "WikiCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
