# P0 功能实现记录

本文档记录诗扶小筑 P0 阶段（审核发布流、点赞收藏、用户封禁）的完整实现。

---

## 一、数据模型（Prisma Schema）

### 新增 Enums

| Enum | 值 | 用途 |
|---|---|---|
| `UserStatus` | `active`, `banned` | 用户账号状态 |
| `ContentStatus` | `draft`, `pending`, `published`, `rejected` | Wiki/帖子的审核状态 |
| `ModerationTargetType` | `wiki`, `post` | 审核日志关联目标类型 |
| `ModerationAction` | `submit`, `approve`, `reject`, `rollback` | 审核操作类型 |
| `FavoriteTargetType` | `wiki`, `post`, `music` | 收藏目标类型 |
| `UserBanAction` | `ban`, `unban` | 封禁日志操作类型 |

### 新增 / 扩展字段

**User**
- `status UserStatus`（默认 `active`）
- `banReason String?`
- `bannedAt DateTime?`
- 索引：`email`, `status`

**WikiPage**
- `status ContentStatus`（默认 `draft`）
- `reviewNote String?`
- `reviewedBy String?`
- `reviewedAt DateTime?`
- `favoritesCount Int`（默认 0）
- 索引：`status`, `slug`

**Post**
- `status ContentStatus`（默认 `draft`）
- `reviewNote String?`
- `reviewedBy String?`
- `reviewedAt DateTime?`
- 索引：`status`, `section`

### 新增 Model

| Model | 说明 | 唯一约束 |
|---|---|---|
| `PostLike` | 帖子点赞 | `postId + userUid` |
| `Favorite` | 通用收藏 | `userUid + targetType + targetId` |
| `ModerationLog` | 审核操作记录 | — |
| `UserBanLog` | 封禁操作记录 | — |

---

## 二、后端 API（server.ts）

### 审核流

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/wiki/:slug/submit` | POST | 提交 Wiki 待审 |
| `/api/posts/:id/submit` | POST | 提交帖子待审 |
| `/api/admin/review-queue` | GET | 审核列队（支持 `type=wiki\|posts`、`status=pending`） |
| `/api/admin/review/:type/:id/approve` | POST | 通过审核 |
| `/api/admin/review/:type/:id/reject` | POST | 驳回审核 |
| `/api/wiki/:slug/rollback/:revisionId` | POST | 回滚（写 ModerationLog） |

### 点赞收藏

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/posts/:id/like` | POST | 点赞（含 count 回写 + hotScore 重算 + 通知） |
| `/api/posts/:id/like` | DELETE | 取消点赞 |
| `/api/favorites` | POST | 添加收藏（含 WikiPage.favoritesCount 回写） |
| `/api/favorites/:type/:id` | DELETE | 取消收藏 |
| `/api/users/me/favorites` | GET | 我的收藏（支持 `type` 过滤） |

### 封禁风控

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/admin/users/:uid/ban` | POST | 封禁用户（写 UserBanLog） |
| `/api/admin/users/:uid/unban` | POST | 解封用户（写 UserBanLog） |

### 权限与可见性

- `requireActiveUser` 中间件：封禁用户所有写操作返回 403
- 内容可见性：`buildWikiVisibilityWhere` / `buildPostVisibilityWhere` — 游客只看 `published`，作者可见自己的非发布内容，管理员全见
- 写操作（创建/编辑 Wiki、帖子、评论、上传、图集等）均加 `requireActiveUser` 保护

### Cookie 安全

- `app.set('trust proxy', 1)` 启用代理信任
- Cookie `Secure` 标志根据 `X-Forwarded-Proto` 动态判断：HTTP 请求不设 Secure，HTTPS 请求自动设
- 可通过环境变量 `COOKIE_SECURE=true|false` 强制覆盖

---

## 三、前端改动

### Forum（`src/pages/Forum.tsx`）

- 列表展示帖子审核状态 badge（draft/pending/rejected）
- 详情页接入真实点赞切换（like/unlike）
- 接入真实收藏切换（favorite/unfavorite）
- 显示状态与驳回原因
- "提交审核"按钮（owner 且 draft/rejected）
- 编辑页拆分"保存草稿"与"提交审核"按钮
- 封禁态前端提示与写操作拦截

### Wiki（`src/pages/Wiki.tsx`）

- 列表页封禁用户不显示"创建页面"
- 详情页接入收藏切换，显示收藏数、状态、驳回原因
- owner 可"提交审核"
- 编辑页"保存草稿 / 提交审核"双按钮
- 历史回滚改调用后端 rollback API
- 封禁态前端拦截编辑/回滚
- **修复**：删除文件末尾游离的 `const { isBanned } = useAuth()`（导致空白屏的 bug）

### Admin（`src/pages/Admin.tsx`）

- 新增 `reviews` tab（审核列队）
- 调用 `GET /api/admin/review-queue` 拉取待审 wiki/posts
- 支持"通过/驳回"操作
- 用户管理新增封禁/解封按钮
- 用户状态 badge 显示（正常/已封禁）

### Profile（`src/pages/Profile.tsx`）

- 重写为 Tab 布局：`个人资料` / `我的收藏`
- 收藏页调用 `GET /api/users/me/favorites`，支持 type 过滤（all/wiki/post/music）
- 展示收藏项并跳转目标页
- 显示账号状态（Active/Banned）

### Music（`src/pages/Music.tsx`）

- 接入音乐收藏切换（基于 `/api/favorites`）
- 读取 `favoritedByMe` 显示心形高亮
- 封禁态对管理动作做前端限制提示

### AuthContext / Navbar

- `AuthContext` 增加 `isBanned` 字段
- `profile` 注入 `status/banReason/bannedAt`
- `Navbar` 显示账号受限提示与封禁原因

### firebaseCompat（`src/lib/firebaseCompat/firestore.ts`）

- 增加 favorites 与 likes 的 REST API 映射：
  - `users/me/favorites` collection 拉取
  - `posts/{id}/likes` add/delete
  - `users/me/favorites` add/delete

---

## 四、数据库迁移

**文件**：`prisma/migrate.sql`

新增表与索引与 Prisma Schema 保持同步。使用方式：

```bash
npm run db:generate
npx prisma db execute --file prisma/migrate.sql --schema prisma/schema.prisma
npm run db:seed
```

---

## 五、关键 Bug 修复

### 1. 空白屏（useContext null）

**文件**：`src/pages/Wiki.tsx:981`

文件末尾有一行游离的 `const { isBanned } = useAuth();`，它在组件外部执行，违反 React Hook 调用规则，导致模块加载阶段触发 `Cannot read properties of null (reading 'useContext')`。

**修复**：删除该行，在真正需要的组件 `WikiHistory` 内部补充调用。

### 2. 登录 Cookie 不持久

**文件**：`server.ts`

生产环境 cookie 始终设置 `secure: true`，但服务部署在 HTTP 下（`http://23.224.49.72`），浏览器拒绝接受带 `Secure` 标记的 cookie，导致登录态无法保持。

**修复**：cookie 的 `Secure` 标志改为按请求动态判断，HTTP 请求不设 Secure，HTTPS 请求自动启用。可通过 `COOKIE_SECURE` 环境变量覆盖。

### 3. PM2 重复启动 EADDRINUSE

**现象**：PM2 重启时 3000 端口被旧进程占用，导致 `EADDRINUSE`。

**修复**：`pm2 delete` → `pkill tsx` → 确认端口释放后再 start。

---

## 六、部署信息

**生产环境**：http://23.224.49.72

**管理员账号**：
- 邮箱：`admin@huangshifu.local`
- 密码：（首次部署时通过 `SEED_SUPER_ADMIN_PASSWORD` 环境变量设置）

**核心端点**：
- 健康检查：`GET /api/health`
- 审核列队：`GET /api/admin/review-queue?type=wiki|posts&status=pending`

---

## 七、验证清单

- [x] 游客访问首页正常
- [x] 用户注册 / 登录 / 退出
- [x] 登录态通过 cookie 保持（刷新后仍为登录状态）
- [x] 个人中心（Profile）可访问
- [x] 帖子：创建 → 草稿保存 → 提交审核 → 管理员通过 → 对游客可见
- [x] 帖子：点赞 / 取消点赞，点赞数实时更新
- [x] Wiki：创建 → 提交审核 → 管理员通过 → 对游客可见
- [x] Wiki：收藏 / 取消收藏，收藏数实时更新
- [x] 我的收藏：分 type 展示，可跳转
- [x] 管理后台：审核列队，支持通过 / 驳回
- [x] 管理后台：用户管理，支持封禁 / 解封
- [x] 封禁用户所有写操作返回 403，前端有明确提示
- [x] PM2 进程守护，开机自启
