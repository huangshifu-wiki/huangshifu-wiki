BEGIN;

LOCK TABLE "BrowsingHistory" IN SHARE ROW EXCLUSIVE MODE;

-- 同一目标保留最近一次访问，时间相同时按 ID 确定保留行。
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userUid", "targetType", "targetId"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "BrowsingHistory"
)
DELETE FROM "BrowsingHistory" AS history
USING ranked
WHERE history."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "BrowsingHistory_userUid_targetType_targetId_key"
ON "BrowsingHistory"("userUid", "targetType", "targetId");

COMMIT;
