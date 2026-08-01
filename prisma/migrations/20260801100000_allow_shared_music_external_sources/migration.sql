-- 允许同一个平台来源 id 被多首歌/专辑引用。
-- 唯一约束降级为普通索引；写接口改为检测重复并返回提醒，不再拒绝。

DROP INDEX "MusicExternalSource_resourceType_platform_sourceId_key";

CREATE INDEX "MusicExternalSource_resourceType_platform_sourceId_idx"
    ON "MusicExternalSource"("resourceType", "platform", "sourceId");
