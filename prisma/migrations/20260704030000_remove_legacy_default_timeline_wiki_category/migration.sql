DELETE FROM "WikiCategory"
WHERE "id" = 'timeline'
  AND "name" = '时间轴'
  AND "description" = '时间线与节点相关百科页面'
  AND "order" = 40
  AND "requiresAdminEdit" = false
  AND "deletedAt" IS NULL
  AND "deletedBy" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "WikiPage"
    WHERE "category" = 'timeline'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "User"
  );
