# 诗扶小筑 - 项目结构文档

> 本文档详细描述了项目的整体架构、目录结构和核心功能模块。

---

## 一、项目概述

**诗扶小筑** 是一个基于 **Vite + React + Express + Prisma + PostgreSQL** 的全栈应用，是一个功能丰富的 Wiki/社区平台，支持文章、音乐、图库、论坛等多种内容形式。

### 核心特性

- 📚 **Wiki 百科系统** - 支持分支管理和 Pull Request 工作流
- 🎵 **音乐系统** - 支持多平台音乐聚合（网易云、QQ音乐、酷狗等）
- 🖼️ **图库系统** - 支持图片上传、管理和 AI 向量搜索
- 💬 **论坛系统** - 分版块讨论、评论互动
- 🔍 **智能搜索** - 基于 CLIP 嵌入向量的图片语义搜索
- 👤 **用户系统** - 角色权限管理、个人中心
- 🎨 **多主题支持** - Academy / Default 双主题
- 📱 **PWA + 小程序** - 支持离线访问和微信小程序

---

## 二、技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| **前端框架** | React | ^19.0.0 |
| **构建工具** | Vite | ^6.2.0 |
| **后端框架** | Express | ^4.21.2 |
| **数据库** | PostgreSQL | - |
| **ORM** | Prisma | ^6.7.0 |
| **样式** | Tailwind CSS | ^4.1.14 |
| **认证** | JWT + HttpOnly Cookie | - |
| **向量数据库** | Qdrant | ^1.15.0 |
| **AI 嵌入** | Xenova Transformers | ^2.17.2 |
| **对象存储** | AWS S3 SDK | ^3.800.0 |
| **测试** | Vitest | ^3.2.4 |

---

## 三、目录结构

```
huangshifu-wiki/
├── .github/workflows/          # CI/CD 工作流
├── .sisyphus/                  # 开发计划和草稿
├── .spec/                      # 需求规格文档
├── config/                     # 配置文件示例
├── docs/                       # 项目文档
├── miniprogram-webview/        # 微信小程序
├── prisma/                     # 数据库 Schema 和迁移
├── public/                     # 静态资源
├── scripts/                    # 工具脚本
├── src/                        # 源代码
│   ├── components/             # React 组件
│   ├── constants/              # 常量定义
│   ├── context/                # React Context
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/                    # 工具库
│   ├── locales/                # 国际化
│   ├── pages/                  # 页面组件
│   ├── server/                 # 后端代码
│   ├── services/               # 前端服务
│   ├── types/                  # TypeScript 类型
│   └── utils/                  # 工具函数
├── tests/unit/                 # 单元测试
├── server.ts                   # 服务器入口
├── vite.config.ts              # Vite 配置
├── vitest.config.ts            # 测试配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 项目依赖
└── docker-compose.yml          # Docker 配置
```

---

## 四、前端架构 (`src/`)

### 4.1 页面结构 (`src/pages/`)

| 页面 | 文件 | 功能描述 |
|------|------|----------|
| **首页** | `Home.tsx` | 支持 Academy/Default 双主题首页 |
| | `home/AcademyHome.tsx` | 学院主题首页 |
| | `home/DefaultHome.tsx` | 默认主题首页 |
| **Wiki** | `Wiki.tsx` | Wiki 百科页面（列表/详情/编辑） |
| **论坛** | `Forum.tsx` | 论坛帖子列表和详情 |
| **音乐** | `Music.tsx` | 音乐列表页面 |
| | `MusicDetail.tsx` | 音乐详情页 |
| | `MusicLinks.tsx` | 音乐链接管理 |
| | `AlbumDetail.tsx` | 专辑详情页 |
| **图库** | `Gallery.tsx` | 图库列表 |
| | `GalleryDetail.tsx` | 图库详情 |
| **搜索** | `Search.tsx` | 全局搜索（支持语义搜索） |
| **用户** | `Profile.tsx` | 个人中心 |
| | `Notifications.tsx` | 通知中心 |
| | `Recruit.tsx` | 招募页面 |
| **管理** | `Admin.tsx` | 管理后台 |
| | `Admin/EmbeddingsTab.tsx` | 向量嵌入管理 |
| | `Admin/ImagesTab.tsx` | 图片管理 |
| | `Admin/BackupsTab.tsx` | 备份管理 |
| | `Admin/MarkdownLinkUpdater.tsx` | Markdown 链接更新 |

### 4.2 组件库 (`src/components/`)

#### 4.2.1 基础组件

| 组件 | 功能 |
|------|------|
| `Modal/` | 模态框组件集 |
| | `ConfirmModal.tsx` - 确认对话框 |
| | `FormModal.tsx` - 表单对话框 |
| `Toast.tsx` | 消息提示 |
| `Pagination.tsx` | 分页组件 |
| `Skeleton.tsx` / `*Skeleton.tsx` | 骨架屏组件 |
| `ErrorBoundary.tsx` | 错误边界 |
| `GlassCard.tsx` | 毛玻璃卡片 |

#### 4.2.2 导航组件

| 组件 | 功能 |
|------|------|
| `Navbar.tsx` | 顶部导航栏 |
| `Navbar/AuthModal.tsx` | 登录/注册弹窗 |
| `Navbar/MobileMenu.tsx` | 移动端菜单 |
| `Navbar/NotificationPanel.tsx` | 通知面板 |
| `BottomNav.tsx` | 底部导航（移动端） |
| `AnnouncementBar.tsx` | 公告栏 |

#### 4.2.3 Wiki 组件 (`components/wiki/`)

| 组件 | 功能 |
|------|------|
| `WikiCard.tsx` | Wiki 卡片 |
| `WikiEditor.tsx` | Markdown 编辑器 |
| `WikiRelations.tsx` | 关系管理 |
| `RelationGraph.tsx` | 关系图谱（Vis.js） |
| `MiniRelationGraph.tsx` | 迷你关系图 |
| `RelationPreview.tsx` | 关系预览 |

#### 4.2.4 音乐组件 (`components/Music/`)

| 组件 | 功能 |
|------|------|
| `AlbumCard.tsx` | 专辑卡片 |
| `SongCard.tsx` | 歌曲卡片 |
| `MusicFilters.tsx` | 音乐筛选器 |
| `BatchActions.tsx` | 批量操作 |
| `MusicPlayer.tsx` | 音乐播放器 |
| `GlobalMusicPlayer.tsx` | 全局播放器 |
| `LyricsDisplay.tsx` | 歌词显示 |

#### 4.2.5 图片组件

| 组件 | 功能 |
|------|------|
| `SmartImage.tsx` | 智能图片（懒加载+模糊预览） |
| `BlurhashImage.tsx` | Blurhash 模糊加载 |
| `Lightbox.tsx` | 图片灯箱 |
| `S3ImageUploader.tsx` | S3 图片上传 |
| `GallerySkeleton.tsx` | 图库骨架屏 |

#### 4.2.6 图表组件 (`components/charts/`)

| 组件 | 功能 |
|------|------|
| `EChartsComponent.tsx` | ECharts 封装 |
| `ActivityTrendChart.tsx` | 活动趋势图 |
| `ContentDistributionChart.tsx` | 内容分布图 |
| `MemberGrowthChart.tsx` | 成员增长图 |

#### 4.2.7 首页组件 (`components/home/`)

| 组件 | 功能 |
|------|------|
| `CategoryCard.tsx` | 分类卡片 |
| `AnimatedStat.tsx` | 动画统计数字 |

### 4.3 自定义 Hooks (`src/hooks/`)

| Hook | 功能 |
|------|------|
| `useApi.ts` | API 请求状态管理 |
| `useSearch.ts` | 搜索功能封装 |
| `useS3Upload.ts` | S3 上传管理 |
| `useImageUrl.ts` | 图片 URL 处理 |
| `useImageSync.ts` | 图片同步状态 |
| `useImageHandler.ts` | 图片上传处理 |
| `useBlurhash.ts` | Blurhash 解码 |
| `useIntersectionObserver.ts` | 交叉观察器 |
| `useInView.ts` | 视口检测 |
| `useAnimatedNumber.ts` | 数字动画 |
| `useCountUp.ts` | 计数动画 |
| `useReducedMotion.ts` | 减少动画偏好检测 |
| `useWebVitals.ts` | Web 性能指标采集 |

### 4.4 工具库 (`src/lib/`)

| 文件 | 功能 |
|------|------|
| `apiClient.ts` | API 客户端（封装 fetch） |
| `apiTypes.ts` | API 类型定义 |
| `auth.ts` | 认证工具（JWT、微信登录） |
| `dateUtils.ts` | 日期格式化 |
| `formatUtils.ts` | 通用格式化 |
| `wikiLinkParser.ts` | Wiki 链接解析 `[[标题]]` |
| `markdownLinkReplacer.ts` | Markdown 链接替换 |
| `sensitiveWordFilter.ts` | 敏感词过滤 |
| `theme.ts` | 主题管理 |
| `i18n.ts` | 国际化 |
| `contentUtils.ts` | 内容处理工具 |
| `htmlSanitizer.ts` | HTML 净化 |
| `lrcParser.ts` | 歌词解析 |
| `miniProgram.ts` | 微信小程序工具 |
| `metadataCache.ts` | 元数据缓存 |
| `relationQuality.ts` | 关系质量评分 |
| `relationSorter.ts` | 关系排序 |
| `viewModes.ts` | 视图模式管理 |
| `randomId.ts` | 随机 ID 生成 |
| `copyLink.ts` | 链接复制 |
| `errorHandler.ts` | 错误处理 |

### 4.5 Context 状态管理 (`src/context/`)

| Context | 功能 |
|---------|------|
| `AuthContext.tsx` | 用户认证状态 |
| `MusicContext.tsx` | 音乐播放状态 |
| `ThemeContext.tsx` | 主题状态（Academy/Default） |
| `UserPreferencesContext.tsx` | 用户偏好设置 |

### 4.6 类型定义 (`src/types/`)

| 文件 | 内容 |
|------|------|
| `entities.ts` | 实体类型（User、Post、WikiPage 等） |
| `api.ts` | API 请求/响应类型 |
| `common.ts` | 通用类型 |
| `home.ts` | 首页相关类型 |
| `PlatformIds.ts` | 音乐平台 ID 类型 |
| `userPreferences.ts` | 用户偏好类型 |

---

## 五、后端架构 (`src/server/`)

### 5.1 入口文件

**`server.ts`** - Express 服务器主入口：
- 环境变量加载
- 中间件配置（CORS、Helmet、Compression）
- 路由注册
- Vite 集成（开发模式）
- 静态文件服务（生产模式）

### 5.2 路由层 (`src/server/routes/`)

| 路由文件 | 功能 | 路径前缀 |
|----------|------|----------|
| `auth.routes.ts` | 认证（登录/注册/微信登录） | `/api/auth` |
| `users.routes.ts` | 用户管理 | `/api/users` |
| `wiki.routes.ts` | Wiki 百科 CRUD | `/api/wiki` |
| `posts.routes.ts` | 论坛帖子 | `/api/posts` |
| `galleries.routes.ts` | 图库管理 | `/api/galleries` |
| `music.routes.ts` | 音乐管理 | `/api/music` |
| `music-song.routes.ts` | 歌曲管理 | `/api/music-songs` |
| `albums.routes.ts` | 专辑管理 | `/api/albums` |
| `search.routes.ts` | 搜索功能 | `/api/search` |
| `embeddings.routes.ts` | 向量嵌入 | `/api/embeddings` |
| `admin.routes.ts` | 管理后台 | `/api/admin` |
| `notifications.routes.ts` | 通知 | `/api/notifications` |
| `favorites.routes.ts` | 收藏 | `/api/favorites` |
| `sections.routes.ts` | 论坛版块 | `/api/sections` |
| `announcements.routes.ts` | 公告 | `/api/announcements` |
| `image-maps.routes.ts` | 图片映射 | `/api/image-maps` |
| `config.routes.ts` | 站点配置 | `/api/config` |
| `s3.routes.ts` | S3 存储 | `/api/s3` |
| `uploads.routes.ts` | 文件上传 | `/api/uploads` |

### 5.3 服务模块

#### 5.3.1 向量嵌入 (`src/server/vector/`)

| 文件 | 功能 |
|------|------|
| `clipEmbedding.ts` | CLIP 模型嵌入生成 |
| `qdrantService.ts` | Qdrant 向量数据库操作 |
| `embeddingSync.ts` | 嵌入同步任务 |
| `wikiPostEmbedding.ts` | Wiki/Post 内容嵌入 |

#### 5.3.2 音乐服务 (`src/server/music/`)

| 文件 | 功能 |
|------|------|
| `metingService.ts` | Meting API 集成 |
| `musicUrlParser.ts` | 音乐平台 URL 解析 |

#### 5.3.3 地理位置 (`src/server/location/`)

| 文件 | 功能 |
|------|------|
| `locationService.ts` | 位置服务 |
| `geoService.ts` | 地理编码服务 |
| `exifService.ts` | EXIF 数据提取 |
| `routes.ts` | 位置相关路由 |
| `exifRoutes.ts` | EXIF 相关路由 |

#### 5.3.4 生日服务 (`src/server/birthday/`)

| 文件 | 功能 |
|------|------|
| `birthdayService.ts` | 生日计算和提醒 |
| `routes.ts` | 生日相关路由 |

#### 5.3.5 S3 服务 (`src/server/s3/`)

| 文件 | 功能 |
|------|------|
| `s3Service.ts` | S3 客户端封装 |

#### 5.3.6 图片服务 (`src/server/services/`)

| 文件 | 功能 |
|------|------|
| `imageSyncService.ts` | 图片同步服务 |
| `galleryImageSyncService.ts` | 图库图片同步 |

#### 5.3.7 Wiki 服务 (`src/server/wiki/`)

| 文件 | 功能 |
|------|------|
| `markdownLinkUpdater.ts` | Markdown 链接更新 |

### 5.4 中间件 (`src/server/middleware/`)

| 文件 | 功能 |
|------|------|
| `auth.ts` | JWT 认证中间件 |
| `rateLimiter.ts` | 请求限流 |

### 5.5 工具函数 (`src/server/utils/`)

| 文件 | 功能 |
|------|------|
| `cache.ts` | 内存缓存 |
| `hash.ts` | 哈希计算 |
| `index.ts` | 工具导出 |

### 5.6 其他文件

| 文件 | 功能 |
|------|------|
| `prisma.ts` | Prisma 客户端实例 |
| `uploadPath.ts` | 上传路径管理 |
| `blurhashService.ts` | Blurhash 生成服务 |
| `types/index.ts` | 服务端类型定义 |

---

## 六、数据库架构 (`prisma/`)

### 6.1 Schema 概览

**数据库**: PostgreSQL
**ORM**: Prisma

### 6.2 核心模型

#### 用户系统
```prisma
model User {
  uid           String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  displayName   String
  photoURL      String?
  wechatOpenId  String?   @unique
  wechatUnionId String?
  role          UserRole  @default(user)  // user/admin/super_admin
  status        UserStatus @default(active)
  level         Int       @default(1)
  bio           String
  preferences   Json?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

#### Wiki 系统
```prisma
model WikiPage {
  id            String        @id @default(cuid())
  slug          String        @unique
  title         String
  category      String
  content       String
  tags          Json?
  relations     Json?
  eventDate     String?
  locationCode  String?
  status        ContentStatus @default(published)
  viewCount     Int           @default(0)
  favoritesCount Int          @default(0)
  lastEditorUid String
  mainBranchId  String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model WikiRevision {
  id         String   @id @default(cuid())
  pageSlug   String
  branchId   String?
  title      String
  content    String
  editorUid  String
  editorName String
  isAutoSave Boolean  @default(false)
  createdAt  DateTime @default(now())
}

model WikiBranch {
  id               String           @id @default(cuid())
  pageSlug         String
  editorUid        String
  status           WikiBranchStatus @default(draft)
  latestRevisionId String?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
}

model WikiPullRequest {
  id             String                @id @default(cuid())
  branchId       String
  pageSlug       String
  title          String
  description    String?
  status         WikiPullRequestStatus @default(open)
  createdByUid   String
  createdByName  String
  reviewedBy     String?
  reviewedAt     DateTime?
  mergedAt       DateTime?
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt
}
```

#### 论坛系统
```prisma
model Post {
  id            String        @id @default(cuid())
  title         String
  section       String
  musicDocId    String?
  albumDocId    String?
  content       String
  tags          Json?
  locationCode  String?
  authorUid     String
  status        ContentStatus @default(published)
  hotScore      Float         @default(0)
  viewCount     Int           @default(0)
  likesCount    Int           @default(0)
  commentsCount Int           @default(0)
  isPinned      Boolean       @default(false)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model PostComment {
  id         String   @id @default(cuid())
  postId     String?
  galleryId  String?
  authorUid  String
  authorName String
  authorPhoto String?
  content    String
  parentId   String?
  createdAt  DateTime @default(now())
}
```

#### 图库系统
```prisma
model Gallery {
  id          String   @id @default(cuid())
  title       String
  description String
  authorUid   String
  authorName  String
  tags        Json?
  locationCode String?
  copyright   String?
  published   Boolean  @default(false)
  publishedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model GalleryImage {
  id        String   @id @default(cuid())
  galleryId String
  assetId   String?
  url       String
  name      String
  sortOrder Int      @default(0)
}

model ImageEmbedding {
  id             String          @id @default(cuid())
  galleryImageId String          @unique
  modelName      String          @default("Xenova/clip-vit-base-patch32")
  vectorSize     Int             @default(512)
  status         EmbeddingStatus @default(pending)
  lastError      String?
  embeddedAt     DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
}
```

#### 音乐系统
```prisma
model MusicTrack {
  docId              String   @id @default(cuid())
  id                 String   @unique
  title              String
  artist             String
  album              String   @default("")
  cover              String   @default("")
  audioUrl           String   @default("")
  lyric              String?
  primaryPlatform    MusicPlatform   @default(netease)
  enabledPlatform    MusicPlatform?
  neteaseId          String?
  tencentId          String?
  kugouId            String?
  baiduId            String?
  kuwoId             String?
  customPlatformIds  Json?
  customPlatformLinks Json?
  displayAlbumMode   DisplayAlbumMode @default(linked)
  manualAlbumName    String?
  addedBy            String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model Album {
  docId              String              @id @default(cuid())
  id                 String              @unique
  resourceType       MusicCollectionType @default(album)
  platform           MusicPlatform
  sourceId           String
  title              String
  artist             String
  cover              String
  description        String?
  platformUrl        String?
  tracks             Json?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
}

model SongAlbumRelation {
  id         String  @id @default(cuid())
  songDocId  String
  albumDocId String
  discNumber Int     @default(1)
  trackOrder Int     @default(0)
  isDisplay  Boolean @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

#### 媒体资源
```prisma
model MediaAsset {
  id         String          @id @default(cuid())
  ownerUid   String
  sessionId  String?
  storageKey String          @unique
  publicUrl  String
  fileName   String
  mimeType   String
  sizeBytes  Int
  status     MediaAssetStatus @default(ready)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
}

model UploadSession {
  id            String             @id @default(cuid())
  ownerUid      String
  status        UploadSessionStatus @default(open)
  maxFiles      Int                @default(50)
  uploadedFiles Int                @default(0)
  expiresAt     DateTime
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
}
```

### 6.3 枚举类型

| 枚举 | 值 |
|------|-----|
| `UserRole` | `user`, `admin`, `super_admin` |
| `UserStatus` | `active`, `banned` |
| `ContentStatus` | `draft`, `pending`, `published`, `rejected` |
| `MusicPlatform` | `netease`, `tencent`, `kugou`, `baidu`, `kuwo` |
| `WikiBranchStatus` | `draft`, `pending_review`, `merged`, `rejected`, `conflict` |
| `WikiPullRequestStatus` | `open`, `merged`, `rejected` |
| `EmbeddingStatus` | `pending`, `processing`, `ready`, `failed` |
| `StorageType` | `local`, `s3`, `external` |

### 6.4 迁移文件

```
prisma/migrations/
├── 20260326132000_init_pg/                    # 初始迁移
│   └── migration.sql
├── 20260331113000_add_music_track_custom_platform_links/  # 音乐平台链接
│   └── migration.sql
└── migration_lock.toml
```

### 6.5 种子数据

- `seed.ts` - 初始化种子数据
- `seed-birthday.ts` - 生日数据种子

---

## 七、测试架构 (`tests/`)

### 7.1 单元测试 (`tests/unit/`)

| 测试文件 | 测试内容 |
|----------|----------|
| `apiClient.test.ts` | API 客户端 |
| `apiTypes.test.ts` | API 类型 |
| `auth.test.ts` | 认证工具 |
| `birthdayService.test.ts` | 生日服务 |
| `cache.test.ts` | 缓存工具 |
| `clipEmbedding.test.ts` | CLIP 嵌入 |
| `contentUtils.test.ts` | 内容工具 |
| `copyLink.test.ts` | 链接复制 |
| `dateUtils.test.ts` | 日期工具 |
| `errorHandler.test.ts` | 错误处理 |
| `formatUtils.test.ts` | 格式化工具 |
| `geoService.test.ts` | 地理服务 |
| `htmlSanitizer.test.ts` | HTML 净化 |
| `i18n.test.ts` | 国际化 |
| `locationService.test.ts` | 位置服务 |
| `lrcParser.test.ts` | 歌词解析 |
| `markdownLinkReplacer.test.ts` | Markdown 链接 |
| `metadataCache.test.ts` | 元数据缓存 |
| `miniProgram.test.ts` | 小程序工具 |
| `musicUrlParser.test.ts` | 音乐 URL 解析 |
| `qdrantService.test.ts` | Qdrant 服务 |
| `randomId.test.ts` | 随机 ID |
| `relationQuality.test.ts` | 关系质量 |
| `relationSorter.test.ts` | 关系排序 |
| `sensitiveWordFilter.test.ts` | 敏感词过滤 |
| `theme.test.ts` | 主题管理 |
| `viewModes.test.ts` | 视图模式 |
| `wikiLinkParser.test.ts` | Wiki 链接解析 |
| `wikiPostEmbedding.test.ts` | Wiki 嵌入 |

---

## 八、脚本工具 (`scripts/`)

| 脚本 | 功能 |
|------|------|
| `sync-image-embeddings.ts` | 同步图片嵌入向量 |
| `embeddings:sync` | 执行嵌入同步 |
| `embeddings:enqueue` | 仅入队嵌入任务 |
| `import-regions.ts` | 导入地区数据 |
| `regions:import` | 执行地区导入 |
| `sync-gallery-images-to-imagemap.ts` | 同步图库到图片映射 |
| `deploy.sh` | 部署脚本 |
| `deploy-docker.sh` | Docker 部署脚本 |

---

## 九、配置说明

### 9.1 环境变量

```env
# 基础配置
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/huangshifu_wiki"
JWT_SECRET="your-secret-key"
PORT=3000

# 管理员种子
SEED_SUPER_ADMIN_EMAIL="admin@example.com"
SEED_SUPER_ADMIN_PASSWORD="your-password"
SEED_SUPER_ADMIN_NAME="管理员"

# 上传配置
UPLOAD_SESSION_TTL_MINUTES=45
UPLOADS_PATH="./uploads"

# AI 配置
VITE_GEMINI_API_KEY="your-gemini-key"

# 微信配置
WECHAT_MP_APPID=""
WECHAT_MP_APP_SECRET=""
WECHAT_LOGIN_MOCK="false"

# S3 配置
S3_ENDPOINT=""
S3_BUCKET=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""

# Qdrant 配置
QDRANT_URL="http://localhost:6333"
QDRANT_API_KEY=""

# 嵌入配置
IMAGE_EMBEDDING_BATCH_SIZE=100
IMAGE_SEARCH_RESULT_LIMIT=24
```

### 9.2 配置文件

| 文件 | 说明 |
|------|------|
| `vite.config.ts` | Vite 构建配置 |
| `vitest.config.ts` | 测试配置 |
| `tsconfig.json` | TypeScript 配置 |
| `biome.json` | 代码格式化配置 |
| `docker-compose.yml` | Docker 编排配置 |
| `config/s3.config.example.ts` | S3 配置示例 |
| `config/server.config.env.example` | 服务器配置示例 |

---

## 十、文档目录 (`docs/`)

| 文档 | 内容 |
|------|------|
| `home.md` | 项目主页文档 |
| `p0-implementation.md` | P0 功能实现文档 |
| `p0-v6-edit-lock-and-gallery-workflow.md` | 编辑锁和图库工作流 |
| `p2-wechat-mini-program.md` | 微信小程序接入 |
| `server-deployment.md` | 服务器部署指南 |
| `docker-deployment.md` | Docker 部署指南 |
| `IMAGE_SYSTEM.md` | 图片系统设计 |
| `UI_IMPROVE.md` | UI 改进计划 |
| `theme-academy-skin.md` | Academy 主题设计 |
| `supported-embed-platforms.md` | 支持的嵌入平台 |
| `500-error-troubleshooting.md` | 500 错误排查 |
| `开发路线图-P0-P1-P2.md` | 开发路线图 |
| `功能盘点-测试清单-迭代建议.md` | 功能盘点和测试清单 |

---

## 十一、微信小程序 (`miniprogram-webview/`)

```
miniprogram-webview/
├── pages/
│   ├── index/              # 首页（跳转页）
│   │   ├── index.js
│   │   ├── index.json
│   │   ├── index.wxml
│   │   └── index.wxss
│   └── webview/            # WebView 页面
│       ├── webview.js
│       ├── webview.json
│       ├── webview.wxml
│       └── webview.wxss
├── app.js                  # 小程序逻辑
├── app.json                # 小程序配置
├── app.wxss                # 全局样式
├── config.js               # 配置文件
├── project.config.json     # 项目配置
└── sitemap.json            # 站点地图
```

---

## 十二、可用命令

```bash
# 开发
npm run dev                 # 启动开发服务器

# 构建
npm run build               # 构建生产版本
npm run preview             # 预览构建结果
npm run clean               # 清理构建目录

# 代码质量
npm run lint                # TypeScript 类型检查

# 测试
npm run test                # 运行单元测试
npm run test:unit           # 同上
npm run test:watch          # 监听模式测试
npm run test:coverage       # 生成测试覆盖率报告

# 数据库
npm run db:generate         # 生成 Prisma Client
npm run db:migrate          # 执行数据库迁移
npm run db:deploy           # 部署迁移
npm run db:push             # 推送 Schema 到数据库
npm run db:seed             # 执行种子数据

# 嵌入向量
npm run embeddings:sync     # 同步图片嵌入
npm run embeddings:enqueue  # 入队嵌入任务

# 地区数据
npm run regions:import      # 导入地区数据
```

---

## 十三、项目依赖亮点

### 核心框架
- `react` ^19.0.0 - React 框架
- `react-router-dom` ^7.13.2 - 路由管理
- `express` ^4.21.2 - 后端框架

### UI/样式
- `tailwindcss` ^4.1.14 - 原子化 CSS
- `lucide-react` ^0.546.0 - 图标库
- `motion` ^12.23.24 - 动画库
- `echarts` ^5.5.1 - 图表库

### 数据/状态
- `@prisma/client` ^6.7.0 - ORM
- `@qdrant/js-client-rest` ^1.15.0 - 向量数据库
- `@xenova/transformers` ^2.17.2 - AI 嵌入模型

### 工具库
- `zod` ^4.3.6 - Schema 验证
- `date-fns` ^4.1.0 - 日期处理
- `sharp` ^0.34.5 - 图片处理
- `blurhash` ^2.0.5 - 模糊哈希

### 存储
- `@aws-sdk/client-s3` ^3.800.0 - S3 客户端
- `multer` ^2.0.0 - 文件上传

---

## 十四、架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Frontend)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   React 19  │  │  Vite Build │  │   Tailwind CSS      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ React Router│  │  Context    │  │   Custom Hooks      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API 层 (Express)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Auth     │  │    Wiki     │  │      Music          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Post     │  │   Gallery   │  │     Search          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Admin    │  │   Upload    │  │   Embeddings        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据层 (Data Layer)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Prisma    │  │  PostgreSQL │  │    Qdrant           │  │
│  │    ORM      │  │  (主数据库)  │  │  (向量数据库)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │     S3      │  │   Local FS  │  │   CLIP Model        │  │
│  │  (对象存储)  │  │  (本地存储)  │  │  (嵌入生成)          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 十五、开发规范

### 15.1 代码风格
- 使用 Biome 进行代码格式化
- TypeScript 严格模式
- 函数式组件 + Hooks

### 15.2 文件命名
- 组件: `PascalCase.tsx`
- 工具: `camelCase.ts`
- 常量: `SCREAMING_SNAKE_CASE`

### 15.3 导入顺序
1. React/框架导入
2. 第三方库
3. 本地组件
4. 本地工具
5. 类型定义
6. 样式文件

### 15.4 测试规范
- 每个模块对应一个测试文件
- 使用 Vitest 测试框架
- 覆盖率报告自动生成

---

*文档生成时间: 2026-04-20*
*项目版本: 0.0.0*
