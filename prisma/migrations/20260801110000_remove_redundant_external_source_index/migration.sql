-- (resourceType, platform, sourceId) 索引与既有 (platform, sourceId) 索引前缀冗余：
-- 所有重复检测/导入查询都以 platform + sourceId 等值过滤，resourceType 只是二值枚举，
-- 既有索引已足够支撑，删除本次新增的冗余索引。

DROP INDEX "MusicExternalSource_resourceType_platform_sourceId_idx";
