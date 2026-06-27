# 功能开发规划文档

基于 `migration-gap.md` 分析，结合当前项目现状，整理待开发功能规划。

## 一、开篇声明

本文档目标读者为开发团队。文档结构遵循从底层基础设施到上层业务模块的顺序，便于分阶段实施。

## 二、当前项目现状确认

经过代码审查，以下功能**尚未实现**或**实现不完整**：

| 优先级 | 功能 | 现状 |
|--------|------|------|
| P0 | 编辑锁机制 | ❌ 完全缺失 |
| P0 | 全局上传任务队列 | ⚠️ 只有基础 UploadSession，无任务治理 |
| P0 | 歌曲多封面 | ❌ MusicTrack.cover 为单一字段 |
| P0 | 专辑多封面 | ❌ Album.cover 为单一字段 |
| P0 | 歌曲-专辑关系拆分（展示/关联） | ❌ 未实现 |
| P1 | 图集发布流 + 编辑已有图集 | ⚠️ 只能创建，不能编辑 |
| P1 | 批量操作 API | ❌ 只有单条 CRUD |
| P1 | 多 Disc 专辑支持 | ❌ 未实现 |
| P1 | 伴奏双向关联 | ❌ 未实现 |
| P1 | 全局搜索扩展（音乐/活动/杂记） | ⚠️ 只覆盖 wiki/posts/galleries |
| P2 | 活动模块 | ❌ 未实现 |
| P2 | 杂记模块 | ❌ 未实现 |
| P2 | 站点人物介绍 CMS | ⚠️ 现有 /profile 是用户中心，非艺人介绍 |
| P2 | 多平台音乐播放后端 | ❌ 直接存 audioUrl，非运行时解析 |

## 三、开发阶段划分

### 阶段一：基础设施（P0）

#### 1. 编辑锁机制

**功能描述**
- 记录级并发编辑保护，防止多人同时编辑同一记录
- 进入编辑页时申请锁，离开页面时释放锁
- 支持编辑冲突提示、强制接管、后台统一查看和删除锁

**涉及数据模型**
```prisma
model EditLock {
  id          String   @id @default(cuid())
  collection  String   // e.g., "songs", "albums"
  recordId    String   // The record's primary key
  userId      String
  username    String
  createdAt   DateTime @default(now())
  expiresAt   DateTime // 防止锁僵死

  @@unique([collection, recordId])
  @@index([userId])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 EditLock 模型
- `server.ts` - 新增编辑锁 API：
  - `POST /api/admin/locks` - 申请锁
  - `DELETE /api/admin/locks/:id` - 释放锁
  - `GET /api/admin/locks` - 查看所有锁（后台）
  - `DELETE /api/admin/locks/:collection/:recordId` - 强制删除锁
- `src/contexts/EditLockContext.tsx` - 前端锁状态管理
- `src/hooks/useEditLock.ts` - 编辑锁 hook

**兼容性考虑**
- 编辑锁是富表单编辑页（歌曲、专辑、图集、活动）的前置依赖
- 建议最早实现

---

#### 2. 全局上传任务队列

**功能描述**
- 统一管理多类型资源的上传任务（song_covers、album_covers、gallery_images、activity_images）
- 支持暂停、恢复、重试、取消、并发数设置
- 离开后台时拦截、上传任务与编辑锁交接
- 取消任务后自动清理残留记录

**涉及数据模型**
```prisma
model UploadBatch {
  id          String   @id @default(cuid())
  collection  String   // "song_covers" | "album_covers" | "gallery_images" | "activity_images"
  recordId    String?  // Associated record ID (optional for gallery-level batches)
  userId      String
  status      String   // "pending" | "uploading" | "paused" | "completed" | "cancelled"
  totalFiles  Int      @default(0)
  completedFiles Int  @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model UploadedAsset {
  id          String   @id @default(cuid())
  batchId     String
  storageKey  String   @unique
  publicUrl   String
  status      String   // "pending" | "completed" | "failed"
  createdAt   DateTime @default(now())

  @@index([batchId])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 UploadBatch、UploadedAsset 模型
- `server.ts` - 新增上传批次 API：
  - `POST /api/uploads/batches` - 创建上传批次
  - `PATCH /api/uploads/batches/:id` - 更新批次状态（暂停/恢复/取消）
  - `GET /api/uploads/batches/:id` - 获取批次详情
  - `DELETE /api/uploads/batches/:id` - 取消并清理批次
- `src/stores/uploadStore.ts` - 已有，需扩展支持 album_covers 等类型
- `src/hooks/useUploadTask.ts` - 单个上传任务 hook
- `src/components/UploadQueue/UploadQueuePanel.tsx` - 后台上传队列面板

**缺口修复**
- 原有 `uploadStore` 对 `album_covers` 类型未实现实际上传分支，需在此次一并修正

---

#### 3. 歌曲多封面与默认封面来源策略

**功能描述**
- 歌曲有独立封面集合 `song_covers`，支持一首歌对应多张封面
- `defaultCover` 可指定为空、指定某张歌曲自有封面、或指定某张专辑封面
- 详情页解析 `song_cover:ID` / `album_cover:ID` 并正确取图

**涉及数据模型**
```prisma
model SongCover {
  id          String   @id @default(cuid())
  songId      String   // Foreign key to MusicTrack
  storageKey  String   @unique
  publicUrl   String
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([songId])
}

model MusicTrack {
  // ... existing fields ...
  defaultCoverSource String?  // "none" | "song_cover:ID" | "album_cover:ID"
  @@index([defaultCoverSource])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 SongCover 模型，MusicTrack 新增 defaultCoverSource
- `server.ts` - 新增 API：
  - `POST /api/music/:id/covers` - 上传歌曲封面
  - `DELETE /api/music/:id/covers/:coverId` - 删除歌曲封面
  - `PATCH /api/music/:id/covers/:coverId/default` - 设置默认封面
  - `PATCH /api/music/:id` - 更新时支持 defaultCoverSource
- `src/pages/AdminSongEdit.tsx` - 歌曲编辑页封面管理 UI
- `src/composables/useSongCover.ts` - 已有，需改造支持多封面
- `src/components/SongCoverPicker.tsx` - 封面选择器组件

---

#### 4. 专辑多封面与默认封面策略

**功能描述**
- 专辑有独立封面集合 `album_covers`
- `defaultCover` 支持空值、旧单封面兼容值 `old_cover`、或 `album_cover:ID`
- 歌曲可以把某张专辑封面作为自身默认封面来源
- 专辑后台可以批量删除封面，并把当前专辑封面批量同步给所选歌曲作为展示封面

**涉及数据模型**
```prisma
model AlbumCover {
  id          String   @id @default(cuid())
  albumDocId  String   // Foreign key to Playlist (album type)
  storageKey  String   @unique
  publicUrl   String
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([albumDocId])
}

model Playlist {
  // ... existing fields ...
  defaultCoverSource String?  // "none" | "old_cover" | "album_cover:ID"
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 AlbumCover 模型，Playlist 新增 defaultCoverSource
- `server.ts` - 新增 API：
  - `POST /api/albums/:docId/covers` - 上传专辑封面
  - `DELETE /api/albums/:docId/covers/:coverId` - 删除专辑封面
  - `PATCH /api/albums/:docId/covers/:coverId/default` - 设置默认封面
  - `POST /api/albums/:docId/sync-covers-to-songs` - 批量同步封面给子歌曲
- `src/pages/AdminAlbumEdit.tsx` - 专辑编辑页封面管理 UI
- `src/composables/useAlbumCover.ts` - 专辑封面 hook

---

#### 5. 歌曲-专辑关系拆分（展示专辑 / 关联专辑 / 多 Disc）

**功能描述**
- 歌曲有 `defaultAlbum` / `defaultAlbumName`，区分"真正关联的专辑"与"页面展示专辑"
- 展示专辑支持三种模式：`none` / `linked` / `manual`
- 即使站内没有该专辑，也能通过 `defaultAlbumName` 手填展示文本
- 歌曲可关联多个专辑，并在每个专辑中指定落在哪个 Disc

**涉及数据模型**
```prisma
model SongAlbumRelation {
  id          String   @id @default(cuid())
  songDocId   String
  albumDocId  String
  discNumber  Int      @default(1)
  trackOrder  Int
  isDisplay   Boolean  @default(false)  // 是否作为展示专辑
  createdAt   DateTime @default(now())

  @@unique([songDocId, albumDocId])
  @@index([albumDocId])
}

model MusicTrack {
  // ... existing fields ...
  displayAlbumMode  String?  // "none" | "linked" | "manual"
  manualAlbumName   String?  // 当 displayAlbumMode 为 manual 时使用
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 SongAlbumRelation 模型，MusicTrack 新增 displayAlbumMode/manualAlbumName
- `server.ts` - 新增 API：
  - `GET /api/music/:id/albums` - 获取歌曲关联的所有专辑
  - `POST /api/music/:id/albums` - 添加专辑关联
  - `DELETE /api/music/:id/albums/:albumDocId` - 移除专辑关联
  - `PATCH /api/music/:id/albums/:albumDocId` - 更新关联信息（disc、trackOrder、isDisplay）
- `src/pages/AdminSongEdit.tsx` - 歌曲编辑页专辑关联管理 UI
- `src/composables/useDisplayAlbum.ts` - 展示专辑逻辑 hook
- `src/composables/useLinkedAlbums.ts` - 关联专辑逻辑 hook

---

### 阶段二：内容增强（P1）

#### 6. 图集发布流与存量编辑

**功能描述**
- 图集新增 `published` 状态，支持草稿/发布切换
- 后台可以编辑已有图集，支持追加上传、删除图片、拖拽重排
- 保存时批量更新排序
- 图集编辑纳入编辑锁和上传任务治理

**涉及数据模型变更**
```prisma
model Gallery {
  // ... existing fields ...
  published   Boolean  @default(false)
  publishedAt DateTime?
}
```

**涉及文件**
- `prisma/schema.prisma` - Gallery 新增 published、publishedAt 字段
- `server.ts` - 图集 API 扩展：
  - `PATCH /api/galleries/:id` - 支持更新图集
  - `PATCH /api/galleries/:id/publish` - 发布/取消发布
  - `POST /api/galleries/:id/images` - 追加图片
  - `DELETE /api/galleries/:id/images/:imageId` - 删除图片
  - `PATCH /api/galleries/:id/images/reorder` - 批量更新排序
- `src/pages/AdminGalleryEdit.tsx` - 图集编辑页（新建 + 存量编辑）
- `src/components/AdminGalleryImageUploader.tsx` - 图片上传组件
- `src/components/AdminGalleryImageReorder.tsx` - 拖拽重排组件

---

#### 7. 批量操作 API

**功能描述**
- 图集图片批量删除、批量排序
- 活动图片批量删除、批量排序
- 歌曲封面批量删除
- 专辑封面批量删除
- 编辑锁批量删除
- 歌曲展示信息批量更新（默认展示专辑、默认封面）

**涉及文件**
- `server.ts` - 新增批量操作 API：
  - `POST /api/admin/batch/gallery-images/delete`
  - `PATCH /api/admin/batch/gallery-images/reorder`
  - `POST /api/admin/batch/song-covers/delete`
  - `POST /api/admin/batch/album-covers/delete`
  - `POST /api/admin/batch/album-covers/sync-to-songs`
  - `POST /api/admin/batch/locks/delete`
  - `PATCH /api/admin/batch/songs/display-info`
- `src/lib/batchOperations.ts` - 前端批量操作封装

---

#### 8. 多 Disc 专辑支持

**功能描述**
- 专辑不是扁平曲目列表，而是支持多 Disc
- `albums.tracks` 是带 `disc + name + songs` 的 JSON 结构
- 后台支持新增 Disc、删除 Disc、跨 Disc 拖拽曲目、归一化曲目结构
- 保存专辑时可以批量更新所选歌曲的 `defaultAlbum` / `defaultAlbumName` / `defaultCover`

**涉及数据模型**
```prisma
model Playlist {
  // ... existing fields ...
  // tracks 字段保持 JSON 结构，但需扩展支持 disc 维度
  // tracks: Array<{ disc: number, name: string, trackDocIds: string[], trackOrders: number[] }>
}
```

**涉及文件**
- `prisma/schema.prisma` - 确认 tracks JSON 结构支持 disc 维度
- `server.ts` - 新增 API：
  - `POST /api/albums/:docId/discs` - 新增 Disc
  - `DELETE /api/albums/:docId/discs/:discNumber` - 删除 Disc
  - `PATCH /api/albums/:docId/tracks/reorder` - 跨 Disc 拖拽重排
  - `POST /api/albums/:docId/sync-display-to-songs` - 批量同步展示信息
- `src/pages/AdminAlbumEdit.tsx` - Disc 管理 UI
- `src/lib/albumTracks.ts` - 曲目结构操作库

---

#### 9. 伴奏双向关联

**功能描述**
- `songs.instrumentalFor` 存储"此歌曲作为哪些歌曲的伴奏"
- 后台可以同时查看：当前歌曲有哪些伴奏 + 当前歌曲本身又作为哪些歌曲的伴奏
- 保存时会同步更新双方关系

**涉及数据模型**
```prisma
model SongInstrumentalRelation {
  id              String   @id @default(cuid())
  songDocId       String   // 伴奏歌曲
  targetSongDocId String   // 被伴奏的歌曲
  createdAt       DateTime @default(now())

  @@unique([songDocId, targetSongDocId])
  @@index([targetSongDocId])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 SongInstrumentalRelation 模型
- `server.ts` - 新增 API：
  - `GET /api/music/:id/instrumentals` - 获取当前歌曲的伴奏
  - `GET /api/music/:id/instrumental-for` - 获取当前歌曲作为伴奏的歌曲
  - `POST /api/music/:id/instrumentals` - 添加伴奏关系
  - `DELETE /api/music/:id/instrumentals/:targetSongDocId` - 移除伴奏关系
- `src/pages/AdminSongEdit.tsx` - 歌曲编辑页伴奏关联 UI
- `src/composables/useLinkedInstrumentals.ts` - 伴奏关系 hook

---

#### 10. 全局搜索扩展

**功能描述**
- 单一接口同时搜索 `songs`、`albums`、`activities`、`galleries`、`misc`
- 支持通过"专辑标题"反查其收录歌曲
- 对图集和杂记自动加上已发布限制

**涉及文件**
- `server.ts` - 扩展 `/api/search`：
  - 新增 songs、albums、activities、misc 的搜索分支
  - 新增按专辑标题反查歌曲的功能
- `src/pages/Search.tsx` - 搜索结果 UI 扩展：
  - 新增 songs、albums、activities、misc 标签页
  - 适配新的搜索结果结构
- `src/components/GlobalSearch.vue` - 统一搜索组件（如有）

---

### 阶段三：业务模块（P2）

#### 11. 活动模块

**功能描述**
- 独立 `activities` 与 `activity_images` 数据模型
- 支持时间段 `timeSlots`、起售时间 `saleStartTimes`、票档 `ticketTiers`、售票平台 `ticketPlatforms`、阵容、标签、Markdown 详情
- 活动图支持上传、排序、批量删除
- 删除活动时有服务端级联清理图片

**涉及数据模型**
```prisma
model Activity {
  id              String   @id @default(cuid())
  title           String
  subtitle        String?
  description     String  @db.LongText
  timeSlots       Json?   // Array<{ start: Date, end: Date, label?: string }>
  saleStartTimes  Json?   // Array<{ tierId: string, startTime: Date }>
  ticketTiers     Json?   // Array<{ id: string, name: string, price: number, currency: string }>
  ticketPlatforms Json?   // Array<{ platform: string, url: string }>
  lineup          Json?   // Array<{ artist: string, role?: string }>
  tags            Json?
  status          String   @default("draft") // "draft" | "published" | "cancelled"
  publishedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  images          ActivityImage[]
}

model ActivityImage {
  id          String   @id @default(cuid())
  activityId  String
  assetId     String?
  url         String   @db.Text
  name        String
  sortOrder   Int      @default(0)
  activity    Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  asset       MediaAsset? @relation("ActivityImageAsset", fields: [assetId], references: [id], onDelete: SetNull)

  @@index([activityId, sortOrder])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 Activity、ActivityImage 模型
- `server.ts` - 新增 API：
  - CRUD: `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id`
  - `PATCH /api/activities/:id/publish`
  - `POST /api/activities/:id/images` - 上传活动图
  - `DELETE /api/activities/:id/images/:imageId` - 删除活动图
  - `PATCH /api/activities/:id/images/reorder` - 批量更新排序
- `src/pages/ActivityList.tsx` - 活动列表页
- `src/pages/ActivityDetail.tsx` - 活动详情页
- `src/pages/AdminActivityEdit.tsx` - 活动编辑页（后台）
- `src/App.tsx` - 路由注册

---

#### 12. 杂记模块

**功能描述**
- 独立 `misc` 集合，支持标题、简介、Markdown 正文、发布状态、自动递增索引
- 有独立列表页、详情页、后台列表和后台编辑页

**涉及数据模型**
```prisma
model Misc {
  id          String   @id @default(cuid())
  title       String
  summary     String?  @db.Text
  content     String   @db.LongText
  status      String   @default("published") // "draft" | "published"
  displayOrder Int     @default(0)  // 自动递增，可手动调整
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status, displayOrder])
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 Misc 模型
- `server.ts` - 新增 API：
  - CRUD: `GET/POST /api/misc`, `GET/PATCH/DELETE /api/misc/:id`
  - `GET /api/misc` 支持 `?status=published` 过滤和 `?orderBy=displayOrder` 排序
- `src/pages/MiscList.tsx` - 杂记列表页
- `src/pages/MiscDetail.tsx` - 杂记详情页
- `src/pages/AdminMiscEdit.tsx` - 杂记编辑页（后台）
- `src/App.tsx` - 路由注册

---

#### 13. 站点人物介绍 CMS

**功能描述**
- 用单记录 `profile` 集合维护站点级人物介绍内容（如黄诗扶个人介绍）
- 后台有专门的"个人介绍管理"页
- 注意：与现有的 `/profile`（用户中心）不同，这是站点级艺人介绍

**涉及数据模型**
```prisma
model SiteProfile {
  id          String   @id @default(cuid())
  slug        String   @unique  // e.g., "huangshifu"
  title       String
  subtitle    String?
  content     String   @db.LongText
  coverImage  String?  @db.Text
  links       Json?    // Array<{ label: string, url: string }>
  displayOrder Int     @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**涉及文件**
- `prisma/schema.prisma` - 新增 SiteProfile 模型
- `server.ts` - 新增 API：
  - `GET /api/profiles/:slug` - 获取站点人物介绍
  - `PATCH /api/admin/profiles/:slug` - 更新介绍（需管理员权限）
- `src/pages/ArtistProfile.tsx` - 人物介绍页（如 `/artist/huangshifu`）
- `src/pages/AdminProfile.tsx` - 后台个人介绍管理页
- `src/App.tsx` - 路由注册

---

#### 14. 多平台在线播放后端

**功能描述**
- 歌曲模型里有 `qqId`、`neteaseId`、`enabledPlatform`
- 独立音乐服务根据歌曲数据库 ID 读取平台配置，再向 QQ 音乐或网易云取播放直链
- 服务端有本地缓存层，避免重复请求第三方平台

**涉及数据模型**
```prisma
model MusicTrack {
  // ... existing fields ...
  qqId           String?
  neteaseId      String?
  enabledPlatform String?  // "qq" | "netease" | "both"
}
```

**涉及文件**
- `prisma/schema.prisma` - MusicTrack 新增 qqId、neteaseId、enabledPlatform
- `server.ts` - 新增/扩展 API：
  - `GET /api/music/:id/play-url` - 运行时解析播放直链
  - `POST /api/music/from-netease` - 已有，扩展支持
  - `POST /api/music/from-qq` - 从 QQ 音乐导入
- `src/server/music/musicUrlParser.ts` - 播放链路解析服务
- `src/composables/useMusicPlayer.ts` - 播放器 hook，改造支持多平台

---

## 四、实施顺序建议

```
阶段一（基础设施）可并行开发：
├─ 1. 编辑锁机制
├─ 2. 全局上传任务队列（含 album_covers 缺口修复）
├─ 3. 歌曲多封面
├─ 4. 专辑多封面
└─ 5. 歌曲-专辑关系拆分

阶段二（内容增强）可并行开发：
├─ 6. 图集发布流与存量编辑（依赖阶段一）
├─ 7. 批量操作 API（依赖阶段一）
├─ 8. 多 Disc 专辑支持
├─ 9. 伴奏双向关联
└─ 10. 全局搜索扩展

阶段三（业务模块）可并行开发：
├─ 11. 活动模块
├─ 12. 杂记模块
├─ 13. 站点人物介绍 CMS
└─ 14. 多平台音乐播放后端
```

## 五、技术债务与注意事项

1. **album_covers 上传缺口**：原有 `uploadStore` 对 `album_covers` 类型未实现实际上传分支，需在阶段一的"全局上传任务队列"中一并修正。

2. **编辑锁是基础设施**：编辑锁将影响歌曲、专辑、图集、活动等所有富表单编辑页，建议最早实现。

3. **多封面系统一致性**：歌曲多封面和专辑多封面是两个独立但结构相似的系统，建议抽取公共封面管理逻辑。

4. **GalleryImage 与 MediaAsset 的关系**：当前 GalleryImage 直接存储 url，迁移后应考虑统一走 MediaAsset 资产管理系统。

5. **displayAlbumMode 的 backward compatibility**：当 `displayAlbumMode` 为 null 时，应有合理的默认行为（建议默认行为为 `linked`）。

## 六、文档维护

- 本文档版本：v1.0
- 创建日期：2026-03-25
- 后续更新时，请同步修改版本号和更新日期
