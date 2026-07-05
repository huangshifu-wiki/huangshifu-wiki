DELETE FROM "WikiCategory"
WHERE "id" = 'event'
  AND "name" = '活动记录'
  AND "description" = '活动与演出相关百科页面'
  AND "order" = 50
  AND "requiresAdminEdit" = false
  AND "deletedAt" IS NULL
  AND "deletedBy" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "WikiPage"
    WHERE "category" = 'event'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "User"
  );
