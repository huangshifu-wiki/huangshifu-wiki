# 我人工写的一点说明

关于下面的第 7 点“展示专辑与关联专辑不是一回事”，这玩意是我设计的（其实大多的架构都是我设计的，只是代码以 AI 为主），讲实话我觉得挺烂的。我这主要是考虑到很多歌曲所属的专辑在站内不会真的存在，但是又需要对外展示，所以分为了“展示专辑”和“关联专辑”。其中“展示专辑”只有一个，就是在列表页面展示的那个专辑；而“关联专辑”就是真的关联的所有专辑。有点绕，我觉得如果能的话可以换一个更直观的方式。

# 当前工作区相对 `huangshifu-wiki` 的功能增量清单

## 说明

- 对比对象：
  - 当前工作区：`D:\UserData\Documents\GitHub\shifu-wiki`
  - 对照项目：`D:\File\CODE\Git\huangshifu-wiki`
- 对比范围：只看底层实现能力、数据模型、接口/服务、后台编辑工作流，不看前端视觉与页面样式。
- 本文只整理“当前工作区已实现，但 `huangshifu-wiki` 尚未实现或仅有明显简化版本”的能力，方便后续迁移。
- 不包含 `huangshifu-wiki` 独有能力（如百科/论坛/通知/语义搜图等）。

## 结论速览

当前工作区比 `huangshifu-wiki` 多出来的能力，主要集中在 6 个方向：

1. 后台并发编辑保护与上传任务治理。
2. 歌曲/专辑更细的封面体系与展示策略。
3. 歌曲与专辑之间更复杂的关系建模。
4. 图集的发布流与存量内容编辑能力。
5. 活动、杂记、站点人物介绍等 CMS 模块。
6. 面向当前站点内容结构的全局搜索与多平台音乐播放后端。

## 建议优先迁移的功能

| 优先级 | 功能                                               |
| :----- | :------------------------------------------------- |
| P0     | 编辑锁机制                                         |
| P0     | 全局上传任务队列 + 上传批次取消清理                |
| P0     | 歌曲多封面 + 默认封面来源策略                      |
| P0     | 专辑多封面 + 专辑/歌曲展示封面联动                 |
| P0     | 歌曲-专辑关系拆分（展示专辑 / 关联专辑 / 多 Disc） |
| P1     | 图集发布流 + 图集编辑/重排                         |
| P1     | 活动模块                                           |
| P1     | 批量操作 API                                       |
| P1     | 伴奏双向关联                                       |
| P1     | 当前站点内容结构的全局搜索                         |
| P2     | 杂记模块                                           |
| P2     | 站点人物介绍 CMS                                   |

## 详细差异

### 1. 编辑锁机制（记录级并发编辑保护）

`shifu-wiki` 已实现一套完整的记录级编辑锁机制，而 `huangshifu-wiki` 中未发现对应模型、接口或前端协作逻辑。

- 当前工作区能力
  - 使用 `edit_locks` 集合记录 `collection + recordId + userId + username`，在进入编辑页时申请锁，离开页面时释放锁。
  - 编辑冲突时支持提示、强制接管、后台统一查看和删除锁。
  - 编辑页同时有基于 `updated` 的版本冲突检测，不只防“同时打开”，也防“别人已先保存”。
- 对照项目现状
  - `prisma/schema.prisma` 中没有编辑锁相关模型。
  - 全仓库未找到 `editLock`、`lockId`、`VersionConflict` 一类实现。
- 迁移价值
  - 这是后台多人协作时最关键的基础设施，尤其会影响歌曲、专辑、图集、活动等富表单编辑页。
- 关键参考
  - 当前：`PocketBaseSchema.md:219`
  - 当前：`src/lib/editLock.ts:44`
  - 当前：`src/composables/useEditLock.ts:62`
  - 当前：`src/views/admin/AdminLocks.vue:154`
  - 对照：`prisma/schema.prisma:82`

### 2. 全局上传任务队列与上传批次取消清理

`shifu-wiki` 的上传不是“选文件立刻传完就结束”，而是有跨资源统一调度的后台任务系统；`huangshifu-wiki` 只有图库图片上传会话，没有同等级的全局任务治理。

- 当前工作区能力
  - 统一管理 `gallery_images`、`song_covers`、`album_covers`、`activity_images` 的批量上传任务。
  - 支持暂停、恢复、重试、取消、并发数设置、离开后台拦截、上传任务与编辑锁交接。
  - 通过 `upload_batches` 和 PocketBase hooks，在取消任务后自动清理残留记录，避免产生脏图。
- 对照项目现状
  - 只实现了 `UploadSession` / `MediaAsset` 这套上传会话，主要服务于图库上传。
  - 支持创建会话、上传文件、finalize 会话，但没有统一的后台任务队列，也没有“已进入资源编辑流程后的取消清理”机制。
- 迁移价值
  - 这是当前工作区上传体验和数据一致性的核心，尤其对歌曲封面、活动图、图库重编辑非常重要。
- 关键参考
  - 当前：`PocketBaseSchema.md:231`
  - 当前：`src/stores/uploadStore.ts:57`
  - 当前：`src/stores/uploadStore.ts:475`
  - 当前：`src/stores/uploadStore.ts:545`
  - 当前：`src/views/admin/AdminSettings.vue:29`
  - 当前：`src/lib/uploadBatches.ts:19`
  - 当前：`pocketbase/pb_hooks/10_gallery_upload_batches.pb.js:3`
  - 对照：`prisma/schema.prisma:294`
  - 对照：`server.ts:4027`
  - 对照：`server.ts:4170`

### 3. 服务端批量操作 API

当前工作区已经把多个后台高频操作收口为批量 API；`huangshifu-wiki` 后台仍以单条 CRUD 为主。

- 当前工作区能力
  - 图集图片批量删除、批量排序。
  - 活动图片批量删除、批量排序。
  - 歌曲封面批量删除。
  - 专辑封面批量删除。
  - 编辑锁批量删除。
  - 歌曲展示信息批量更新（默认展示专辑、默认封面）。
- 对照项目现状
  - `src/pages/Admin.tsx` 主要是单条删除、单条更新、按 tab 拉列表。
  - 未发现与上述能力对等的批量接口或统一批量操作层。
- 迁移价值
  - 这是当前项目的重要实现规范，能避免前端循环发请求，降低失败率和状态不同步问题。
- 关键参考
  - 当前：`src/lib/batchOperations.ts:27`
  - 当前：`pocketbase/pb_hooks/15_gallery_batch_operations.pb.js`
  - 当前：`pocketbase/pb_hooks/16_song_cover_batch_operations.pb.js`
  - 当前：`pocketbase/pb_hooks/18_song_batch_operations.pb.js`
  - 当前：`pocketbase/pb_hooks/19_album_cover_batch_operations.pb.js`
  - 当前：`pocketbase/pb_hooks/22_activity_batch_operations.pb.js`
  - 对照：`src/pages/Admin.tsx:129`

### 4. 图集编辑工作流更完整（发布流、存量编辑、重排）

两个项目都有图库，但当前工作区在“编辑已有图集”这件事上明显更完整。

- 当前工作区能力
  - 图集有 `published` 发布状态，支持草稿/发布切换。
  - 后台可以编辑已有图集，支持追加上传、删除图片、拖拽重排、保存时批量更新排序。
  - 图集编辑纳入编辑锁和上传任务治理。
- 对照项目现状
  - 服务端只有 `GET /api/galleries`、`GET /api/galleries/:id`、`POST /api/galleries`、`DELETE /api/galleries/:id`。
  - 数据模型里没有 `published` 字段，也没有图库更新接口。
- 迁移价值
  - 如果要承接当前工作区图库后台，这部分不是简单样式迁移，而是完整的后台内容生命周期迁移。
- 关键参考
  - 当前：`PocketBaseSchema.md:169`
  - 当前：`src/views/admin/AdminGalleryEdit.vue:52`
  - 当前：`src/views/admin/AdminGalleryEdit.vue:161`
  - 当前：`src/views/admin/AdminGalleryEdit.vue:631`
  - 当前：`src/views/admin/AdminGalleryEdit.vue:689`
  - 对照：`prisma/schema.prisma:279`
  - 对照：`server.ts:3979`
  - 对照：`server.ts:4375`
  - 对照：`server.ts:4575`

### 5. 歌曲多封面管理与默认封面来源策略

这是最明确的功能差异之一。`shifu-wiki` 中歌曲不是单一 `cover` 字段，而是独立封面集合 + 默认封面策略；`huangshifu-wiki` 只有单一封面 URL。

- 当前工作区能力
  - 歌曲有独立集合 `song_covers`，支持一首歌对应多张封面。
  - `defaultCover` 可指定为空、指定某张歌曲自有封面、或指定某张专辑封面。
  - 详情页会解析 `song_cover:ID` / `album_cover:ID` 并正确取图。
  - 歌曲编辑页支持上传、删除、默认封面切换，并与上传任务系统打通。
- 对照项目现状
  - `MusicTrack` 只有单个 `cover` 字段。
  - 前端歌曲列表、播放器都直接使用 `song.cover`。
  - 未发现歌曲多封面模型、默认封面来源策略或歌曲封面批量接口。
- 迁移价值
  - 这是音乐内容层最典型、最应该保留的增强能力。
- 关键参考
  - 当前：`PocketBaseSchema.md:31`
  - 当前：`src/views/admin/AdminSongEdit.vue:133`
  - 当前：`src/views/admin/AdminSongEdit.vue:164`
  - 当前：`src/views/admin/AdminSongEdit.vue:863`
  - 当前：`src/composables/useSongCover.ts:14`
  - 当前：`src/views/SongDetailView.vue:151`
  - 对照：`prisma/schema.prisma:359`
  - 对照：`src/pages/Music.tsx:25`
  - 对照：`src/components/MusicPlayer.tsx:76`

### 6. 专辑多封面管理与默认封面策略

当前工作区对专辑封面也做了独立建模；对照项目仍是单封面专辑。

- 当前工作区能力
  - 专辑有独立集合 `album_covers`。
  - `defaultCover` 支持空值、旧单封面兼容值 `old_cover`、或 `album_cover:ID`。
  - 歌曲还可以把某张专辑封面作为自身默认封面来源。
  - 专辑后台可以批量删除封面，并把当前专辑封面批量同步给所选歌曲作为展示封面。
- 对照项目现状
  - `Album` 只有单个 `cover` 字段。
  - 未发现 `album_covers` 之类的独立封面表或接口。
- 迁移价值
  - 这部分决定了后续是否还能保留“专辑多套视觉稿 + 歌曲借用专辑封面”的内容组织方式。
- 注意
  - 当前工作区的数据结构、后台 UI、删除接口和展示逻辑已经具备；但 `uploadStore` 里尚未补上 `album_covers` 的实际上传分支，迁移时建议把这个缺口一并修正，不要照搬这个遗漏。
- 关键参考
  - 当前：`PocketBaseSchema.md:61`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:69`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:93`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:507`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:976`
  - 当前：`src/stores/uploadStore.ts:649`
  - 当前：`src/stores/uploadStore.ts:663`
  - 对照：`prisma/schema.prisma:377`
  - 对照：`src/pages/Music.tsx:40`
  - 对照：`src/pages/AlbumDetail.tsx:23`

### 7. 歌曲-专辑关系拆分：展示专辑与关联专辑不是一回事

`huangshifu-wiki` 的专辑关系主要是“歌曲属于哪些专辑”；当前工作区在此基础上又额外实现了“歌曲详情页要展示哪个专辑”的独立概念。

- 当前工作区能力
  - 歌曲有 `defaultAlbum` / `defaultAlbumName`，区分“真正关联的专辑”与“页面展示专辑”。
  - 展示专辑支持三种模式：`none` / `linked` / `manual`。
  - 即使站内没有该专辑，也能通过 `defaultAlbumName` 手填展示文本。
  - 歌曲可关联多个专辑，并在每个专辑中指定落在哪个 Disc。
- 对照项目现状
  - `TrackInAlbum` 只处理专辑与歌曲的有序关系。
  - 前端只消费 `albumId` / `albumTitle` 这类返回值，没有“展示专辑独立配置”概念。
  - 未发现 `defaultAlbum` / `defaultAlbumName` 或对应 UI/接口。
- 迁移价值
  - 这是当前音乐信息架构里很重要的一层，因为它允许“收录关系”和“展示关系”解耦。
- 关键参考
  - 当前：`PocketBaseSchema.md:21`
  - 当前：`src/composables/useDisplayAlbum.ts:4`
  - 当前：`src/composables/useLinkedAlbums.ts:42`
  - 当前：`src/views/admin/AdminSongEdit.vue:87`
  - 当前：`src/views/admin/AdminSongEdit.vue:857`
  - 对照：`prisma/schema.prisma:394`
  - 对照：`src/pages/Music.tsx:35`

### 8. 多 Disc 专辑结构与歌曲展示信息反向同步

当前工作区的专辑不是扁平曲目列表，而是支持多 Disc；此外还能从专辑侧反向决定歌曲是否把本专辑作为展示专辑/展示封面。

- 当前工作区能力
  - `albums.tracks` 是带 `disc + name + songs` 的 JSON 结构。
  - 后台支持新增 Disc、删除 Disc、跨 Disc 拖拽曲目、归一化曲目结构。
  - 保存专辑时可以批量更新所选歌曲的 `defaultAlbum` / `defaultAlbumName` / `defaultCover`。
  - 删除专辑后，服务端会清理歌曲对该专辑的展示专辑引用。
- 对照项目现状
  - `TrackInAlbum` 只有 `trackOrder`，没有 Disc 维度。
  - 未发现从专辑侧反向批量同步歌曲展示信息的实现。
- 迁移价值
  - 如果当前专辑结构要完整迁移，这是必须保留的数据模型差异。
- 关键参考
  - 当前：`PocketBaseSchema.md:57`
  - 当前：`src/lib/albumTracks.ts:29`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:621`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:943`
  - 当前：`src/views/admin/AdminAlbumEdit.vue:995`
  - 当前：`pocketbase/pb_hooks/30_album_cascade.pb.js:21`
  - 对照：`prisma/schema.prisma:394`

### 9. 伴奏双向关联

当前工作区把“伴奏”做成了可维护的歌曲关系；对照项目没有这层关系模型。

- 当前工作区能力
  - `songs.instrumentalFor` 存储“此歌曲作为哪些歌曲的伴奏”。
  - 后台可以同时查看：
    - 当前歌曲有哪些伴奏；
    - 当前歌曲本身又作为哪些歌曲的伴奏。
  - 保存时会同步更新双方关系。
- 对照项目现状
  - `MusicTrack` 没有伴奏关系字段。
  - 未找到伴奏搜索、绑定、解除绑定逻辑。
- 迁移价值
  - 如果希望保留当前音乐资料库的知识关系，这个能力值得迁移。
- 关键参考
  - 当前：`PocketBaseSchema.md:27`
  - 当前：`src/composables/useLinkedInstrumentals.ts:43`
  - 当前：`src/composables/useLinkedInstrumentals.ts:210`
  - 当前：`src/views/admin/AdminSongEdit.vue:112`
  - 当前：`src/views/admin/AdminSongEdit.vue:860`
  - 对照：`prisma/schema.prisma:359`

### 10. 活动模块（结构化活动信息 + 图库）

`huangshifu-wiki` 没有对应模块；这是当前工作区完全独有的一块业务域。

- 当前工作区能力
  - 独立 `activities` 与 `activity_images` 数据模型。
  - 支持时间段 `timeSlots`、起售时间 `saleStartTimes`、票档 `ticketTiers`、售票平台 `ticketPlatforms`、阵容、标签、Markdown 详情。
  - 活动图支持上传、排序、批量删除。
  - 删除活动时有服务端级联清理图片。
- 对照项目现状
  - `prisma/schema.prisma` 中没有活动模型。
  - 路由和后台页中也没有对应活动管理入口。
- 迁移价值
  - 这是完整的新模块，迁移成本较高，但业务价值也最明确。
- 关键参考
  - 当前：`PocketBaseSchema.md:87`
  - 当前：`PocketBaseSchema.md:156`
  - 当前：`src/views/admin/AdminActivityEdit.vue:50`
  - 当前：`src/views/admin/AdminActivityEdit.vue:160`
  - 当前：`src/views/admin/AdminActivityEdit.vue:220`
  - 当前：`pocketbase/pb_hooks/22_activity_batch_operations.pb.js`
  - 当前：`pocketbase/pb_hooks/32_activity_cascade.pb.js`
  - 对照：`src/App.tsx:33`

### 11. 杂记模块（独立 CMS 流）

虽然 `huangshifu-wiki` 有 wiki / forum，但没有“独立于百科和社区之外的轻量内容流”；当前工作区的 `misc` 是一套单独的 CMS 模块。

- 当前工作区能力
  - 独立 `misc` 集合，支持标题、简介、Markdown 正文、发布状态、自动递增索引。
  - 有独立列表页、详情页、后台列表和后台编辑页。
- 对照项目现状
  - 未发现与 `misc` 对等的独立数据模型和后台入口。
  - wiki / forum 语义不同，不能直接等价替代。
- 迁移价值
  - 如果后续仍需要承载“轻量文章/记录/站务补充内容”，应单独迁移，而不是硬塞进 wiki 或帖子。
- 关键参考
  - 当前：`PocketBaseSchema.md:195`
  - 当前：`src/views/admin/AdminMiscEdit.vue:17`
  - 当前：`src/views/admin/AdminMiscEdit.vue:71`
  - 当前：`src/router/index.ts:64`
  - 当前：`src/router/index.ts:177`
  - 对照：`src/App.tsx:35`
  - 对照：`src/App.tsx:36`

### 12. 站点人物介绍 CMS（不是用户中心）

当前工作区的 `profile` 指的是站点内容里的“黄诗扶个人介绍”；`huangshifu-wiki` 的 `/profile` 是用户中心，两者不是同一概念。

- 当前工作区能力
  - 用单记录 `profile` 集合维护站点级人物介绍内容。
  - 后台有专门的“个人介绍管理”页。
- 对照项目现状
  - `/profile` 页面是当前登录用户资料、收藏、历史等个人中心。
  - 没有站点级艺人介绍记录模型。
- 迁移价值
  - 如果要保留当前站点的信息结构，这个模型需要单独落地，而不能复用用户表。
- 关键参考
  - 当前：`PocketBaseSchema.md:208`
  - 当前：`src/views/admin/AdminProfile.vue:25`
  - 当前：`src/router/index.ts:70`
  - 当前：`src/router/index.ts:195`
  - 对照：`src/pages/Profile.tsx:50`

### 13. 面向当前内容结构的全局搜索

两个项目都有搜索，但不是同一类搜索。当前工作区已经做了“歌 / 专 / 活动 / 图集 / 杂记”的统一搜索，而 `huangshifu-wiki` 的搜索对象主要是 wiki / post / gallery。

- 当前工作区能力
  - 单一接口同时搜索 `songs`、`albums`、`activities`、`galleries`、`misc`。
  - 还支持通过“专辑标题”反查其收录歌曲。
  - 对图集和杂记自动加上已发布限制。
- 对照项目现状
  - `/api/search` 返回的是 wiki、posts、galleries。
  - 没有当前站点内容模型对应的统一搜索实现。
- 迁移价值
  - 后续如果把当前项目的数据域迁过去，搜索层也需要重建，而不是直接沿用现有 `/api/search`。
- 关键参考
  - 当前：`pocketbase/pb_hooks/20_global_search.pb.js:15`
  - 当前：`src/components/GlobalSearch.vue`
  - 对照：`server.ts:5338`
  - 对照：`src/pages/Search.tsx:138`

### 14. 多平台在线播放后端（QQ / 网易云运行时解析）

两个项目都能播放音乐，但实现能力并不一样。当前工作区不是把音频 URL 直接存死，而是保存平台 ID，再由服务端运行时换取直链并做缓存。

- 当前工作区能力
  - 歌曲模型里有 `qqId`、`neteaseId`、`enabledPlatform`。
  - 独立音乐服务根据歌曲数据库 ID 去 PocketBase 读取平台配置，再向 QQ 音乐或网易云取播放直链。
  - 服务端有本地缓存层，避免重复请求第三方平台。
- 对照项目现状
  - `MusicTrack` 直接存 `audioUrl`。
  - 支持从网易云抓歌入库，但本质上是把外链直接写入数据，不是运行时按平台解析。
  - 未发现 QQ 音乐取链逻辑。
- 迁移价值
  - 如果后续要保留当前“只维护平台 ID，播放链路动态解析”的模式，这个后端服务要单独迁移。
- 关键参考
  - 当前：`PocketBaseSchema.md:24`
  - 当前：`server/index.js:78`
  - 当前：`server/index.js:137`
  - 当前：`src/composables/useMusicPlayer.ts`
  - 对照：`prisma/schema.prisma:359`
  - 对照：`server.ts:5033`
  - 对照：`server.ts:5085`
  - 对照：`server.ts:5273`

## 可作为迁移顺序的拆分建议

如果后续真的要迁移，比较合适的顺序大概是：

1. 先迁移基础设施：编辑锁、上传任务队列、上传批次清理、批量操作 API。
2. 再迁移音乐域：歌曲多封面、专辑多封面、展示专辑、关联专辑、多 Disc、伴奏关系。
3. 然后迁移图库增强：发布状态、编辑已有图集、图片重排。
4. 再补业务模块：活动、杂记、站点人物介绍。
5. 最后收口横切能力：全局搜索、多平台音乐播放服务。

## 备注

- 当前工作区里“专辑多封面上传”相关的数据结构和后台界面已经存在，但 `uploadStore` 的上传分支还没真正覆盖 `album_covers`；这是当前仓库内部的一个实现缺口，迁移时应视为“需要补齐的能力”，不要原样复制这个遗漏。
- 本文关注的是“当前工作区有而对照项目没有”的能力，不代表当前工作区所有实现都已经完全打磨完毕；后续如果开始迁移，建议按本文清单逐项做二次验收。
