# 黄诗扶 Wiki API 调用文档

本文是当前代码版本的 HTTP API 参考。接口可用性受运行时开关、角色、资源归属/可见性、封禁状态和站点服务凭证影响。

- 所有路径相对于 BASE_URL；BASE_URL 不含末尾斜线。站点域名由部署者提供；本文不假设固定域名。
- 登录网站后，在「设置 → API 密钥」（/settings/api-keys）创建个人密钥。完整密钥只显示一次；可设 30、90、365 天或永久有效，默认 90 天。
- 通过交互输入密钥，避免写入命令历史；不要把密钥放进 URL、请求体、脚本仓库或日志。对外访问使用 HTTPS。
- JSON 写请求设置 Content-Type: application/json。multipart 由 curl 生成 boundary，不要手动写 Content-Type。
- 本文覆盖 server.ts 中实际挂载的 334 个 HTTP 路由。语义嵌入 API 仅在语义搜索开关启用时注册；共享挂载与管理员动态分支均纳入索引。

```bash
BASE_URL='https://站点域名'
read -rsp 'API 密钥：' API_KEY
printf '\n'
AUTH_HEADER="Authorization: Bearer $API_KEY"
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/me"
```

## 1. 快速开始与安全使用

Cookie-only curl 骨架中的 COOKIE_JAR 与 XSRF_TOKEN 是仍有效的网站网页登录 Cookie/XSRF 值占位符；只能由 Cookie 会话获取，不能把 API_KEY 填入这两个变量。

Bearer API 密钥调用现有网站 API，不是独立服务，也不产生新权限。密钥请求无需先登录，不需 Cookie/XSRF；显式 Authorization 优先于 Cookie，密钥无效时不会回退到 Cookie。服务端每次请求按账户当前状态判权，因此角色调整、封禁、撤销、到期会影响后续请求。

管理员密钥仍受每条 API 的具体权限约束；不能越过所有权、可见性、额外当前密码校验或功能开关。多个密钥共用账号/IP 限流，不产生独立配额。写请求没有通用幂等键，网络断开后先核对状态再决定是否重试。

API 密钥不能创建/列出/撤销密钥，不能获取或退出网页登录会话。密钥调用登录、微信登录、登出会话端点返回 403 API_KEY_SESSION_FORBIDDEN；密钥管理接口仅 Cookie 会话可用，Bearer 调用返回 403 COOKIE_SESSION_REQUIRED。改/重置密码、退出网页登录不会撤销 API 密钥；账户注销与管理员删除用户会撤销，恢复用户不会恢复旧密钥。

## 2. 认证、权限及通用约定

| 标记        | 约束                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| 公开        | 无需登录；可选身份仍会影响私有内容可见性。                                       |
| 已认证      | 有效 Cookie 会话或有效 Bearer 密钥；如处理器声明未封禁检查，封禁用户仍不能操作。 |
| 管理员      | admin 或 super_admin，且仍受资源规则约束。                                       |
| 超级管理员  | 仅 super_admin，用于敏感管理操作。                                               |
| Cookie-only | 有效网页登录 Cookie 与 CSRF；API 密钥不适用。                                    |
| 条件服务    | 需要站点开关、Amap、SMTP、S3、向量库或外部音乐服务可用。                         |

Express JSON 请求体上限 1 MiB；一般请求超时 30 秒，备份等长任务另有设置。分页不是统一包装：大多数列表返回 page/limit/total/totalPages/hasMore 的组合，用户历史使用 offset，有些资源没有分页。日期时间通常是 ISO 8601，日期字段通常是 YYYY-MM-DD；具体以逐接口响应字段为准。

### ID 对照

| 字段                         | 含义                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| uid / publicId               | uid 是账户内部 ID；公开资料使用 publicId。                                               |
| id / slug                    | 帖子、图库、活动、Wiki 等写入/关系一般用内部 id；公开详情使用数字 slug。具体按接口说明。 |
| docId / sourceId             | 歌曲/专辑业务操作用 docId；平台解析、导入选择用外部 sourceId。两者不可互换。             |
| sessionId / assetId          | sessionId 是上传会话；assetId 是会话文件生成的媒体资源 ID。                              |
| coverId / imageMapId         | coverId 是歌曲/专辑封面记录；imageMapId 是底层图片映射，不等于 assetId。                 |
| branchId / revisionId / prId | Wiki 分支、修订、合并请求各自的内部 ID。                                                 |

### 常用 DTO 与嵌套模型

接口包装不是统一的 {data}。以下共享模型列出 transformer 实际可公开字段；某个接口若省略字段、返回 null 或增加计数/交互状态，会在该接口正文说明。

| 模型            | 字段与嵌套                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User            | uid、publicId、email、displayName、photoURL、photoAssetId、role、status、banReason、bannedAt、emailVerified、emailVerifiedAt、level、signature、bio、isDeleted、deletedAt、deletedBy、createdAt、updatedAt。具体 handler 可能返回子集；不含密码 hash。                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Post            | id、slug、title、section、musicDocId、albumDocId、content、mentionTargets[{uid,publicId?,displayName,photoURL?}]、tags、locationCode、locationName、locationDetail、authorUid、authorPublicId、authorName、status、reviewNote、reviewedBy、reviewedAt、hotScore、viewCount、likesCount、dislikesCount、commentsCount、isPinned、isDeleted、deletedAt、deletedBy、createdAt、updatedAt。列表通常无正文；详情额外 comments/likedByMe/favoritedByMe/dislikedByMe。                                                                                                                                                                                                                                               |
| Wiki page       | id、slug、title、category、content、tags、relations[{type,targetSlug,label?,bidirectional}]、eventDate、locationCode、locationName、locationDetail、status、reviewNote、reviewedBy、reviewedAt、viewCount、favoritesCount、isPinned、likesCount、dislikesCount、isDeleted、deletedAt、deletedBy、lastEditorUid、lastEditorName、createdAt、updatedAt。relation type 是 related_person/work_relation/timeline_relation/custom；最多80项、label最多60，默认 bidirectional=true。                                                                                                                                                                                                                                |
| Comment         | id、postId、galleryId、authorUid、authorPublicId、authorName、authorPhoto、content、mentionTargets[{uid,publicId?,displayName,photoURL?}]、parentId、replyToId、replyToAuthorUid、replyToAuthorName、isDeleted、deletedAt、deletedBy、deletedByName、likesCount、likedByMe、createdAt。删除内容在某些用户列表会用“评论已删除”遮蔽；deleted root 有存活 reply 时可能作为占位保留。                                                                                                                                                                                                                                                                                                                             |
| Gallery         | id、slug、title、description、authorUid、authorPublicId、authorName、tags、relatedLinks[{label,url}]、eventDate、locationCode/locationName/locationDetail、copyright、status、reviewNote、reviewedBy、reviewedAt、published/publishedAt、likesCount、dislikesCount、favoritesCount、likedByMe/dislikedByMe/favoritedByMe、isDeleted/deletedAt/deletedBy、createdAt/updatedAt、images。                                                                                                                                                                                                                                                                                                                        |
| Gallery image   | id、assetId、url、originalUrl、thumbnailUrl、thumbnailStatus、name、mimeType、sizeBytes。url 可能是空字符串；assetId 取上传响应 asset.id。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Song            | docId、slug、title、artists、lyricists、composers、arrangers、vocals、album、tags、cover、coverThumbnail、audioUrl、lyric、lyricType、lyricPlain、lyricSource、description、releaseDate、durationMs、sources[{id,resourceType,platform,sourceId,sourceUrl,isPrimary,createdAt,updatedAt}]、playable、playableOverride、customPlatformLinks[{label,url}]、displayAlbumMode、displayAlbum、manualAlbumName、coverId、coverAlbumDocId、covers[{id,url,thumbnailUrl,isDefault,sortOrder}]、linkedAlbums[{albumDocId,albumId,albumSlug,title,artist,discNumber,trackOrder,isDisplay}]、isInstrumental、favoritedByMe、isDeleted/deletedAt/deletedBy、createdAt/updatedAt。歌曲列表通常故意省略 lyric/description。 |
| Album           | docId、slug、title、artist、cover、coverThumbnail、description、sources、releaseDate、tracks、coverId、isDeleted/deletedAt/deletedBy、covers[{id,url,thumbnailUrl,isDefault,sortOrder}]、songs[{songDocId,discNumber,trackOrder,isDisplay,song:{docId,slug,title,artists,cover,coverThumbnail}}]、createdAt/updatedAt。详情另外返回 id、规范化 discs 与完整 track DTO。                                                                                                                                                                                                                                                                                                                                       |
| Ticket listing  | id、slug、type、eventId、customEventName、eventName、eventSlug、eventLocation、quantity、ticketTier、seat、authorUid、authorPublicId、authorName、createdAt/updatedAt；详情增加 description/contact。作者/管理员私有视图还含 status、reviewNote、reviewedAt、isDeleted、deletedAt、deletedBy、deletionReason。列表普通响应不含联系资料。                                                                                                                                                                                                                                                                                                                                                                      |
| Event           | id、slug、title、location、content、timeSlots、timeStatus、ticketPrices、saleTimes、lineup、tags、externalLinks、relatedLinks、sortStart/sortEnd、封面 asset/url/name/thumbnail/status、createdByUid/Name、updatedByUid/Name、isDeleted/deletedAt/deletedBy、createdAt/updatedAt、posters[{id,assetId,url,originalUrl,thumbnailUrl,thumbnailStatus,name}]。                                                                                                                                                                                                                                                                                                                                                   |
| Upload session  | id、ownerUid、status、maxFiles、uploadedFiles、expiresAt、createdAt、updatedAt。上传响应 asset 含 id、imageMapId、publicUrl、storageKey、fileName、mimeType、sizeBytes、md5、status、reused；storageErrors 另列。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Notification    | id、userUid、type、payload、isRead、createdAt。payload 按通知 type 变化，不构成固定统一子模型。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Wiki branch     | id、pageSlug、editorUid、editorName、status、latestRevisionId、createdAt/updatedAt、page{slug,title,category}\|null。WikiRevision 含 id、pageSlug、branchId、title、content、slug、category、editorUid/Name、tags、relations、eventDate、isAutoSave、createdAt。PR 含 id、branchId、pageSlug、title/description/status、createdByUid/Name、reviewedBy/At、mergedAt、baseRevisionId、conflictData、branch/page、comments[{id,prId,authorUid,authorName,content,createdAt}]。                                                                                                                                                                                                                                   |
| Region          | code、name、fullName、level、levelName、parentCode。坐标解析结果另含 coordinate{lng,lat}、province/provinceCode、city/cityCode、district/districtCode、adcode、formattedAddress。地址搜索项含 name/address/coordinate/adcode。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| EXIF GPS        | ImageGpsResult 为 {url,gps:{latitude,longitude}\|null,error?}；批量响应另含 hasGps、mostFrequentGps、regionSuggestion。服务器会按 URL 抓取图片，调用方只应提交可信 URL。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ImageMap        | id、md5、localUrl、externalUrl、s3Url、thumbnailUrl、storageType（推断）、blurhash、thumbhash、isDeleted/deletedAt/deletedBy、createdAt。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SearchPage      | items、total、page、limit、totalPages、hasMore；整体搜索按 wiki/posts/galleries/music/albums/lyrics 分页。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Favorite        | favorites[] 每项 id/targetType/targetId/createdAt/target；target 依类型为 Wiki/Post/Song/Gallery DTO；不可见目标会过滤。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| EditLock        | id、collection、recordId、userId、username、createdAt、expiresAt。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Admin dashboard | success、data{stats,reviewQueue,system,trends}、timestamp；system 子系统各为 {data:...}\|{error}。trends 含 dates 与 posts/galleries/wiki/users 数组和 totals。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 常见请求 schema

下列 schema 由对应路由 validateBody 直接执行；未列字段会按 Zod object 默认策略处理，不要依赖传入未知字段。

| Schema / 路由                                                                            | 字段、类型、必填/默认与范围                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| registerSchema                                                                           | email 必填有效邮箱；password 必填 8–128 字符；displayName 可省略/空白视为缺省，最多50字符。                                                                                                                                          |
| loginSchema                                                                              | email 必填有效邮箱；password 必填非空字符串。                                                                                                                                                                                        |
| verifyEmailSchema                                                                        | token 必填非空字符串。重置确认 body 为 token 与 newPassword，newPassword 8–128 字符。                                                                                                                                                |
| setupInitializeSchema                                                                    | email、displayName、password 必填；displayName trim、非空、最多50；password 8–128。仅空用户表使用。                                                                                                                                  |
| createApiKeySchema                                                                       | name 必填，trim 后 1–100 字符；expiry 为 30d/90d/365d/never，默认90d。                                                                                                                                                               |
| userEmailUpdateSchema                                                                    | currentPassword 非空必填；newEmail trim 后必填有效邮箱。                                                                                                                                                                             |
| postCreateSchema / postUpdateSchema                                                      | title、section、content 都必填且非空；上限分别200、80、500 KiB；tags 最多30项/单项50；status=draft\|pending\|published；musicDocId/albumDocId 可选；locationCode/locationDetail 可 null。POST 与 PUT 共用 schema，PUT 仍全量提交。   |
| postDeleteSchema                                                                         | reason 可选（最多1000），schema 缺省对象允许空 body；删除他人仍由 handler 要求 reason。                                                                                                                                              |
| postCommentSchema                                                                        | content trim 后非空、最多5000；parentId 可 null/省略，字符串最多191。                                                                                                                                                                |
| wikiCreateSchema / wikiUpdateSchema                                                      | title/content 非空，上限200/500 KiB；category最多80；tags最多30/每项50；relations最多80条；eventDate最多32；地点字段有长度限额。Create 要 title/content/category，Update schema partial 但 handler仍强制 title/content/category。    |
| wikiRevisionSchema                                                                       | title/content/category 非空；tags/relations与 Wiki schema 同限制；eventDate 可 null；isAutoSave 为 boolean 可选。                                                                                                                    |
| ticketListingWriteSchema                                                                 | strict object；type=offer\|request；quantity整数1–10000；ticketTier必填最多100；seat最多200/默认空；description最多500 KiB/默认空；contact必填最多100 KiB；eventId 与 customEventName 必须二选一；status=draft\|pending\|published。 |
| eventWriteSchema                                                                         | title必填最多200；location最多200默认空；content最多500 KiB默认空；timeSlots、ticketPrices、saleTimes最多30项；lineup最多50项/单项100；tags最多30项/单项50；links最多20项/label最多80；coverAssetId/uploadSessionId/posters可选。    |
| galleryDeleteSchema                                                                      | reason 可选，最多1000；图库管理接口另有本人/管理员判断。                                                                                                                                                                             |
| adminBatchGalleryImagesSchema / adminBatchSongCoversSchema / adminBatchAlbumCoversSchema | 对应 imageIds/coverIds 数组必填 1–200；每项 trim 后非空，重复项去重。                                                                                                                                                                |
| adminAlbumTrackReorderSchema                                                             | tracks最多20项；每碟 disc 为 1–20 唯一整数、name trim 后非空最多120、songs最多5000；歌曲 songDocId 非空最多191，trackOrder整数0–5000；歌曲不能跨位置重复。路由另外要求完整包含当前关系集合。                                         |
| backupRestoreSchema                                                                      | confirm 必须为 true，解密 password 可选最多128字符；上传恢复还要 multipart file。                                                                                                                                                    |

parseInteger 仅在对应路由显式调用时生效；数值输入会被转整数/夹紧或回退默认，不能把这些规则推广给所有 API。详细服务手工解析字段列在各 domain 条目。

常见分页 helper parsePagination：page 默认1、最小1；limit 默认20、限制到1–100；offset=(page-1)\*limit。明确使用自定义 parseInteger 的接口覆盖此默认值；生成的逐接口参数行会注明可静态识别的字段、schema 名及处理器解析规则。

## 3. 接口索引

目录和逐接口正文由 AST 注册清单生成：334 个已挂载方法/路径模板，13 个语义向量接口为条件注册。冒号参数是必需 path segment，星号表示通配对象键；REPLACE\_ 占位 ID 必须从前序响应读取。

#### 4. 用户资料与账号

| 接口                                                                               | 用途                                           | 权限/条件          |
| ---------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------ |
| [GET /api/auth/health](#api-get-api-auth-health)                                   | 读取 auth / health                             | 公开/可选身份      |
| [GET /api/auth/me](#api-get-api-auth-me)                                           | 读取 auth / me                                 | 公开/可选身份      |
| [POST /api/auth/register](#api-post-api-auth-register)                             | 创建/提交/触发 auth / register                 | 公开/可选身份      |
| [POST /api/auth/verify-email](#api-post-api-auth-verify-email)                     | 创建/提交/触发 auth / verify email             | 公开/可选身份      |
| [POST /api/auth/resend-verification](#api-post-api-auth-resend-verification)       | 创建/提交/触发 auth / resend verification      | 公开/可选身份      |
| [POST /api/auth/password-reset/request](#api-post-api-auth-password-reset-request) | 创建/提交/触发 auth / password reset / request | 公开/可选身份      |
| [POST /api/auth/password-reset/confirm](#api-post-api-auth-password-reset-confirm) | 创建/提交/触发 auth / password reset / confirm | 公开/可选身份      |
| [POST /api/auth/login](#api-post-api-auth-login)                                   | 创建/提交/触发 auth / login                    | 公开/可选身份      |
| [POST /api/auth/wechat/login](#api-post-api-auth-wechat-login)                     | 创建/提交/触发 auth / wechat / login           | 公开/可选身份      |
| [POST /api/auth/logout](#api-post-api-auth-logout)                                 | 创建/提交/触发 auth / logout                   | 公开/可选身份      |
| [GET /api/users/me/api-keys](#api-get-api-users-me-api-keys)                       | 读取 users / me / api keys                     | Cookie 会话 + CSRF |
| [POST /api/users/me/api-keys](#api-post-api-users-me-api-keys)                     | 创建/提交/触发 users / me / api keys           | Cookie 会话 + CSRF |
| [DELETE /api/users/me/api-keys/:id](#api-delete-api-users-me-api-keys-id)          | 删除/移除 users / me / api keys                | Cookie 会话 + CSRF |
| [GET /api/users/status](#api-get-api-users-status)                                 | 读取 users / status                            | 已认证             |
| [PUT /api/users/:userId/status](#api-put-api-users-userid-status)                  | 更新/执行 users / status                       | 超级管理员         |
| [PUT /api/users/name](#api-put-api-users-name)                                     | 更新/执行 users / name                         | 已认证且未封禁     |
| [PUT /api/users/email](#api-put-api-users-email)                                   | 更新/执行 users / email                        | 已认证且未封禁     |
| [PUT /api/users/phone](#api-put-api-users-phone)                                   | 更新/执行 users / phone                        | 已认证且未封禁     |
| [PUT /api/users/password](#api-put-api-users-password)                             | 更新/执行 users / password                     | 已认证且未封禁     |
| [GET /api/users/me](#api-get-api-users-me)                                         | 读取 users / me                                | 已认证且未封禁     |
| [PATCH /api/users/me](#api-patch-api-users-me)                                     | 部分更新 users / me                            | 已认证且未封禁     |
| [DELETE /api/users/account](#api-delete-api-users-account)                         | 删除/移除 users / account                      | 已认证且未封禁     |
| [GET /api/users](#api-get-api-users)                                               | 读取 users                                     | 管理员             |
| [PATCH /api/users/:userId/role](#api-patch-api-users-userid-role)                  | 部分更新 users / role                          | 超级管理员         |
| [PUT /api/users/:userId/role](#api-put-api-users-userid-role)                      | 更新/执行 users / role                         | 超级管理员         |
| [PATCH /api/users/:userId](#api-patch-api-users-userid)                            | 部分更新 users                                 | 管理员             |
| [PUT /api/users/:userId/reset-password](#api-put-api-users-userid-reset-password)  | 更新/执行 users / reset password               | 管理员             |
| [PUT /api/users/:userId/ban](#api-put-api-users-userid-ban)                        | 更新/执行 users / ban                          | 管理员             |
| [PUT /api/users/:userId/unban](#api-put-api-users-userid-unban)                    | 更新/执行 users / unban                        | 管理员             |
| [GET /api/users/me/history](#api-get-api-users-me-history)                         | 读取 users / me / history                      | 已认证且未封禁     |
| [GET /api/users/mentions](#api-get-api-users-mentions)                             | 读取 users / mentions                          | 已认证且未封禁     |
| [GET /api/users/:userId/profile](#api-get-api-users-userid-profile)                | 读取 users / profile                           | 公开/可选身份      |
| [GET /api/users/:userId/posts](#api-get-api-users-userid-posts)                    | 读取 users / posts                             | 公开/可选身份      |
| [GET /api/users/:userId/galleries](#api-get-api-users-userid-galleries)            | 读取 users / galleries                         | 公开/可选身份      |
| [GET /api/users/:userId/wiki](#api-get-api-users-userid-wiki)                      | 读取 users / wiki                              | 公开/可选身份      |
| [GET /api/users/:userId/comments](#api-get-api-users-userid-comments)              | 读取 users / comments                          | 公开/可选身份      |
| [GET /api/users/:userId/favorites](#api-get-api-users-userid-favorites)            | 读取 users / favorites                         | 公开/可选身份      |
| [GET /api/users/:userId/history](#api-get-api-users-userid-history)                | 读取 users / history                           | 公开/可选身份      |
| [GET /api/users/:userId/likes](#api-get-api-users-userid-likes)                    | 读取 users / likes                             | 已认证             |

#### 5. 帖子与版块

| 接口                                                              | 用途                           | 权限/条件      |
| ----------------------------------------------------------------- | ------------------------------ | -------------- |
| [GET /api/sections](#api-get-api-sections)                        | 读取 sections                  | 公开/可选身份  |
| [POST /api/sections](#api-post-api-sections)                      | 创建/提交/触发 sections        | 管理员         |
| [DELETE /api/sections/:id](#api-delete-api-sections-id)           | 删除/移除 sections             | 管理员         |
| [GET /api/posts](#api-get-api-posts)                              | 读取 posts                     | 公开/可选身份  |
| [GET /api/posts/tags](#api-get-api-posts-tags)                    | 读取 posts / tags              | 公开/可选身份  |
| [POST /api/posts](#api-post-api-posts)                            | 创建/提交/触发 posts           | 已认证且未封禁 |
| [GET /api/posts/:slug](#api-get-api-posts-slug)                   | 读取 posts                     | 公开/可选身份  |
| [PUT /api/posts/:id](#api-put-api-posts-id)                       | 更新/执行 posts                | 已认证且未封禁 |
| [DELETE /api/posts/:id](#api-delete-api-posts-id)                 | 删除/移除 posts                | 已认证且未封禁 |
| [POST /api/posts/:id/like](#api-post-api-posts-id-like)           | 创建/提交/触发 posts / like    | 已认证且未封禁 |
| [DELETE /api/posts/:id/like](#api-delete-api-posts-id-like)       | 删除/移除 posts / like         | 已认证且未封禁 |
| [POST /api/posts/:id/dislike](#api-post-api-posts-id-dislike)     | 创建/提交/触发 posts / dislike | 已认证且未封禁 |
| [DELETE /api/posts/:id/dislike](#api-delete-api-posts-id-dislike) | 删除/移除 posts / dislike      | 已认证且未封禁 |
| [POST /api/posts/:id/pin](#api-post-api-posts-id-pin)             | 创建/提交/触发 posts / pin     | 管理员         |
| [DELETE /api/posts/:id/pin](#api-delete-api-posts-id-pin)         | 删除/移除 posts / pin          | 管理员         |

#### 6. 评论

| 接口                                                                            | 用途                                      | 权限/条件      |
| ------------------------------------------------------------------------------- | ----------------------------------------- | -------------- |
| [GET /api/posts/:postId/comments](#api-get-api-posts-postid-comments)           | 读取 posts / comments                     | 公开/可选身份  |
| [POST /api/posts/:postId/comments](#api-post-api-posts-postid-comments)         | 创建/提交/触发 posts / comments           | 已认证且未封禁 |
| [DELETE /api/posts/comments/:id](#api-delete-api-posts-comments-id)             | 删除/移除 posts / comments                | 已认证且未封禁 |
| [POST /api/posts/comments/:id/restore](#api-post-api-posts-comments-id-restore) | 创建/提交/触发 posts / comments / restore | 管理员         |
| [POST /api/posts/comments/:id/like](#api-post-api-posts-comments-id-like)       | 创建/提交/触发 posts / comments / like    | 已认证且未封禁 |
| [DELETE /api/posts/comments/:id/like](#api-delete-api-posts-comments-id-like)   | 删除/移除 posts / comments / like         | 已认证且未封禁 |

#### 7. Wiki 页面、分支与合并请求

| 接口                                                                                                        | 用途                                              | 权限/条件      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------- |
| [GET /api/wiki](#api-get-api-wiki)                                                                          | 读取 wiki                                         | 公开/可选身份  |
| [GET /api/mp/wiki](#api-get-api-mp-wiki)                                                                    | 读取 mp / wiki                                    | 公开/可选身份  |
| [GET /api/wiki/recommended](#api-get-api-wiki-recommended)                                                  | 读取 wiki / recommended                           | 公开/可选身份  |
| [GET /api/wiki/categories](#api-get-api-wiki-categories)                                                    | 读取 wiki / categories                            | 公开/可选身份  |
| [GET /api/wiki/tags](#api-get-api-wiki-tags)                                                                | 读取 wiki / tags                                  | 公开/可选身份  |
| [GET /api/wiki/:slug](#api-get-api-wiki-slug)                                                               | 读取 wiki                                         | 公开/可选身份  |
| [POST /api/wiki/:slug/like](#api-post-api-wiki-slug-like)                                                   | 创建/提交/触发 wiki / like                        | 已认证且未封禁 |
| [DELETE /api/wiki/:slug/like](#api-delete-api-wiki-slug-like)                                               | 删除/移除 wiki / like                             | 已认证且未封禁 |
| [POST /api/wiki/:slug/dislike](#api-post-api-wiki-slug-dislike)                                             | 创建/提交/触发 wiki / dislike                     | 已认证且未封禁 |
| [DELETE /api/wiki/:slug/dislike](#api-delete-api-wiki-slug-dislike)                                         | 删除/移除 wiki / dislike                          | 已认证且未封禁 |
| [POST /api/wiki/:slug/pin](#api-post-api-wiki-slug-pin)                                                     | 创建/提交/触发 wiki / pin                         | 管理员         |
| [DELETE /api/wiki/:slug/pin](#api-delete-api-wiki-slug-pin)                                                 | 删除/移除 wiki / pin                              | 管理员         |
| [PUT /api/wiki/:slug/pin](#api-put-api-wiki-slug-pin)                                                       | 更新/执行 wiki / pin                              | 管理员         |
| [GET /api/wiki/:slug/history](#api-get-api-wiki-slug-history)                                               | 读取 wiki / history                               | 公开/可选身份  |
| [GET /api/wiki/:slug/revisions/:revisionId](#api-get-api-wiki-slug-revisions-revisionid)                    | 读取 wiki / revisions                             | 公开/可选身份  |
| [POST /api/wiki/:slug/submit](#api-post-api-wiki-slug-submit)                                               | 创建/提交/触发 wiki / submit                      | 已认证且未封禁 |
| [POST /api/wiki](#api-post-api-wiki)                                                                        | 创建/提交/触发 wiki                               | 已认证且未封禁 |
| [PUT /api/wiki/:slug](#api-put-api-wiki-slug)                                                               | 更新/执行 wiki                                    | 已认证且未封禁 |
| [DELETE /api/wiki/:slug](#api-delete-api-wiki-slug)                                                         | 删除/移除 wiki                                    | 管理员         |
| [POST /api/wiki/:slug/branches](#api-post-api-wiki-slug-branches)                                           | 创建/提交/触发 wiki / branches                    | 已认证且未封禁 |
| [GET /api/wiki/:slug/branches](#api-get-api-wiki-slug-branches)                                             | 读取 wiki / branches                              | 已认证         |
| [GET /api/wiki/branches/mine](#api-get-api-wiki-branches-mine)                                              | 读取 wiki / branches / mine                       | 已认证且未封禁 |
| [GET /api/wiki/branches/:branchId](#api-get-api-wiki-branches-branchid)                                     | 读取 wiki / branches                              | 已认证         |
| [GET /api/wiki/branches/:branchId/revisions](#api-get-api-wiki-branches-branchid-revisions)                 | 读取 wiki / branches / revisions                  | 已认证         |
| [POST /api/wiki/branches/:branchId/revisions](#api-post-api-wiki-branches-branchid-revisions)               | 创建/提交/触发 wiki / branches / revisions        | 已认证且未封禁 |
| [POST /api/wiki/branches/:branchId/pull-request](#api-post-api-wiki-branches-branchid-pull-request)         | 创建/提交/触发 wiki / branches / pull request     | 已认证且未封禁 |
| [GET /api/wiki/pull-requests/list](#api-get-api-wiki-pull-requests-list)                                    | 读取 wiki / pull requests / list                  | 已认证         |
| [GET /api/wiki/pull-requests/:prId](#api-get-api-wiki-pull-requests-prid)                                   | 读取 wiki / pull requests                         | 已认证         |
| [GET /api/wiki/pull-requests/:prId/diff](#api-get-api-wiki-pull-requests-prid-diff)                         | 读取 wiki / pull requests / diff                  | 已认证         |
| [POST /api/wiki/pull-requests/:prId/comments](#api-post-api-wiki-pull-requests-prid-comments)               | 创建/提交/触发 wiki / pull requests / comments    | 已认证且未封禁 |
| [POST /api/wiki/pull-requests/:prId/merge](#api-post-api-wiki-pull-requests-prid-merge)                     | 创建/提交/触发 wiki / pull requests / merge       | 管理员         |
| [POST /api/wiki/pull-requests/:prId/reject](#api-post-api-wiki-pull-requests-prid-reject)                   | 创建/提交/触发 wiki / pull requests / reject      | 管理员         |
| [POST /api/wiki/branches/:branchId/resolve-conflict](#api-post-api-wiki-branches-branchid-resolve-conflict) | 创建/提交/触发 wiki / branches / resolve conflict | 已认证且未封禁 |
| [POST /api/wiki/:slug/rollback/:revisionId](#api-post-api-wiki-slug-rollback-revisionid)                    | 创建/提交/触发 wiki / rollback                    | 已认证且未封禁 |

#### 8. 图库与媒体上传

| 接口                                                                                                | 用途                                         | 权限/条件      |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------- |
| [POST /api/uploads/sessions](#api-post-api-uploads-sessions)                                        | 创建/提交/触发 uploads / sessions            | 已认证且未封禁 |
| [GET /api/uploads/sessions/:sessionId](#api-get-api-uploads-sessions-sessionid)                     | 读取 uploads / sessions                      | 已认证且未封禁 |
| [POST /api/uploads/sessions/:sessionId/files](#api-post-api-uploads-sessions-sessionid-files)       | 创建/提交/触发 uploads / sessions / files    | 已认证且未封禁 |
| [POST /api/uploads/sessions/:sessionId/finalize](#api-post-api-uploads-sessions-sessionid-finalize) | 创建/提交/触发 uploads / sessions / finalize | 已认证且未封禁 |
| [POST /api/uploads/assets/reuse](#api-post-api-uploads-assets-reuse)                                | 创建/提交/触发 uploads / assets / reuse      | 已认证且未封禁 |
| [DELETE /api/uploads/assets/:assetId](#api-delete-api-uploads-assets-assetid)                       | 删除/移除 uploads / assets                   | 已认证且未封禁 |
| [DELETE /api/uploads/sessions/:sessionId](#api-delete-api-uploads-sessions-sessionid)               | 删除/移除 uploads / sessions                 | 已认证且未封禁 |
| [DELETE /api/uploads/superbed](#api-delete-api-uploads-superbed)                                    | 删除/移除 uploads / superbed                 | 管理员         |
| [GET /api/galleries](#api-get-api-galleries)                                                        | 读取 galleries                               | 公开/可选身份  |
| [GET /api/galleries/tags](#api-get-api-galleries-tags)                                              | 读取 galleries / tags                        | 公开/可选身份  |
| [GET /api/galleries/:slug](#api-get-api-galleries-slug)                                             | 读取 galleries                               | 公开/可选身份  |
| [POST /api/galleries/:id/like](#api-post-api-galleries-id-like)                                     | 创建/提交/触发 galleries / like              | 已认证且未封禁 |
| [DELETE /api/galleries/:id/like](#api-delete-api-galleries-id-like)                                 | 删除/移除 galleries / like                   | 已认证且未封禁 |
| [POST /api/galleries/:id/dislike](#api-post-api-galleries-id-dislike)                               | 创建/提交/触发 galleries / dislike           | 已认证且未封禁 |
| [DELETE /api/galleries/:id/dislike](#api-delete-api-galleries-id-dislike)                           | 删除/移除 galleries / dislike                | 已认证且未封禁 |
| [POST /api/galleries](#api-post-api-galleries)                                                      | 创建/提交/触发 galleries                     | 已认证且未封禁 |
| [PATCH /api/galleries/:id](#api-patch-api-galleries-id)                                             | 部分更新 galleries                           | 已认证且未封禁 |
| [PATCH /api/galleries/:id/publish](#api-patch-api-galleries-id-publish)                             | 部分更新 galleries / publish                 | 已认证且未封禁 |
| [POST /api/galleries/:id/submit](#api-post-api-galleries-id-submit)                                 | 创建/提交/触发 galleries / submit            | 已认证且未封禁 |
| [DELETE /api/galleries/:id](#api-delete-api-galleries-id)                                           | 删除/移除 galleries                          | 已认证且未封禁 |
| [POST /api/galleries/:id/images](#api-post-api-galleries-id-images)                                 | 创建/提交/触发 galleries / images            | 已认证且未封禁 |
| [DELETE /api/galleries/:id/images](#api-delete-api-galleries-id-images)                             | 删除/移除 galleries / images                 | 已认证且未封禁 |
| [DELETE /api/galleries/:id/images/:imageId](#api-delete-api-galleries-id-images-imageid)            | 删除/移除 galleries / images                 | 已认证且未封禁 |
| [PATCH /api/galleries/:id/images/reorder](#api-patch-api-galleries-id-images-reorder)               | 部分更新 galleries / images / reorder        | 已认证且未封禁 |
| [GET /api/galleries/:id/comments](#api-get-api-galleries-id-comments)                               | 读取 galleries / comments                    | 公开/可选身份  |
| [POST /api/galleries/:id/comments](#api-post-api-galleries-id-comments)                             | 创建/提交/触发 galleries / comments          | 已认证且未封禁 |

#### 9. 音乐管理

| 接口                                                                                                                             | 用途                                 | 权限/条件     |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| [GET /api/music](#api-get-api-music)                                                                                             | 读取 music                           | 公开/可选身份 |
| [GET /api/music/tags](#api-get-api-music-tags)                                                                                   | 读取 music / tags                    | 公开/可选身份 |
| [POST /api/music](#api-post-api-music)                                                                                           | 创建/提交/触发 music                 | 管理员        |
| [POST /api/music/parse-url](#api-post-api-music-parse-url)                                                                       | 创建/提交/触发 music / parse url     | 管理员        |
| [POST /api/music/import](#api-post-api-music-import)                                                                             | 创建/提交/触发 music / import        | 管理员        |
| [POST /api/music/from-netease](#api-post-api-music-from-netease)                                                                 | 创建/提交/触发 music / from netease  | 管理员        |
| [POST /api/music/from-qq](#api-post-api-music-from-qq)                                                                           | 创建/提交/触发 music / from qq       | 管理员        |
| [POST /api/music/from-kugou](#api-post-api-music-from-kugou)                                                                     | 创建/提交/触发 music / from kugou    | 管理员        |
| [POST /api/music/from-baidu](#api-post-api-music-from-baidu)                                                                     | 创建/提交/触发 music / from baidu    | 管理员        |
| [POST /api/music/from-kuwo](#api-post-api-music-from-kuwo)                                                                       | 创建/提交/触发 music / from kuwo     | 管理员        |
| [GET /api/music/:docId/play-url](#api-get-api-music-docid-play-url)                                                              | 读取 music / play url                | 公开/可选身份 |
| [GET /api/music/instrumental-targets](#api-get-api-music-instrumental-targets)                                                   | 读取 music / instrumental targets    | 公开/可选身份 |
| [GET /api/music/match-suggestions](#api-get-api-music-match-suggestions)                                                         | 读取 music / match suggestions       | 公开/可选身份 |
| [GET /api/music/:slug](#api-get-api-music-slug)                                                                                  | 读取 music                           | 公开/可选身份 |
| [DELETE /api/music/:docId](#api-delete-api-music-docid)                                                                          | 删除/移除 music                      | 管理员        |
| [PATCH /api/music/:docId](#api-patch-api-music-docid)                                                                            | 部分更新 music                       | 管理员        |
| [GET /api/music/:docId/covers](#api-get-api-music-docid-covers)                                                                  | 读取 music / covers                  | 公开/可选身份 |
| [POST /api/music/:docId/covers](#api-post-api-music-docid-covers)                                                                | 创建/提交/触发 music / covers        | 管理员        |
| [DELETE /api/music/:docId/covers](#api-delete-api-music-docid-covers)                                                            | 删除/移除 music / covers             | 管理员        |
| [DELETE /api/music/:docId/covers/:coverId](#api-delete-api-music-docid-covers-coverid)                                           | 删除/移除 music / covers             | 管理员        |
| [PATCH /api/music/:docId/covers/:coverId/default](#api-patch-api-music-docid-covers-coverid-default)                             | 部分更新 music / covers / default    | 管理员        |
| [GET /api/music/:docId/albums](#api-get-api-music-docid-albums)                                                                  | 读取 music / albums                  | 公开/可选身份 |
| [POST /api/music/:docId/albums](#api-post-api-music-docid-albums)                                                                | 创建/提交/触发 music / albums        | 管理员        |
| [PATCH /api/music/:docId/albums/:albumDocId](#api-patch-api-music-docid-albums-albumdocid)                                       | 部分更新 music / albums              | 管理员        |
| [DELETE /api/music/:docId/albums/:albumDocId](#api-delete-api-music-docid-albums-albumdocid)                                     | 删除/移除 music / albums             | 管理员        |
| [GET /api/music/:docId/instrumentals](#api-get-api-music-docid-instrumentals)                                                    | 读取 music / instrumentals           | 公开/可选身份 |
| [GET /api/music/:docId/instrumental-for](#api-get-api-music-docid-instrumental-for)                                              | 读取 music / instrumental for        | 公开/可选身份 |
| [POST /api/music/:docId/instrumentals](#api-post-api-music-docid-instrumentals)                                                  | 创建/提交/触发 music / instrumentals | 管理员        |
| [DELETE /api/music/:docId/instrumentals/:instrumentalSongDocId](#api-delete-api-music-docid-instrumentals-instrumentalsongdocid) | 删除/移除 music / instrumentals      | 管理员        |
| [PATCH /api/music/:docId/custom-platforms](#api-patch-api-music-docid-custom-platforms)                                          | 部分更新 music / custom platforms    | 管理员        |
| [GET /api/music/:docId/posts](#api-get-api-music-docid-posts)                                                                    | 读取 music / posts                   | 公开/可选身份 |
| [GET /api/music/song/:id](#api-get-api-music-song-id)                                                                            | 读取 music / song                    | 公开/可选身份 |

#### 10. 专辑管理

| 接口                                                                                                   | 用途                                          | 权限/条件     |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------- |
| [GET /api/albums](#api-get-api-albums)                                                                 | 读取 albums                                   | 公开/可选身份 |
| [GET /api/albums/:slug](#api-get-api-albums-slug)                                                      | 读取 albums                                   | 公开/可选身份 |
| [GET /api/albums/:id/posts](#api-get-api-albums-id-posts)                                              | 读取 albums / posts                           | 公开/可选身份 |
| [POST /api/albums](#api-post-api-albums)                                                               | 创建/提交/触发 albums                         | 管理员        |
| [PATCH /api/albums/:docId](#api-patch-api-albums-docid)                                                | 部分更新 albums                               | 管理员        |
| [DELETE /api/albums/:docId](#api-delete-api-albums-docid)                                              | 删除/移除 albums                              | 管理员        |
| [GET /api/albums/:docId/covers](#api-get-api-albums-docid-covers)                                      | 读取 albums / covers                          | 公开/可选身份 |
| [POST /api/albums/:docId/covers](#api-post-api-albums-docid-covers)                                    | 创建/提交/触发 albums / covers                | 管理员        |
| [DELETE /api/albums/:docId/covers](#api-delete-api-albums-docid-covers)                                | 删除/移除 albums / covers                     | 管理员        |
| [DELETE /api/albums/:docId/covers/:coverId](#api-delete-api-albums-docid-covers-coverid)               | 删除/移除 albums / covers                     | 管理员        |
| [PATCH /api/albums/:docId/covers/:coverId/default](#api-patch-api-albums-docid-covers-coverid-default) | 部分更新 albums / covers / default            | 管理员        |
| [POST /api/albums/:docId/sync-covers-to-songs](#api-post-api-albums-docid-sync-covers-to-songs)        | 创建/提交/触发 albums / sync covers to songs  | 管理员        |
| [POST /api/albums/:docId/discs](#api-post-api-albums-docid-discs)                                      | 创建/提交/触发 albums / discs                 | 管理员        |
| [DELETE /api/albums/:docId/discs/:discNumber](#api-delete-api-albums-docid-discs-discnumber)           | 删除/移除 albums / discs                      | 管理员        |
| [PATCH /api/albums/:docId/tracks/reorder](#api-patch-api-albums-docid-tracks-reorder)                  | 部分更新 albums / tracks / reorder            | 管理员        |
| [POST /api/albums/:docId/sync-display-to-songs](#api-post-api-albums-docid-sync-display-to-songs)      | 创建/提交/触发 albums / sync display to songs | 管理员        |

#### 11. 活动与票务

| 接口                                                                    | 用途                            | 权限/条件      |
| ----------------------------------------------------------------------- | ------------------------------- | -------------- |
| [GET /api/ticket-listings](#api-get-api-ticket-listings)                | 读取 ticket listings            | 公开/可选身份  |
| [GET /api/ticket-listings/events](#api-get-api-ticket-listings-events)  | 读取 ticket listings / events   | 公开/可选身份  |
| [GET /api/ticket-listings/mine](#api-get-api-ticket-listings-mine)      | 读取 ticket listings / mine     | 已认证         |
| [GET /api/ticket-listings/:slug](#api-get-api-ticket-listings-slug)     | 读取 ticket listings            | 公开/可选身份  |
| [POST /api/ticket-listings](#api-post-api-ticket-listings)              | 创建/提交/触发 ticket listings  | 已认证且未封禁 |
| [PUT /api/ticket-listings/:id](#api-put-api-ticket-listings-id)         | 更新/执行 ticket listings       | 已认证且未封禁 |
| [DELETE /api/ticket-listings/:id](#api-delete-api-ticket-listings-id)   | 删除/移除 ticket listings       | 已认证且未封禁 |
| [GET /api/events](#api-get-api-events)                                  | 读取 events                     | 公开/可选身份  |
| [GET /api/events/tags](#api-get-api-events-tags)                        | 读取 events / tags              | 公开/可选身份  |
| [GET /api/events/:slug](#api-get-api-events-slug)                       | 读取 events                     | 公开/可选身份  |
| [POST /api/events](#api-post-api-events)                                | 创建/提交/触发 events           | 管理员         |
| [PUT /api/events/:id](#api-put-api-events-id)                           | 更新/执行 events                | 管理员         |
| [DELETE /api/events/:id](#api-delete-api-events-id)                     | 删除/移除 events                | 管理员         |
| [POST /api/events/:id/restore](#api-post-api-events-id-restore)         | 创建/提交/触发 events / restore | 管理员         |
| [DELETE /api/events/:id/permanent](#api-delete-api-events-id-permanent) | 删除/移除 events / permanent    | 管理员         |

#### 12. 收藏、通知与公告

| 接口                                                                     | 用途                                    | 权限/条件      |
| ------------------------------------------------------------------------ | --------------------------------------- | -------------- |
| [GET /api/notifications](#api-get-api-notifications)                     | 读取 notifications                      | 已认证         |
| [POST /api/notifications/:id/read](#api-post-api-notifications-id-read)  | 创建/提交/触发 notifications / read     | 已认证         |
| [POST /api/notifications/read-all](#api-post-api-notifications-read-all) | 创建/提交/触发 notifications / read all | 已认证         |
| [DELETE /api/notifications/:id](#api-delete-api-notifications-id)        | 删除/移除 notifications                 | 已认证         |
| [GET /api/favorites](#api-get-api-favorites)                             | 读取 favorites                          | 已认证         |
| [POST /api/favorites](#api-post-api-favorites)                           | 创建/提交/触发 favorites                | 已认证且未封禁 |
| [DELETE /api/favorites/:type/:id](#api-delete-api-favorites-type-id)     | 删除/移除 favorites                     | 已认证且未封禁 |
| [GET /api/announcements/latest](#api-get-api-announcements-latest)       | 读取 announcements / latest             | 公开/可选身份  |
| [GET /api/announcements/list](#api-get-api-announcements-list)           | 读取 announcements / list               | 公开/可选身份  |
| [GET /api/announcements](#api-get-api-announcements)                     | 读取 announcements                      | 管理员         |
| [POST /api/announcements](#api-post-api-announcements)                   | 创建/提交/触发 announcements            | 管理员         |
| [PATCH /api/announcements/:id](#api-patch-api-announcements-id)          | 部分更新 announcements                  | 管理员         |
| [DELETE /api/announcements/:id](#api-delete-api-announcements-id)        | 删除/移除 announcements                 | 管理员         |

#### 13. 搜索、地区与 EXIF

| 接口                                                                                       | 用途                                             | 权限/条件      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------- |
| [GET /api/s3/config](#api-get-api-s3-config)                                               | 读取 s3 / config                                 | 公开/可选身份  |
| [GET /api/s3/presign-upload](#api-get-api-s3-presign-upload)                               | 读取 s3 / presign upload                         | 已认证且未封禁 |
| [GET /api/s3/presign-download/\*key](#api-get-api-s3-presign-download-wildcard-key)        | 读取 s3 / presign download                       | 已认证         |
| [GET /api/s3/presign-delete/\*key](#api-get-api-s3-presign-delete-wildcard-key)            | 读取 s3 / presign delete                         | 管理员         |
| [GET /api/search](#api-get-api-search)                                                     | 读取 search                                      | 公开/可选身份  |
| [GET /api/search/text-semantic](#api-get-api-search-text-semantic)                         | 读取 search / text semantic                      | 公开/可选身份  |
| [GET /api/search/hot-keywords](#api-get-api-search-hot-keywords)                           | 读取 search / hot keywords                       | 公开/可选身份  |
| [POST /api/search/by-image](#api-post-api-search-by-image)                                 | 创建/提交/触发 search / by image                 | 公开/可选身份  |
| [GET /api/search/by-image/:sessionId](#api-get-api-search-by-image-sessionid)              | 读取 search / by image                           | 公开/可选身份  |
| [GET /api/search/semantic-search](#api-get-api-search-semantic-search)                     | 读取 search / semantic search                    | 公开/可选身份  |
| [GET /api/search/suggest](#api-get-api-search-suggest)                                     | 读取 search / suggest                            | 公开/可选身份  |
| [GET /api/image-maps](#api-get-api-image-maps)                                             | 读取 image maps                                  | 公开/可选身份  |
| [GET /api/image-maps/export](#api-get-api-image-maps-export)                               | 读取 image maps / export                         | 管理员         |
| [GET /api/image-maps/stats](#api-get-api-image-maps-stats)                                 | 读取 image maps / stats                          | 管理员         |
| [POST /api/image-maps/import](#api-post-api-image-maps-import)                             | 创建/提交/触发 image maps / import               | 管理员         |
| [POST /api/image-maps/refresh-all-blurhash](#api-post-api-image-maps-refresh-all-blurhash) | 创建/提交/触发 image maps / refresh all blurhash | 管理员         |
| [GET /api/image-maps/:id](#api-get-api-image-maps-id)                                      | 读取 image maps                                  | 公开/可选身份  |
| [POST /api/image-maps](#api-post-api-image-maps)                                           | 创建/提交/触发 image maps                        | 管理员         |
| [PATCH /api/image-maps/:id](#api-patch-api-image-maps-id)                                  | 部分更新 image maps                              | 管理员         |
| [DELETE /api/image-maps/:id](#api-delete-api-image-maps-id)                                | 删除/移除 image maps                             | 管理员         |
| [POST /api/image-maps/:id/refresh-blurhash](#api-post-api-image-maps-id-refresh-blurhash)  | 创建/提交/触发 image maps / refresh blurhash     | 管理员         |
| [POST /api/image-maps/migrate-to-s3](#api-post-api-image-maps-migrate-to-s3)               | 创建/提交/触发 image maps / migrate to s3        | 管理员         |
| [GET /api/regions](#api-get-api-regions)                                                   | 读取 regions                                     | 公开/可选身份  |
| [GET /api/regions/search](#api-get-api-regions-search)                                     | 读取 regions / search                            | 公开/可选身份  |
| [GET /api/regions/suggest](#api-get-api-regions-suggest)                                   | 读取 regions / suggest                           | 公开/可选身份  |
| [GET /api/regions/provinces](#api-get-api-regions-provinces)                               | 读取 regions / provinces                         | 公开/可选身份  |
| [GET /api/regions/cities/:provinceCode](#api-get-api-regions-cities-provincecode)          | 读取 regions / cities                            | 公开/可选身份  |
| [GET /api/regions/districts/:cityCode](#api-get-api-regions-districts-citycode)            | 读取 regions / districts                         | 公开/可选身份  |
| [GET /api/regions/resolve](#api-get-api-regions-resolve)                                   | 读取 regions / resolve                           | 公开/可选身份  |
| [POST /api/regions/resolve](#api-post-api-regions-resolve)                                 | 创建/提交/触发 regions / resolve                 | 公开/可选身份  |
| [GET /api/regions/search/address](#api-get-api-regions-search-address)                     | 读取 regions / search / address                  | 公开/可选身份  |
| [GET /api/regions/:code](#api-get-api-regions-code)                                        | 读取 regions                                     | 公开/可选身份  |
| [POST /api/exif/extract-gps](#api-post-api-exif-extract-gps)                               | 创建/提交/触发 exif / extract gps                | 已认证且未封禁 |
| [POST /api/exif/extract-gps-with-region](#api-post-api-exif-extract-gps-with-region)       | 创建/提交/触发 exif / extract gps with region    | 已认证且未封禁 |
| [GET /api/exif/extract-single](#api-get-api-exif-extract-single)                           | 读取 exif / extract single                       | 已认证且未封禁 |

#### 14. 管理后台与系统配置

| 接口                                                                                                                  | 用途                                                         | 权限/条件      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------- |
| [GET /api/admin/media-maintenance/scan](#api-get-api-admin-media-maintenance-scan)                                    | 读取 admin / media maintenance / scan                        | 管理员         |
| [POST /api/admin/media-maintenance/reconcile](#api-post-api-admin-media-maintenance-reconcile)                        | 创建/提交/触发 admin / media maintenance / reconcile         | 管理员         |
| [POST /api/admin/media-maintenance/bind-legacy](#api-post-api-admin-media-maintenance-bind-legacy)                    | 创建/提交/触发 admin / media maintenance / bind legacy       | 管理员         |
| [POST /api/admin/media-maintenance/localize](#api-post-api-admin-media-maintenance-localize)                          | 创建/提交/触发 admin / media maintenance / localize          | 管理员         |
| [POST /api/admin/media-maintenance/repair-thumbnails](#api-post-api-admin-media-maintenance-repair-thumbnails)        | 创建/提交/触发 admin / media maintenance / repair thumbnails | 管理员         |
| [POST /api/admin/media-maintenance/orphans/preview](#api-post-api-admin-media-maintenance-orphans-preview)            | 创建/提交/触发 admin / media maintenance / orphans           | 管理员         |
| [POST /api/admin/media-maintenance/orphans/delete](#api-post-api-admin-media-maintenance-orphans-delete)              | 创建/提交/触发 admin / media maintenance / orphans           | 超级管理员     |
| [GET /api/admin/review-queue/count](#api-get-api-admin-review-queue-count)                                            | 读取 admin / review queue / count                            | 管理员         |
| [GET /api/admin/review-queue](#api-get-api-admin-review-queue)                                                        | 读取 admin / review queue                                    | 管理员         |
| [PUT /api/admin/review-queue/:id/approve](#api-put-api-admin-review-queue-id-approve)                                 | 更新/执行 admin / review queue / approve                     | 管理员         |
| [PUT /api/admin/review-queue/:id/reject](#api-put-api-admin-review-queue-id-reject)                                   | 更新/执行 admin / review queue / reject                      | 管理员         |
| [POST /api/admin/review/:type/:id/:action](#api-post-api-admin-review-type-id-action)                                 | 创建/提交/触发 admin / review                                | 管理员         |
| [GET /api/admin/sensitive-words](#api-get-api-admin-sensitive-words)                                                  | 读取 admin / sensitive words                                 | 管理员         |
| [POST /api/admin/sensitive-words](#api-post-api-admin-sensitive-words)                                                | 创建/提交/触发 admin / sensitive words                       | 超级管理员     |
| [DELETE /api/admin/sensitive-words/:id](#api-delete-api-admin-sensitive-words-id)                                     | 删除/移除 admin / sensitive words                            | 超级管理员     |
| [GET /api/admin/locks](#api-get-api-admin-locks)                                                                      | 读取 admin / locks                                           | 管理员         |
| [POST /api/admin/locks](#api-post-api-admin-locks)                                                                    | 创建/提交/触发 admin / locks                                 | 已认证且未封禁 |
| [DELETE /api/admin/locks/:id](#api-delete-api-admin-locks-id)                                                         | 删除/移除 admin / locks                                      | 已认证且未封禁 |
| [DELETE /api/admin/locks](#api-delete-api-admin-locks)                                                                | 删除/移除 admin / locks                                      | 管理员         |
| [GET /api/admin/moderation_logs](#api-get-api-admin-moderation-logs)                                                  | 读取 admin / moderation logs                                 | 管理员         |
| [GET /api/admin/ban_logs](#api-get-api-admin-ban-logs)                                                                | 读取 admin / ban logs                                        | 管理员         |
| [PATCH /api/admin/music/batch-display](#api-patch-api-admin-music-batch-display)                                      | 部分更新 admin / music / batch display                       | 管理员         |
| [POST /api/admin/batch-delete-posts](#api-post-api-admin-batch-delete-posts)                                          | 创建/提交/触发 admin / batch delete posts                    | 管理员         |
| [POST /api/admin/batch-delete-galleries](#api-post-api-admin-batch-delete-galleries)                                  | 创建/提交/触发 admin / batch delete galleries                | 管理员         |
| [POST /api/admin/batch-delete-comments](#api-post-api-admin-batch-delete-comments)                                    | 创建/提交/触发 admin / batch delete comments                 | 管理员         |
| [GET /api/admin/wiki-links/scan](#api-get-api-admin-wiki-links-scan)                                                  | 读取 admin / wiki links / scan                               | 管理员         |
| [GET /api/admin/wiki-links/:slug](#api-get-api-admin-wiki-links-slug)                                                 | 读取 admin / wiki links                                      | 管理员         |
| [PUT /api/admin/wiki-links/:id](#api-put-api-admin-wiki-links-id)                                                     | 更新/执行 admin / wiki links                                 | 管理员         |
| [POST /api/admin/wiki-links/update](#api-post-api-admin-wiki-links-update)                                            | 创建/提交/触发 admin / wiki links / update                   | 管理员         |
| [POST /api/admin/wiki-links/switch-storage](#api-post-api-admin-wiki-links-switch-storage)                            | 创建/提交/触发 admin / wiki links / switch storage           | 管理员         |
| [POST /api/admin/wiki-links/sync-with-imagemap](#api-post-api-admin-wiki-links-sync-with-imagemap)                    | 创建/提交/触发 admin / wiki links / sync with imagemap       | 管理员         |
| [POST /api/admin/backup/create](#api-post-api-admin-backup-create)                                                    | 创建/提交/触发 admin / backup / create                       | 超级管理员     |
| [GET /api/admin/backup/list](#api-get-api-admin-backup-list)                                                          | 读取 admin / backup / list                                   | 超级管理员     |
| [POST /api/admin/backup/:filename/note](#api-post-api-admin-backup-filename-note)                                     | 创建/提交/触发 admin / backup / note                         | 超级管理员     |
| [POST /api/admin/backup/:filename/download](#api-post-api-admin-backup-filename-download)                             | 创建/提交/触发 admin / backup / download                     | 超级管理员     |
| [POST /api/admin/backup/restore](#api-post-api-admin-backup-restore)                                                  | 创建/提交/触发 admin / backup / restore                      | 超级管理员     |
| [POST /api/admin/backup/:filename/restore](#api-post-api-admin-backup-filename-restore)                               | 创建/提交/触发 admin / backup / restore                      | 超级管理员     |
| [POST /api/admin/backup/media-reports/:filename/download](#api-post-api-admin-backup-media-reports-filename-download) | 创建/提交/触发 admin / backup / media reports                | 超级管理员     |
| [POST /api/admin/backup/:filename/delete](#api-post-api-admin-backup-filename-delete)                                 | 创建/提交/触发 admin / backup / delete                       | 超级管理员     |
| [POST /api/admin/wiki-categories](#api-post-api-admin-wiki-categories)                                                | 创建/提交/触发 admin / wiki categories                       | 管理员         |
| [PATCH /api/admin/wiki-categories/:id](#api-patch-api-admin-wiki-categories-id)                                       | 部分更新 admin / wiki categories                             | 管理员         |
| [GET /api/admin/:tab](#api-get-api-admin-tab)                                                                         | 读取 admin                                                   | 管理员         |
| [GET /api/admin/:tab/:id](#api-get-api-admin-tab-id)                                                                  | 读取 admin                                                   | 管理员         |
| [DELETE /api/admin/:tab/:id](#api-delete-api-admin-tab-id)                                                            | 删除/移除 admin                                              | 管理员         |
| [POST /api/admin/:tab/:id/restore](#api-post-api-admin-tab-id-restore)                                                | 创建/提交/触发 admin / restore                               | 管理员         |
| [DELETE /api/admin/:tab/:id/permanent](#api-delete-api-admin-tab-id-permanent)                                        | 删除/移除 admin / permanent                                  | 管理员         |
| [GET /api/admin/media-health/scan](#api-get-api-admin-media-health-scan)                                              | 读取 admin / media health / scan                             | 管理员         |
| [POST /api/admin/media-health/cleanup](#api-post-api-admin-media-health-cleanup)                                      | 创建/提交/触发 admin / media health / cleanup                | 管理员         |
| [GET /api/admin/dashboard](#api-get-api-admin-dashboard)                                                              | 读取 admin / dashboard                                       | 管理员         |
| [GET /api/admin/rate-limits/config](#api-get-api-admin-rate-limits-config)                                            | 读取 admin / rate limits / config                            | 超级管理员     |
| [PATCH /api/admin/rate-limits/config](#api-patch-api-admin-rate-limits-config)                                        | 部分更新 admin / rate limits / config                        | 超级管理员     |
| [POST /api/admin/rate-limits/config/reset](#api-post-api-admin-rate-limits-config-reset)                              | 创建/提交/触发 admin / rate limits / config                  | 超级管理员     |
| [GET /api/admin/runtime-config](#api-get-api-admin-runtime-config)                                                    | 读取 admin / runtime config                                  | 超级管理员     |
| [PATCH /api/admin/runtime-config](#api-patch-api-admin-runtime-config)                                                | 部分更新 admin / runtime config                              | 超级管理员     |
| [POST /api/admin/runtime-config/reset](#api-post-api-admin-runtime-config-reset)                                      | 创建/提交/触发 admin / runtime config / reset                | 超级管理员     |
| [GET /api/admin/secrets-config](#api-get-api-admin-secrets-config)                                                    | 读取 admin / secrets config                                  | 超级管理员     |
| [PATCH /api/admin/secrets-config](#api-patch-api-admin-secrets-config)                                                | 部分更新 admin / secrets config                              | 超级管理员     |
| [GET /api/admin/disk/status](#api-get-api-admin-disk-status)                                                          | 读取 admin / disk / status                                   | 管理员         |
| [GET /api/admin/disk/config](#api-get-api-admin-disk-config)                                                          | 读取 admin / disk / config                                   | 管理员         |
| [PUT /api/admin/disk/config](#api-put-api-admin-disk-config)                                                          | 更新/执行 admin / disk / config                              | 管理员         |
| [POST /api/admin/disk/config/reset](#api-post-api-admin-disk-config-reset)                                            | 创建/提交/触发 admin / disk / config                         | 管理员         |
| [POST /api/admin/disk/check](#api-post-api-admin-disk-check)                                                          | 创建/提交/触发 admin / disk / check                          | 管理员         |
| [POST /api/admin/disk/monitor/stop](#api-post-api-admin-disk-monitor-stop)                                            | 创建/提交/触发 admin / disk / monitor                        | 管理员         |
| [POST /api/admin/disk/monitor/resume](#api-post-api-admin-disk-monitor-resume)                                        | 创建/提交/触发 admin / disk / monitor                        | 管理员         |
| [GET /api/admin/variants/stats](#api-get-api-admin-variants-stats)                                                    | 读取 admin / variants / stats                                | 管理员         |
| [GET /api/admin/cloud-sync/stats](#api-get-api-admin-cloud-sync-stats)                                                | 读取 admin / cloud sync / stats                              | 管理员         |
| [POST /api/admin/rebuild-all-variants](#api-post-api-admin-rebuild-all-variants)                                      | 创建/提交/触发 admin / rebuild all variants                  | 管理员         |
| [GET /api/admin/rebuild-status/:jobId](#api-get-api-admin-rebuild-status-jobid)                                       | 读取 admin / rebuild status                                  | 管理员         |
| [GET /api/admin/cleanup/stats](#api-get-api-admin-cleanup-stats)                                                      | 读取 admin / cleanup / stats                                 | 管理员         |
| [GET /api/config/gallery-access](#api-get-api-config-gallery-access)                                                  | 读取 config / gallery access                                 | 公开/可选身份  |
| [GET /api/config/features](#api-get-api-config-features)                                                              | 读取 config / features                                       | 公开/可选身份  |
| [GET /api/config/admin-permissions](#api-get-api-config-admin-permissions)                                            | 读取 config / admin permissions                              | 超级管理员     |
| [GET /api/config/registration/admin](#api-get-api-config-registration-admin)                                          | 读取 config / registration / admin                           | 超级管理员     |
| [PATCH /api/config/registration](#api-patch-api-config-registration)                                                  | 部分更新 config / registration                               | 超级管理员     |
| [GET /api/config/search-hot-keywords/admin](#api-get-api-config-search-hot-keywords-admin)                            | 读取 config / search hot keywords / admin                    | 超级管理员     |
| [PATCH /api/config/search-hot-keywords](#api-patch-api-config-search-hot-keywords)                                    | 部分更新 config / search hot keywords                        | 超级管理员     |
| [GET /api/config/email-verification](#api-get-api-config-email-verification)                                          | 读取 config / email verification                             | 公开/可选身份  |
| [GET /api/config/email-verification/admin](#api-get-api-config-email-verification-admin)                              | 读取 config / email verification / admin                     | 超级管理员     |
| [PATCH /api/config/email-verification](#api-patch-api-config-email-verification)                                      | 部分更新 config / email verification                         | 超级管理员     |
| [GET /api/config/image-preference](#api-get-api-config-image-preference)                                              | 读取 config / image preference                               | 公开/可选身份  |
| [PATCH /api/config/image-preference](#api-patch-api-config-image-preference)                                          | 部分更新 config / image preference                           | 管理员         |
| [GET /api/config/image-sync](#api-get-api-config-image-sync)                                                          | 读取 config / image sync                                     | 管理员         |
| [POST /api/config/image-sync](#api-post-api-config-image-sync)                                                        | 创建/提交/触发 config / image sync                           | 管理员         |
| [DELETE /api/config/image-sync/:taskId](#api-delete-api-config-image-sync-taskid)                                     | 删除/移除 config / image sync                                | 管理员         |
| [GET /api/config/s3/config](#api-get-api-config-s3-config)                                                            | 读取 config / s3 / config                                    | 管理员         |
| [GET /api/config/s3/presign-upload](#api-get-api-config-s3-presign-upload)                                            | 读取 config / s3 / presign upload                            | 已认证且未封禁 |
| [GET /api/config/s3/presign-download/\*key](#api-get-api-config-s3-presign-download-wildcard-key)                     | 读取 config / s3 / presign download                          | 已认证         |
| [GET /api/config/s3/presign-delete/\*key](#api-get-api-config-s3-presign-delete-wildcard-key)                         | 读取 config / s3 / presign delete                            | 管理员         |

#### 15. 语义检索与运维任务

| 接口                                                                                 | 用途                                            | 权限/条件        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------- |
| [GET /api/embeddings/status](#api-get-api-embeddings-status)                         | 读取 embeddings / status                        | 管理员；条件注册 |
| [POST /api/embeddings/enqueue-missing](#api-post-api-embeddings-enqueue-missing)     | 创建/提交/触发 embeddings / enqueue missing     | 管理员；条件注册 |
| [POST /api/embeddings/sync-batch](#api-post-api-embeddings-sync-batch)               | 创建/提交/触发 embeddings / sync batch          | 管理员；条件注册 |
| [GET /api/embeddings/errors](#api-get-api-embeddings-errors)                         | 读取 embeddings / errors                        | 管理员；条件注册 |
| [POST /api/embeddings/retry-failed](#api-post-api-embeddings-retry-failed)           | 创建/提交/触发 embeddings / retry failed        | 管理员；条件注册 |
| [POST /api/embeddings/rebuild-all](#api-post-api-embeddings-rebuild-all)             | 创建/提交/触发 embeddings / rebuild all         | 管理员；条件注册 |
| [POST /api/embeddings/sync-wiki](#api-post-api-embeddings-sync-wiki)                 | 创建/提交/触发 embeddings / sync wiki           | 管理员；条件注册 |
| [POST /api/embeddings/sync-post](#api-post-api-embeddings-sync-post)                 | 创建/提交/触发 embeddings / sync post           | 管理员；条件注册 |
| [GET /api/embeddings/text/status](#api-get-api-embeddings-text-status)               | 读取 embeddings / text / status                 | 管理员；条件注册 |
| [POST /api/embeddings/text/enqueue](#api-post-api-embeddings-text-enqueue)           | 创建/提交/触发 embeddings / text / enqueue      | 管理员；条件注册 |
| [POST /api/embeddings/text/sync](#api-post-api-embeddings-text-sync)                 | 创建/提交/触发 embeddings / text / sync         | 管理员；条件注册 |
| [POST /api/embeddings/text/retry-failed](#api-post-api-embeddings-text-retry-failed) | 创建/提交/触发 embeddings / text / retry failed | 管理员；条件注册 |
| [POST /api/embeddings/text/rebuild-all](#api-post-api-embeddings-text-rebuild-all)   | 创建/提交/触发 embeddings / text / rebuild all  | 管理员；条件注册 |

#### 16. 仅网页登录、初始化及停用入口

| 接口                                                         | 用途                              | 权限/条件     |
| ------------------------------------------------------------ | --------------------------------- | ------------- |
| [GET /api/setup/status](#api-get-api-setup-status)           | 读取 setup / status               | 公开/可选身份 |
| [POST /api/setup/initialize](#api-post-api-setup-initialize) | 创建/提交/触发 setup / initialize | 公开/可选身份 |

## 4. 用户资料与账号

### 认证、邮箱与密钥

- GET /api/auth/health：公开，200 返回 status 与 timestamp。
- GET /api/auth/me：可选认证；未登录返回 {user:null}，登录后返回兼容身份 DTO。
- POST /api/auth/register：JSON email、password 必填，displayName 可选；成功 201 {success,requiresEmailVerification,verificationEmailSent,user}。重复邮箱 409；注册关闭或尚未初始化返回 403 与 REGISTRATION_DISABLED/SETUP_REQUIRED。当前 handler 的 requiresEmailVerification 返回 false，不据功能配置推断为 true。
- POST /api/auth/verify-email：JSON token；成功 {success,purpose}；token 无效/过期为 400 并带 EMAIL_VERIFICATION 错误 code。
- POST /api/auth/resend-verification：JSON email；为避免泄漏账户是否存在，成功消息相同；邮箱验证功能关闭返回 400 EMAIL_VERIFICATION_DISABLED。
- POST /api/auth/password-reset/request：JSON email；邮件服务需配置；对未知邮箱仍用统一成功消息。
- POST /api/auth/password-reset/confirm：JSON token、newPassword；一次性 token 检查、作废及改密在事务中完成；无效/过期 token 为 400。
- POST /api/auth/login：JSON email、password；成功建立网站 Cookie 会话并返回 {user}；错误凭据 401。有效 API key 调用 403 API_KEY_SESSION_FORBIDDEN。
- POST /api/auth/wechat/login：JSON code 必填，displayName/photoURL 可选；需要微信小程序服务凭证。成功建立 Cookie 会话；有效 API key 调用 403 API_KEY_SESSION_FORBIDDEN。
- POST /api/auth/logout：清除登录 Cookie，返回 {success:true}；Bearer key 调用 403 API_KEY_SESSION_FORBIDDEN。
- GET/POST/DELETE /api/users/me/api-keys：Cookie-only。列表 {keys:[{id,name,prefix,createdAt,expiresAt,lastUsedAt,revokedAt}]}；创建 body name（1–100 字符）、expiry（30d/90d/365d/never，默认 90d），201 {key,token}，token 只返回一次；DELETE :id 撤销当前账户自己的 key。写请求需网站 XSRF。

```bash
curl --fail-with-body -H 'Content-Type: application/json' \
  --data '{"email":"user@example.invalid","password":"替换为站点接受的密码","displayName":"示例用户"}' \
  "$BASE_URL/api/auth/register"
```

### 个人资料与个人内容

- GET /api/users/me：认证且未封禁，返回 {user}；包含 uid/publicId、邮箱、角色、资料、头像 asset ID、邮箱验证与时间戳。
- GET /api/users/status：需认证，读取自己的 status、role、banReason、bannedAt、preferences 等状态；404 表示账户不存在。
- PATCH /api/users/me：需认证且未封禁，仅更新提交字段：displayName、signature、bio、preferences、photoURL、photoAssetId。displayName最多50字符、signature最多120、bio最多500 KiB、preferences最多2 KiB；空 body 400。preferences 对象与现有对象浅合并；本站上传头像需同时提供本人的 ready assetId 与对应 URL，清除头像使用两个 null。成功 {user}。
- PUT /api/users/name：body displayName；按统一名称规则校验。
- PUT /api/users/email：body currentPassword、newEmail；需要当前密码；邮箱变更会清除 emailVerifiedAt 并使未用验证 token 失效。邮箱冲突 409。
- PUT /api/users/password：body currentPassword、newPassword；当前密码错误 401，新密码按服务端规则校验。Bearer 调用只返回 {success:true}，不会签发网页登录会话；不撤销 API key。
- PUT /api/users/phone：目前停用，返回 501 USER_PHONE_NOT_IMPLEMENTED 类错误正文（以实际 error 文本为准）。
- DELETE /api/users/account：软注销账户、清除个人资料/头像、封禁账户并撤销未撤销密钥；返回 {success:true}。不等同数据库物理删除。
- GET /api/users：管理员最近 100 个账户，返回 {users}，没有分页参数。
- PUT /api/users/:userId/status：超级管理员；body status=active|banned，可选 banReason；写用户封禁日志。
- PUT/PATCH /api/users/:userId/role：超级管理员；body role、可选 currentPassword。不能改自己。变更任何超级管理员身份要通过运行时开关且验证当前密码；不能降级最后一名 active 超级管理员。
- PATCH /api/users/:userId：管理员修改普通用户；不可编辑自己或管理员。body 可选 displayName、signature、bio、email、emailVerified、newPassword，至少一项；邮件/密码 token 按变更作废。
- PUT /api/users/:userId/reset-password：管理员重置他人密码；不能重置自己，管理员只可重置普通用户；body newPassword。
- PUT /api/users/:userId/ban、PUT /api/users/:userId/unban：管理员对普通用户封禁/解封；封禁需要 reason 或 note；写用户封禁日志。
- GET /api/users/me/history：需认证；query type=wiki|post|music、limit 默认 20/最大 100、offset 默认 0；返回 history 与 pagination。
- GET /api/users/mentions：需认证；query q、limit 默认 8/范围 1–20；空 q 返回 {users:[]}。
- GET /api/users/:userId/profile：路径 userId 实际传 publicId；公开 DTO 附 isSelf、canViewFavorites/canViewHistory 等。
- GET /api/users/:userId/posts|galleries|wiki|comments|favorites|history：路径 userId 实际传 publicId。内容按目标可见性过滤；收藏/历史要用户公开偏好或本人/管理员权限。子资源 ID 仍遵循各自 ID 类型。各列表分页字段以逐接口条目为准。
- GET /api/users/:userId/likes：需认证；用户只能看自己的点赞，管理员可查看他人。返回 likes、total、page、limit。

### 逐接口契约（39 项）

<a id="api-get-api-auth-health"></a>

### GET /api/auth/health

- 用途：读取 auth / health；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>status</code>、<code>timestamp</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/auth/health"
```

<a id="api-get-api-auth-me"></a>

### GET /api/auth/me

- 用途：读取 auth / me；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/auth/me"
```

<a id="api-post-api-auth-register"></a>

### POST /api/auth/register

- 用途：创建/提交/触发 auth / register；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 authRateLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart displayName: optional string；email: required string；password: required string；validateBody schema registerSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>success</code>、<code>requiresEmailVerification</code>、<code>verificationEmailSent</code>、<code>user</code>；HTTP 400: <code>error</code>；HTTP 403: <code>response from registrationClosedPayload</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>；HTTP 503: <code>error</code>、<code>code</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 403, 409, 500, 503。HTTP 400: 邮箱和密码不能为空；HTTP 409: 该邮箱已注册；HTTP 500: 注册失败，请稍后重试。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"displayName":"文档测试用户","email":"user@example.invalid","password":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/auth/register"
```

<a id="api-post-api-auth-verify-email"></a>

### POST /api/auth/verify-email

- 用途：创建/提交/触发 auth / verify email；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 emailVerificationLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart token: required string；validateBody schema verifyEmailSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>purpose</code>；HTTP 400: <code>error</code>、<code>code</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 邮箱验证失败，请稍后重试。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"token":"REPLACE_WITH_TOKEN"}' "$BASE_URL/api/auth/verify-email"
```

<a id="api-post-api-auth-resend-verification"></a>

### POST /api/auth/resend-verification

- 用途：创建/提交/触发 auth / resend verification；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 emailVerificationLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart email: required string；validateBody schema resendEmailVerificationSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>；HTTP 400: <code>error</code>、<code>code</code>；HTTP 500: <code>error</code>；HTTP 503: <code>error</code>、<code>code</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500, 503。HTTP 400: 邮箱验证功能未开启；HTTP 500: 验证邮件发送失败，请稍后重试；code EMAIL_VERIFICATION_DISABLED。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"email":"user@example.invalid"}' "$BASE_URL/api/auth/resend-verification"
```

<a id="api-post-api-auth-password-reset-request"></a>

### POST /api/auth/password-reset/request

- 用途：创建/提交/触发 auth / password reset / request；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 passwordResetRequestLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart email: required string；validateBody schema passwordResetRequestSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>；HTTP 400: <code>error</code>、<code>code</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 400: 密码找回功能未开启；HTTP 500: 密码重置邮件发送失败，请稍后重试；code PASSWORD_RESET_DISABLED。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"email":"user@example.invalid"}' "$BASE_URL/api/auth/password-reset/request"
```

<a id="api-post-api-auth-password-reset-confirm"></a>

### POST /api/auth/password-reset/confirm

- 用途：创建/提交/触发 auth / password reset / confirm；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 passwordResetConfirmLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart newPassword: required string；token: required string；validateBody schema passwordResetConfirmSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>、<code>code</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 密码重置失败，请稍后重试。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"newPassword":"REPLACE_WITH_TEST_PASSWORD","token":"REPLACE_WITH_TOKEN"}' "$BASE_URL/api/auth/password-reset/confirm"
```

<a id="api-post-api-auth-login"></a>

### POST /api/auth/login

- 用途：创建/提交/触发 auth / login；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 authRateLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart email: required string；password: required string；validateBody schema loginSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 400: <code>error</code>；HTTP 401: <code>error</code>；HTTP 403: <code>error</code>、<code>code</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 邮箱和密码不能为空；HTTP 401: 邮箱或密码错误；HTTP 403: API 密钥不能获取登录会话；HTTP 500: 登录失败，请稍后重试；code API_KEY_SESSION_FORBIDDEN。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"email":"user@example.invalid","password":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/auth/login"
```

<a id="api-post-api-auth-wechat-login"></a>

### POST /api/auth/wechat/login

- 用途：创建/提交/触发 auth / wechat / login；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。限流器 authRateLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart code: required string；displayName: optional string；photoURL: optional string|null; when using local asset must match asset URL。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>、<code>code</code>、<code>response from registrationClosedPayload</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 403, 500。HTTP 400: code 不能为空；HTTP 403: API 密钥不能获取登录会话；HTTP 500: 登录服务暂时不可用，请稍后重试；code API_KEY_SESSION_FORBIDDEN。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"code":"REPLACE_WITH_CODE","displayName":"文档测试用户","photoURL":"REPLACE_PHOTOURL"}' "$BASE_URL/api/auth/wechat/login"
```

<a id="api-post-api-auth-logout"></a>

### POST /api/auth/logout

- 用途：创建/提交/触发 auth / logout；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 403: <code>error</code>、<code>code</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 403。HTTP 403: API 密钥不能获取登录会话；code API_KEY_SESSION_FORBIDDEN。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST "$BASE_URL/api/auth/logout"
```

<a id="api-get-api-users-me-api-keys"></a>

### GET /api/users/me/api-keys

- 用途：读取 users / me / api keys；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：Cookie 会话 + CSRF。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>keys</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 403。HTTP 403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -b "$COOKIE_JAR" -H "X-XSRF-Token: $XSRF_TOKEN" "$BASE_URL/api/users/me/api-keys"
```

<a id="api-post-api-users-me-api-keys"></a>

### POST /api/users/me/api-keys

- 用途：创建/提交/触发 users / me / api keys；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：Cookie 会话 + CSRF。限流器 profileLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart expiry: required '30d' | '90d' | '365d' | 'never'；name: required string；validateBody schema createApiKeySchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>key</code>、<code>token</code>；DTO transformer toApiKeyResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 403。HTTP 400/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -b "$COOKIE_JAR" -H "X-XSRF-Token: $XSRF_TOKEN" -H 'Content-Type: application/json' --data '{"expiry":"90d","name":"文档测试名称"}' "$BASE_URL/api/users/me/api-keys"
```

<a id="api-delete-api-users-me-api-keys-id"></a>

### DELETE /api/users/me/api-keys/:id

- 用途：删除/移除 users / me / api keys；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：Cookie 会话 + CSRF。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 403, 404。HTTP 400: API 密钥 ID 不能为空；HTTP 404: API 密钥不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -b "$COOKIE_JAR" -H "X-XSRF-Token: $XSRF_TOKEN" "$BASE_URL/api/users/me/api-keys/REPLACE_ID"
```

<a id="api-get-api-users-status"></a>

### GET /api/users/status

- 用途：读取 users / status；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 用户不存在；HTTP 500: 获取用户状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/status"
```

<a id="api-put-api-users-userid-status"></a>

### PUT /api/users/:userId/status

- 用途：更新/执行 users / status；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：超级管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart banReason: optional string；status: required UserStatus。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 无效用户 / 无效状态；HTTP 500: 更新用户状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"banReason":"REPLACE_BANREASON","status":"draft"}' "$BASE_URL/api/users/REPLACE_USERID/status"
```

<a id="api-put-api-users-name"></a>

### PUT /api/users/name

- 用途：更新/执行 users / name；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart displayName: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>user</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 更新昵称失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"displayName":"文档测试用户"}' "$BASE_URL/api/users/name"
```

<a id="api-put-api-users-email"></a>

### PUT /api/users/email

- 用途：更新/执行 users / email；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。限流器 profileLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart currentPassword: required string；newEmail: required string；validateBody schema userEmailUpdateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>requiresEmailVerification</code>、<code>message</code>；HTTP 400: <code>error</code>；HTTP 401: <code>error</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 409, 500。HTTP 400: 当前密码不正确 / 新邮箱不能与当前邮箱相同；HTTP 401: 当前密码不正确；HTTP 409: 该邮箱已注册；HTTP 500: 邮箱更新失败，请稍后重试。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"currentPassword":"REPLACE_WITH_TEST_PASSWORD","newEmail":"new-user@example.invalid"}' "$BASE_URL/api/users/email"
```

<a id="api-put-api-users-phone"></a>

### PUT /api/users/phone

- 用途：更新/执行 users / phone；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart phone: required string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；HTTP 501: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：400, 401, 403, 500, 501。HTTP 400: 手机号不能为空；HTTP 500: 更新手机号失败；HTTP 501: 手机号功能暂未启用。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"phone":"REPLACE_PHONE"}' "$BASE_URL/api/users/phone"
```

<a id="api-put-api-users-password"></a>

### PUT /api/users/password

- 用途：更新/执行 users / password；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart currentPassword: required string；newPassword: required string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 401: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 密码不能为空 / 当前密码不正确；HTTP 401: 当前密码不正确；HTTP 500: 更新密码失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"currentPassword":"REPLACE_WITH_TEST_PASSWORD","newPassword":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/users/password"
```

<a id="api-get-api-users-me"></a>

### GET /api/users/me

- 用途：读取 users / me；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 用户不存在；HTTP 500: 获取用户信息失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/me"
```

<a id="api-patch-api-users-me"></a>

### PATCH /api/users/me

- 用途：部分更新 users / me；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。限流器 profileLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart displayName?:string≤50; signature?:string≤120; bio?:string≤500KiB; preferences?:JSON object≤2KiB shallow-merge; photoURL and photoAssetId must be sent together, both null clears avatar；解析 schema self profile partial object。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>user</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 个人简介不能超过500KB / 偏好设置不能超过2KB / 头像 URL 与资源 ID 必须同时提交 / 头像地址不合法 / 头像资源 ID 不合法 / 本站头像必须提交拥有的媒体资源 ID / 清除头像时不能提交媒体资源 ID / 没有要更新的字段；HTTP 500: 更新用户资料失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"signature":"API 更新签名"}' "$BASE_URL/api/users/me"
```

<a id="api-delete-api-users-account"></a>

### DELETE /api/users/account

- 用途：删除/移除 users / account；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 注销账户失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/users/account"
```

<a id="api-get-api-users"></a>

### GET /api/users

- 用途：读取 users；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>users</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取用户列表失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users"
```

<a id="api-patch-api-users-userid-role"></a>

### PATCH /api/users/:userId/role

- 用途：部分更新 users / role；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：超级管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart role required enum user|admin|super_admin; currentPassword?:string; required by handler when super_admin identity changes；validateBody schema adminUpdateUserRoleSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：由领域 transformer/helper 构造；包装/嵌套模型见第4章，不能假设统一 data。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400/401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"role":"user"}' "$BASE_URL/api/users/REPLACE_USERID/role"
```

<a id="api-put-api-users-userid-role"></a>

### PUT /api/users/:userId/role

- 用途：更新/执行 users / role；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：超级管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart role required enum user|admin|super_admin; currentPassword?:string; required by handler when super_admin identity changes；validateBody schema adminUpdateUserRoleSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：由领域 transformer/helper 构造；包装/嵌套模型见第4章，不能假设统一 data。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400/401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"role":"user"}' "$BASE_URL/api/users/REPLACE_USERID/role"
```

<a id="api-patch-api-users-userid"></a>

### PATCH /api/users/:userId

- 用途：部分更新 users；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart bio: optional string；displayName: optional string；email: optional string；emailVerified: optional boolean；newPassword: optional string；signature: optional string；validateBody schema adminUpdateUserSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>user</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 409, 500。HTTP 400: 无效用户 / 不能编辑自己的资料；HTTP 403: 只能编辑普通用户；HTTP 404: 用户不存在；HTTP 409: 该邮箱已注册；HTTP 500: 更新用户资料失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"bio":"REPLACE_BIO","displayName":"文档测试用户","email":"user@example.invalid","emailVerified":"REPLACE_EMAILVERIFIED","newPassword":"REPLACE_WITH_TEST_PASSWORD","signature":"REPLACE_SIGNATURE"}' "$BASE_URL/api/users/REPLACE_USERID"
```

<a id="api-put-api-users-userid-reset-password"></a>

### PUT /api/users/:userId/reset-password

- 用途：更新/执行 users / reset password；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart newPassword: required string；validateBody schema adminResetUserPasswordSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效用户 / 不能重置自己的密码；HTTP 403: 只能重置普通用户的密码；HTTP 404: 用户不存在；HTTP 500: 重置密码失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"newPassword":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/users/REPLACE_USERID/reset-password"
```

<a id="api-put-api-users-userid-ban"></a>

### PUT /api/users/:userId/ban

- 用途：更新/执行 users / ban；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart note: optional string；reason: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效用户 / 不能封禁自己 / 请输入封禁原因；HTTP 403: 只能封禁普通用户；HTTP 404: 用户不存在；HTTP 500: 封禁用户失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作","reason":"隔离测试操作"}' "$BASE_URL/api/users/REPLACE_USERID/ban"
```

<a id="api-put-api-users-userid-unban"></a>

### PUT /api/users/:userId/unban

- 用途：更新/执行 users / unban；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：管理员。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart note: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUserResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效用户；HTTP 403: 只能解封普通用户；HTTP 404: 用户不存在；HTTP 500: 解封用户失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作"}' "$BASE_URL/api/users/REPLACE_USERID/unban"
```

<a id="api-get-api-users-me-history"></a>

### GET /api/users/me/history

- 用途：读取 users / me / history；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query type=wiki|post|music required; limit integer default20 clamp1–100; offset integer default0 min0；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>history</code>、<code>pagination</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 获取历史记录失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/me/history?type=wiki&limit=20&offset=0"
```

<a id="api-get-api-users-mentions"></a>

### GET /api/users/mentions

- 用途：读取 users / mentions；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query q?:string; limit integer1–20 default8; empty q returns empty list；body/multipart 此处理器不读取 JSON body；解析 schema mention search query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>users</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 搜索用户失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/mentions?q=%E7%A4%BA%E4%BE%8B&limit=8"
```

<a id="api-get-api-users-userid-profile"></a>

### GET /api/users/:userId/profile

- 用途：读取 users / profile；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>user</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 用户不存在；HTTP 500: 获取用户资料失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/profile"
```

<a id="api-get-api-users-userid-posts"></a>

### GET /api/users/:userId/posts

- 用途：读取 users / posts；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query page/limit shared pagination; visibility?:literal public; default uses viewer permissions；body/multipart 此处理器不读取 JSON body；解析 schema user post visibility。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>posts</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取用户帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/posts?page=1&limit=20"
```

<a id="api-get-api-users-userid-galleries"></a>

### GET /api/users/:userId/galleries

- 用途：读取 users / galleries；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query page/limit shared pagination; visibility?:literal public; default uses viewer permissions；body/multipart 此处理器不读取 JSON body；解析 schema user gallery visibility。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>galleries</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取用户图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/galleries?page=1&limit=20"
```

<a id="api-get-api-users-userid-wiki"></a>

### GET /api/users/:userId/wiki

- 用途：读取 users / wiki；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>pages</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取用户百科失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/wiki?limit=20&page=1"
```

<a id="api-get-api-users-userid-comments"></a>

### GET /api/users/:userId/comments

- 用途：读取 users / comments；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>comments</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toCommentResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取用户评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/comments?limit=20&page=1"
```

<a id="api-get-api-users-userid-favorites"></a>

### GET /api/users/:userId/favorites

- 用途：读取 users / favorites；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query page/limit shared pagination; visibility?:literal public; target user preference/ownership decides access；body/multipart 此处理器不读取 JSON body；解析 schema user favorites visibility。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>favorites</code>、<code>nested DTO fields</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 403, 500。HTTP 400: 无效收藏类型；HTTP 403: 无权查看该用户的收藏；HTTP 500: 获取用户收藏失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/favorites?page=1&limit=20"
```

<a id="api-get-api-users-userid-history"></a>

### GET /api/users/:userId/history

- 用途：读取 users / history；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：公开/可选身份。
- 参数契约：path userId: required string path parameter；query type=wiki|post|music; page/limit or offset per handler; visibility controlled by viewer preference；body/multipart 此处理器不读取 JSON body；解析 schema user history visibility。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>history</code>、<code>nested DTO fields</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 403, 500。HTTP 400: 无效历史类型；HTTP 403: 无权查看该用户的浏览历史；HTTP 500: 获取用户浏览历史失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/users/REPLACE_USERID/history?type=wiki&page=1&limit=20"
```

<a id="api-get-api-users-userid-likes"></a>

### GET /api/users/:userId/likes

- 用途：读取 users / likes；目标资源与完整业务约束见第 4 章「用户资料与账号」。
- 权限：已认证。
- 参数契约：path userId: required string path parameter；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>likes</code>、<code>total</code>、<code>page</code>、<code>limit</code>；HTTP 403: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 403: 无权查看该用户的点赞记录；HTTP 500: 获取用户点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/users/REPLACE_USERID/likes?limit=20&page=1"
```

## 5. 帖子、版块与互动

- GET /api/sections：返回 {sections}。POST /api/sections：管理员 body name 必填，description/order 可选；按名称生成小写连字符 id，已存在同 id 会 upsert；201 {section}。DELETE /api/sections/:id 是软删除；仅无帖子引用的版块可删，否则 400。
- GET /api/posts：仅列已发布且当前用户可见帖子；query section 默认 all、page、limit、sort=latest|hot|recommended。返回 posts 与 total/page/limit/totalPages/hasMore。GET /api/posts/tags 返回可见标签。
- GET /api/posts/:slug：slug 是公开数字 slug，不是内部 id；不可见/不存在均 404。返回 {post,comments}，会增加浏览数并在已认证用户历史中记录浏览。
- POST /api/posts：需有效未封禁账户；body title（最多200字符）、section（最多80字符）、content（最多500 KiB）必填；tags最多30项/单项50字符，status=draft|pending|published、musicDocId、albumDocId、locationCode（64）、locationDetail（200）可选。版块必须存在；关联音乐/专辑时使用 docId 并强制归到 music 版块，且站点必须有此版块。普通用户的发布状态仍受审核规则控制；201 {post}。
- PUT /api/posts/:id：全量写入，不是 PATCH；需要 title、section、content，缺少 tags 会清空标签，未提交的可选关联/地点会按 handler 写入缺省值，不要用省略表示保留。id 是内部 id。作者或管理员可改；普通用户改已发布帖会回到审核流程。
- DELETE /api/posts/:id：作者或管理员软删除；删除他人帖子需 body reason；返回 {success:true}。
- POST/DELETE /api/posts/:id/like 与 /dislike：需登录且未封禁；互斥切换赞/踩。POST 返回相应 liked/disliked 与计数；DELETE 幂等移除并返回 false 状态及计数。
- POST/DELETE /api/posts/:id/pin：管理员置顶/取消置顶；返回 {isPinned}。

### 逐接口契约（15 项）

<a id="api-get-api-sections"></a>

### GET /api/sections

- 用途：读取 sections；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>sections</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取版块失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/sections"
```

<a id="api-post-api-sections"></a>

### POST /api/sections

- 用途：创建/提交/触发 sections；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart description: optional string；name: required string；order: optional number。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>section</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: 版块名称不能为空；HTTP 500: 新增版块失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"description":"文档测试说明","name":"文档测试名称","order":20}' "$BASE_URL/api/sections"
```

<a id="api-delete-api-sections-id"></a>

### DELETE /api/sections/:id

- 用途：删除/移除 sections；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 404: 版块不存在；HTTP 500: 删除版块失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/sections/REPLACE_ID"
```

<a id="api-get-api-posts"></a>

### GET /api/posts

- 用途：读取 posts；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query section:string(default all); page:integer(default1,min1); limit:integer(default20,clamp1–100); sort=latest|hot|recommended(default latest)；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>posts</code>、<code>total</code>、<code>page</code>、<code>limit</code>、<code>totalPages</code>、<code>hasMore</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/posts?section=all&page=1&limit=20&sort=latest"
```

<a id="api-get-api-posts-tags"></a>

### GET /api/posts/tags

- 用途：读取 posts / tags；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>tags</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取帖子标签失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/posts/tags"
```

<a id="api-post-api-posts"></a>

### POST /api/posts

- 用途：创建/提交/触发 posts；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。限流器 postWriteLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart albumDocId: optional string；content: required string；locationCode: optional string；locationDetail: optional string；musicDocId: optional string；section: required string；status: optional ContentStatus；tags: optional string[]；title: required string；validateBody schema postCreateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>post</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: 缺少必要字段 / 版块不存在；HTTP 500: 音乐版块不存在，请先在后台创建 / 发布帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"albumDocId":"REPLACE_WITH_ALBUM_DOC_ID","content":"文档测试内容","locationCode":"REPLACE_LOCATIONCODE","locationDetail":"REPLACE_LOCATIONDETAIL","musicDocId":"REPLACE_MUSICDOCID","section":"REPLACE_WITH_SECTION_ID","status":"draft","tags":[],"title":"文档测试标题"}' "$BASE_URL/api/posts"
```

<a id="api-get-api-posts-slug"></a>

### GET /api/posts/:slug

- 用途：读取 posts；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query includeDeleted?:string; only admin with literal true includes deleted comments; default false；body/multipart 此处理器不读取 JSON body；解析 schema post detail query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>post</code>、<code>comments</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 获取帖子详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/posts/REPLACE_SLUG?includeDeleted=false"
```

<a id="api-put-api-posts-id"></a>

### PUT /api/posts/:id

- 用途：更新/执行 posts；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。限流器 postWriteLimiter。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart albumDocId: optional string；content: required string；locationCode: optional string；locationDetail: optional string；musicDocId: optional string；section: required string；status: optional ContentStatus；tags: optional string[]；title: required string；validateBody schema postUpdateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>post</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 缺少必要字段 / 版块不存在；HTTP 403: 无权编辑该帖子；HTTP 404: 帖子未找到；HTTP 500: 音乐版块不存在，请先在后台创建 / 编辑帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"albumDocId":"REPLACE_WITH_ALBUM_DOC_ID","content":"文档测试内容","locationCode":"REPLACE_LOCATIONCODE","locationDetail":"REPLACE_LOCATIONDETAIL","musicDocId":"REPLACE_MUSICDOCID","section":"REPLACE_WITH_SECTION_ID","status":"draft","tags":[],"title":"文档测试标题"}' "$BASE_URL/api/posts/REPLACE_ID"
```

<a id="api-delete-api-posts-id"></a>

### DELETE /api/posts/:id

- 用途：删除/移除 posts；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart reason?:string≤1000; author may omit; deleting another owner requires nonempty reason；validateBody schema postDeleteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 删除理由不能为空；HTTP 403: 无权删除该帖子；HTTP 404: 帖子未找到；HTTP 500: 删除帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/posts/REPLACE_ID"
```

<a id="api-post-api-posts-id-like"></a>

### POST /api/posts/:id/like

- 用途：创建/提交/触发 posts / like；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>liked</code>、<code>likesCount</code>、<code>dislikesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/like"
```

<a id="api-delete-api-posts-id-like"></a>

### DELETE /api/posts/:id/like

- 用途：删除/移除 posts / like；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>liked</code>、<code>likesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 取消点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/like"
```

<a id="api-post-api-posts-id-dislike"></a>

### POST /api/posts/:id/dislike

- 用途：创建/提交/触发 posts / dislike；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>disliked</code>、<code>dislikesCount</code>、<code>likesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/dislike"
```

<a id="api-delete-api-posts-id-dislike"></a>

### DELETE /api/posts/:id/dislike

- 用途：删除/移除 posts / dislike；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>disliked</code>、<code>dislikesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 取消踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/dislike"
```

<a id="api-post-api-posts-id-pin"></a>

### POST /api/posts/:id/pin

- 用途：创建/提交/触发 posts / pin；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>isPinned</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 置顶失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/pin"
```

<a id="api-delete-api-posts-id-pin"></a>

### DELETE /api/posts/:id/pin

- 用途：删除/移除 posts / pin；目标资源与完整业务约束见第 5 章「帖子与版块」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>isPinned</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 取消置顶失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/REPLACE_ID/pin"
```

## 6. 评论

帖子和图库使用不同的评论读取/创建路径，但 DELETE /api/posts/comments/:id、POST /api/posts/comments/:id/restore 和 POST/DELETE /api/posts/comments/:id/like 共用同一评论 ID，并同时处理两种评论。

- GET /api/posts/:postId/comments：postId 是帖子内部 id；query page、limit；管理员传 includeDeleted=true 才会看删除记录。响应严格为 {comments,total,page,limit}，没有 totalPages/hasMore。
- POST 同路径：认证且未封禁；body content 必填（1–5000字符），parentId 可省略/null（最多191字符）；只允许对 published 帖子评论。201 {comment}。
- GET /api/galleries/:id/comments：图库内部 id；没有分页参数，响应只有 {comments}。图库不存在 404；不可见图库 403。
- POST /api/galleries/:id/comments：body content 与可选 parentId；由 gallery handler 自行验证1–5000字符，不使用帖子 Zod schema。仅 published 图库允许评论；201 {comment}。
- 回复传 parentId=要回复的评论 id；服务端归一化为根 parentId，并把实际目标写入 replyToId。不是任意跨帖子/跨图库引用；删除的非根目标不可回复。回复结构不是保证任意深度的树。
- 作者或管理员可 DELETE /api/posts/comments/:id 软删除。管理员删除他人评论须 body reason；重复删除保持成功语义 {success:true}。有存活回复的已删根评论可能保留占位，按 isDeleted 判断。
- 管理员 POST /api/posts/comments/:id/restore 恢复帖子或图库评论；返回 {success:true}。
- POST/DELETE /api/posts/comments/:id/like：需要有效未封禁账户；目标已删或不可见为 404。响应 liked、likedByMe、likesCount；创建/删除点赞幂等。
- POST /api/admin/batch-delete-comments：管理员 body commentIds 非空数组，删除他人评论需 reason；批量结果 {deleted}，只统计本次找到且未删记录，不能当作单条评论计数语义。

```bash
# POST 根评论；POST 回复时将 parentId 替换为上一响应的 comment.id
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"content":"评论正文","parentId":null}' \
  "$BASE_URL/api/posts/替换为帖子内部ID/comments"
```

### 连续调用示例

先从 GET /api/posts/:slug 的 {post} 读取 post.id，再发根评论并保存 comment.id。用 jq 生成 JSON，避免手写拼接任意正文：

```bash
POST_ID='替换为已发布帖子响应中的 post.id'
ROOT_JSON=$(curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"content":"根评论","parentId":null}' "$BASE_URL/api/posts/$POST_ID/comments")
ROOT_COMMENT_ID=$(printf '%s' "$ROOT_JSON" | jq -r '.comment.id')
REPLY_JSON=$(jq -nc --arg content '回复正文' --arg parentId "$ROOT_COMMENT_ID" '{content:$content,parentId:$parentId}')
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$REPLY_JSON" "$BASE_URL/api/posts/$POST_ID/comments"
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/$ROOT_COMMENT_ID/like"
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/$ROOT_COMMENT_ID/like"
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/posts/$POST_ID/comments?page=1&limit=20"
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/$ROOT_COMMENT_ID"
```

jq 用于从上一响应读取 ID 与构造安全 JSON。图库评论只需将 POST/GET 目标替换为 /api/galleries/图库内部ID/comments；评论删除/恢复/点赞仍共用 /api/posts/comments/:id。根评论有存活回复时列表可保留删除占位。

### 逐接口契约（6 项）

<a id="api-get-api-posts-postid-comments"></a>

### GET /api/posts/:postId/comments

- 用途：读取 posts / comments；目标资源与完整业务约束见第 6 章「评论」。
- 权限：公开/可选身份。
- 参数契约：path postId: required string path parameter；query page integer default1 min1; limit integer default20 clamp1–100; includeDeleted=true only for admin；body/multipart 此处理器不读取 JSON body；解析 schema post comments query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>comments</code>、<code>total</code>、<code>page</code>、<code>limit</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404, 500。HTTP 404: 帖子未找到；HTTP 500: 获取评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/posts/REPLACE_POSTID/comments?page=1&limit=20"
```

<a id="api-post-api-posts-postid-comments"></a>

### POST /api/posts/:postId/comments

- 用途：创建/提交/触发 posts / comments；目标资源与完整业务约束见第 6 章「评论」。
- 权限：已认证且未封禁。限流器 postWriteLimiter。
- 参数契约：path postId: required string path parameter；query 无 query 字段；body/multipart content: required string；parentId: optional string | null；validateBody schema postCommentSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>comment</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toCommentResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 500。HTTP 400: 评论内容不能为空 / 回复目标不存在；HTTP 403: 仅已发布内容可评论；HTTP 404: 帖子未找到；HTTP 500: 发表评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"content":"文档测试内容","parentId":null}' "$BASE_URL/api/posts/REPLACE_POSTID/comments"
```

<a id="api-delete-api-posts-comments-id"></a>

### DELETE /api/posts/comments/:id

- 用途：删除/移除 posts / comments；目标资源与完整业务约束见第 6 章「评论」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart reason?:string≤1000; comment owner may omit; admin deleting another user requires reason；解析 schema comment delete reason。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 删除理由不能为空；HTTP 403: 无权删除该评论；HTTP 404: 评论未找到；HTTP 500: 删除评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/posts/comments/REPLACE_ID"
```

<a id="api-post-api-posts-comments-id-restore"></a>

### POST /api/posts/comments/:id/restore

- 用途：创建/提交/触发 posts / comments / restore；目标资源与完整业务约束见第 6 章「评论」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 评论未找到；HTTP 500: 恢复评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/REPLACE_ID/restore"
```

<a id="api-post-api-posts-comments-id-like"></a>

### POST /api/posts/comments/:id/like

- 用途：创建/提交/触发 posts / comments / like；目标资源与完整业务约束见第 6 章「评论」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 评论未找到；HTTP 500: 点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/REPLACE_ID/like"
```

<a id="api-delete-api-posts-comments-id-like"></a>

### DELETE /api/posts/comments/:id/like

- 用途：删除/移除 posts / comments / like；目标资源与完整业务约束见第 6 章「评论」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 评论未找到；HTTP 500: 取消点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/posts/comments/REPLACE_ID/like"
```

## 7. Wiki 页面、分支与合并请求

Wiki 常规读取以公开数字 slug 定位；编辑、删除及评论类资源使用对应内部 ID。内容写入还受 Wiki 分类 requiresAdminEdit 规则影响。POST /api/wiki 与 PUT /api/wiki/:slug 接受 title/content/category/tags/relations/eventDate/locationCode/locationDetail/status；POST 最少 title/content/category。PUT 使用 partial Zod schema，但当前 handler仍要求 title/category/content 实际存在，因此按完整字段提交。内容上限 500 KiB；关系列表最多 80，元素由领域 helper 归一化（type、targetSlug、label、bidirectional）。普通用户写入状态走审核逻辑。

- GET /api/wiki：category 默认 all，tag，page/limit；返回 pages 与分页元数据。
- GET /api/wiki/recommended：query slug 可选、limit 默认 8/范围 1–24；返回 {items}，目标页面必须可见。
- GET /api/wiki/categories、/tags：返回 categories/tags。
- GET /api/wiki/:slug：返回 page、backlinks、relations、relationGraph；会增长 viewCount，并为登录用户记录 history。404 也覆盖无权页面。
- POST/DELETE /api/wiki/:slug/like、/dislike：已认证且未封禁；赞/踩互斥，返回布尔状态与计数。
- POST/DELETE/PUT /api/wiki/:slug/pin：管理员；POST 置顶、DELETE 取消，PUT body isPinned 可切换，返回更新结果。
- GET /api/wiki/:slug/history：page/limit 分页，返回 revisions 元数据；GET /:slug/revisions/:revisionId 返回单个修订正文，修订必须属于该 slug。
- POST /api/wiki/:slug/submit：作者（lastEditor）或管理员；body note 可选；普通用户提交审核，管理员操作会发布。
- DELETE /api/wiki/:slug：管理员软删除；body reason 必填。
- POST /api/wiki/:slug/branches：认证且未封禁；本人已有分支则返回现有分支，否则创建草稿分支与初始修订。
- GET /api/wiki/:slug/branches：需认证；作者看到自己的分支及审核/冲突分支，管理员可看全部。
- GET /api/wiki/branches/mine：认证且未封禁，只列本人 draft/pending_review/conflict 分支。
- GET /api/wiki/branches/:branchId、/revisions：认证；分支正文按作者/管理员权限；修订列表最多 100。
- POST /api/wiki/branches/:branchId/revisions：body title/content/category 必填；tags/relations/eventDate/isAutoSave 可选。保存 201 {revision}，已有开放 PR 时分支保持 pending_review。
- POST /api/wiki/branches/:branchId/pull-request：作者或管理员；title/description 可选；若已有开放 PR，返回现有 {pullRequest} 而不重复创建；否则 201。
- GET /api/wiki/pull-requests/list：需认证，管理员可看全部，普通用户只能看自己的；status 默认 open，可选 merged/rejected，page/limit、pageSlug、branchId 可选。
- GET /api/wiki/pull-requests/:prId 与 /diff：创建者或管理员；详情含 comments，diff 返回 base/head 字段快照。
- POST /api/wiki/pull-requests/:prId/comments：创建者或管理员，body content 必填。
- POST /api/wiki/pull-requests/:prId/merge、/reject：管理员；合并基础版本变化返回 409 并给出 conflictData；驳回需 note。
- POST /api/wiki/branches/:branchId/resolve-conflict：PR 创建者或管理员，提交完整修订快照，更新 baseRevisionId 并清冲突标记。
- POST /api/wiki/:slug/rollback/:revisionId：作者或管理员；按修订回滚并新建修订，普通用户产生 pending 状态。
- GET /api/mp/wiki：独立小程序列表契约：query category/page/limit，limit 1–100 默认 20；响应 {items,total,page,limit}，字段与 Web Wiki 列表不同。

### 逐接口契约（34 项）

<a id="api-get-api-wiki"></a>

### GET /api/wiki

- 用途：读取 wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query category string default all; tag?:string; page integer default1; pageSize integer default20 clamp1–100；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>pages</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取百科失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki?category=all&page=1&pageSize=20"
```

<a id="api-get-api-mp-wiki"></a>

### GET /api/mp/wiki

- 用途：读取 mp / wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query category?:string; page integer default1; limit integer1–100 default20；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>items</code>、<code>total</code>、<code>page</code>、<code>limit</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取小程序百科失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/mp/wiki?page=1&limit=20"
```

<a id="api-get-api-wiki-recommended"></a>

### GET /api/wiki/recommended

- 用途：读取 wiki / recommended；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query slug?:numeric Wiki slug; limit integer default8 range1–24；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>items</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404, 500。HTTP 404: 页面未找到；HTTP 500: 获取推荐百科失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/recommended?limit=8"
```

<a id="api-get-api-wiki-categories"></a>

### GET /api/wiki/categories

- 用途：读取 wiki / categories；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>categories</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取百科分类失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/categories"
```

<a id="api-get-api-wiki-tags"></a>

### GET /api/wiki/tags

- 用途：读取 wiki / tags；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>tags</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/tags"
```

<a id="api-get-api-wiki-slug"></a>

### GET /api/wiki/:slug

- 用途：读取 wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>page</code>、<code>backlinks</code>、<code>relations</code>、<code>relationGraph</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 页面未找到；HTTP 500: 获取页面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/REPLACE_SLUG"
```

<a id="api-post-api-wiki-slug-like"></a>

### POST /api/wiki/:slug/like

- 用途：创建/提交/触发 wiki / like；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>liked</code>、<code>likesCount</code>、<code>dislikesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 页面未找到；HTTP 500: 点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/like"
```

<a id="api-delete-api-wiki-slug-like"></a>

### DELETE /api/wiki/:slug/like

- 用途：删除/移除 wiki / like；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 取消点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/like"
```

<a id="api-post-api-wiki-slug-dislike"></a>

### POST /api/wiki/:slug/dislike

- 用途：创建/提交/触发 wiki / dislike；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>disliked</code>、<code>dislikesCount</code>、<code>likesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 页面未找到；HTTP 500: 踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/dislike"
```

<a id="api-delete-api-wiki-slug-dislike"></a>

### DELETE /api/wiki/:slug/dislike

- 用途：删除/移除 wiki / dislike；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 取消踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/dislike"
```

<a id="api-post-api-wiki-slug-pin"></a>

### POST /api/wiki/:slug/pin

- 用途：创建/提交/触发 wiki / pin；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 500。HTTP 500: 置顶操作失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/pin"
```

<a id="api-delete-api-wiki-slug-pin"></a>

### DELETE /api/wiki/:slug/pin

- 用途：删除/移除 wiki / pin；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 500。HTTP 500: 置顶操作失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/pin"
```

<a id="api-put-api-wiki-slug-pin"></a>

### PUT /api/wiki/:slug/pin

- 用途：更新/执行 wiki / pin；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart isPinned: optional boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 500。HTTP 500: 置顶操作失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"isPinned":"REPLACE_ISPINNED"}' "$BASE_URL/api/wiki/REPLACE_SLUG/pin"
```

<a id="api-get-api-wiki-slug-history"></a>

### GET /api/wiki/:slug/history

- 用途：读取 wiki / history；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>revisions</code>、<code>nested DTO fields</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 页面未找到；HTTP 500: 获取历史记录失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/REPLACE_SLUG/history?limit=20&page=1"
```

<a id="api-get-api-wiki-slug-revisions-revisionid"></a>

### GET /api/wiki/:slug/revisions/:revisionId

- 用途：读取 wiki / revisions；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：公开/可选身份。
- 参数契约：path revisionId: required string path parameter；slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>revision</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 页面未找到 / 修订版本未找到；HTTP 500: 获取修订版本失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/wiki/REPLACE_SLUG/revisions/REPLACE_REVISIONID"
```

<a id="api-post-api-wiki-slug-submit"></a>

### POST /api/wiki/:slug/submit

- 用途：创建/提交/触发 wiki / submit；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart note: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>page</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权提交该页面；HTTP 404: 页面未找到；HTTP 500: 提交审核失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作"}' "$BASE_URL/api/wiki/REPLACE_SLUG/submit"
```

<a id="api-post-api-wiki"></a>

### POST /api/wiki

- 用途：创建/提交/触发 wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart title required≤200; content required≤500KiB; category required≤80; tags string[]≤30/element≤50; relations WikiRelation[]≤80; eventDate string≤32|null; locationCode≤64/locationDetail≤200; status draft|pending|published；validateBody schema wikiCreateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>page</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 500。HTTP 400: 缺少必要字段 / 内容超出限制，最大500KB；HTTP 500: 保存页面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离 Wiki 页","content":"隔离测试正文","category":"REPLACE_WITH_CATEGORY_ID","tags":[],"relations":[]}' "$BASE_URL/api/wiki"
```

<a id="api-put-api-wiki-slug"></a>

### PUT /api/wiki/:slug

- 用途：更新/执行 wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart partial schema fields but handler requires title/content/category; omitted update fields preserve existing; relations[] replaces relation snapshot; eventDate null clears；validateBody schema wikiUpdateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>page</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 缺少必要字段 / 内容超出限制，最大500KB；HTTP 403: 无权编辑该页面；HTTP 404: 页面未找到；HTTP 500: 更新页面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离 Wiki 页","content":"更新正文","category":"REPLACE_WITH_CATEGORY_ID","tags":[],"relations":[]}' "$BASE_URL/api/wiki/REPLACE_SLUG"
```

<a id="api-delete-api-wiki-slug"></a>

### DELETE /api/wiki/:slug

- 用途：删除/移除 wiki；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart reason: required string；validateBody schema wikiDeleteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 删除理由不能为空；HTTP 404: 页面未找到；HTTP 500: 删除页面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"reason":"隔离测试操作"}' "$BASE_URL/api/wiki/REPLACE_SLUG"
```

<a id="api-post-api-wiki-slug-branches"></a>

### POST /api/wiki/:slug/branches

- 用途：创建/提交/触发 wiki / branches；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>branch</code>；HTTP 201: <code>branch</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiBranchResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 401, 403, 404, 500。HTTP 404: 页面未找到；HTTP 500: 创建分支失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/branches"
```

<a id="api-get-api-wiki-slug-branches"></a>

### GET /api/wiki/:slug/branches

- 用途：读取 wiki / branches；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>branches</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiBranchResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 页面未找到；HTTP 500: 获取分支失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/branches"
```

<a id="api-get-api-wiki-branches-mine"></a>

### GET /api/wiki/branches/mine

- 用途：读取 wiki / branches / mine；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>branches</code>；HTTP 500: <code>error</code>；DTO transformer toWikiBranchResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取分支失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/branches/mine"
```

<a id="api-get-api-wiki-branches-branchid"></a>

### GET /api/wiki/branches/:branchId

- 用途：读取 wiki / branches；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path branchId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>branch</code>、<code>latestRevision</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiBranchResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权访问该分支；HTTP 404: 分支未找到；HTTP 500: 获取分支失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/branches/REPLACE_BRANCHID"
```

<a id="api-get-api-wiki-branches-branchid-revisions"></a>

### GET /api/wiki/branches/:branchId/revisions

- 用途：读取 wiki / branches / revisions；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path branchId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>revisions</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权查看修订历史；HTTP 404: 分支未找到；HTTP 500: 获取分支版本失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/branches/REPLACE_BRANCHID/revisions"
```

<a id="api-post-api-wiki-branches-branchid-revisions"></a>

### POST /api/wiki/branches/:branchId/revisions

- 用途：创建/提交/触发 wiki / branches / revisions；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path branchId: required string path parameter；query 无 query 字段；body/multipart title/content/category required; tags≤30, relations≤80, eventDate?:string|null, isAutoSave?:boolean；validateBody schema wikiRevisionSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>revision</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 404, 500。HTTP 400: 缺少必要字段；HTTP 403: 无权编辑该分支；HTTP 404: 分支未找到；HTTP 500: 保存分支版本失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离修订","content":"正文","category":"REPLACE_WITH_CATEGORY_ID","tags":[],"relations":[]}' "$BASE_URL/api/wiki/branches/REPLACE_BRANCHID/revisions"
```

<a id="api-post-api-wiki-branches-branchid-pull-request"></a>

### POST /api/wiki/branches/:branchId/pull-request

- 用途：创建/提交/触发 wiki / branches / pull request；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path branchId: required string path parameter；query 无 query 字段；body/multipart description: optional string；title: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>pullRequest</code>；HTTP 201: <code>pullRequest</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiPullRequestResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 404, 500。HTTP 400: 分支暂无可提交内容 / 分支最新版本不存在；HTTP 403: 无权提交该分支；HTTP 404: 分支未找到；HTTP 500: 提交 PR 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"description":"文档测试说明","title":"文档测试标题"}' "$BASE_URL/api/wiki/branches/REPLACE_BRANCHID/pull-request"
```

<a id="api-get-api-wiki-pull-requests-list"></a>

### GET /api/wiki/pull-requests/list

- 用途：读取 wiki / pull requests / list；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query status=open|merged|rejected default open; page integer default1; limit integer default20; pageSlug?:string; branchId?:string；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>pullRequests</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toWikiPullRequestResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 获取 PR 列表失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/pull-requests/list?status=open&page=1&limit=20"
```

<a id="api-get-api-wiki-pull-requests-prid"></a>

### GET /api/wiki/pull-requests/:prId

- 用途：读取 wiki / pull requests；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path prId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>pullRequest</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiPullRequestResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权查看该 PR；HTTP 404: PR 不存在；HTTP 500: 获取 PR 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/pull-requests/REPLACE_PRID"
```

<a id="api-get-api-wiki-pull-requests-prid-diff"></a>

### GET /api/wiki/pull-requests/:prId/diff

- 用途：读取 wiki / pull requests / diff；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证。
- 参数契约：path prId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>diff</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权查看该 PR；HTTP 404: PR 不存在；HTTP 500: 获取 PR Diff 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/wiki/pull-requests/REPLACE_PRID/diff"
```

<a id="api-post-api-wiki-pull-requests-prid-comments"></a>

### POST /api/wiki/pull-requests/:prId/comments

- 用途：创建/提交/触发 wiki / pull requests / comments；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path prId: required string path parameter；query 无 query 字段；body/multipart content: required string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>comment</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 500。HTTP 400: 评论内容不能为空；HTTP 403: 无权评论该 PR；HTTP 404: PR 不存在；HTTP 500: 发表评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"content":"文档测试内容"}' "$BASE_URL/api/wiki/pull-requests/REPLACE_PRID/comments"
```

<a id="api-post-api-wiki-pull-requests-prid-merge"></a>

### POST /api/wiki/pull-requests/:prId/merge

- 用途：创建/提交/触发 wiki / pull requests / merge；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path prId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>page</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 409: <code>error</code>、<code>conflictData</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 409, 500。HTTP 400: 该 PR 已处理 / 分支没有可合并内容 / 分支版本不存在；HTTP 404: PR 不存在；HTTP 409: 检测到冲突，请先解决冲突后再合并；HTTP 500: 合并 PR 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/pull-requests/REPLACE_PRID/merge"
```

<a id="api-post-api-wiki-pull-requests-prid-reject"></a>

### POST /api/wiki/pull-requests/:prId/reject

- 用途：创建/提交/触发 wiki / pull requests / reject；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：管理员。限流器 wikiWriteLimiter。
- 参数契约：path prId: required string path parameter；query 无 query 字段；body/multipart note: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 该 PR 已处理；HTTP 404: PR 不存在；HTTP 500: 驳回 PR 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作"}' "$BASE_URL/api/wiki/pull-requests/REPLACE_PRID/reject"
```

<a id="api-post-api-wiki-branches-branchid-resolve-conflict"></a>

### POST /api/wiki/branches/:branchId/resolve-conflict

- 用途：创建/提交/触发 wiki / branches / resolve conflict；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path branchId: required string path parameter；query 无 query 字段；body/multipart complete title/content/category revision snapshot; tags/relations included in snapshot; not a partial patch；validateBody schema wikiRevisionSchema.omit({ isAutoSave: true }。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>revision</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 缺少必要字段；HTTP 403: 无权解决该冲突；HTTP 404: 分支未找到 / 该分支没有待处理 PR；HTTP 500: 解决冲突失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"冲突解决快照","content":"正文","category":"REPLACE_WITH_CATEGORY_ID","tags":[],"relations":[]}' "$BASE_URL/api/wiki/branches/REPLACE_BRANCHID/resolve-conflict"
```

<a id="api-post-api-wiki-slug-rollback-revisionid"></a>

### POST /api/wiki/:slug/rollback/:revisionId

- 用途：创建/提交/触发 wiki / rollback；目标资源与完整业务约束见第 7 章「Wiki 页面、分支与合并请求」。
- 权限：已认证且未封禁。限流器 wikiWriteLimiter。
- 参数契约：path revisionId: required string path parameter；slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>page</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权回滚该页面；HTTP 404: 历史版本不存在 / 页面未找到；HTTP 500: 回滚失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/wiki/REPLACE_SLUG/rollback/REPLACE_REVISIONID"
```

## 8. 图库与媒体上传

### 图库与图片列表

- GET /api/galleries：仅返回已发布图库，page/limit 分页；返回 galleries 与分页元数据。GET /tags 返回可见标签。GET /:slug 用公开数字 slug，未发布但有权查看的详情需遵守 canViewGallery，存在但不可见为 403。
- POST /api/galleries：需认证、未封禁，并受 galleryAdminOnly 运行时开关限制。body 支持 title、description、tags、eventDate(YYYY-MM-DD/null)、locationCode/locationDetail、copyright、relatedLinks、status/published、uploadSessionId，以及 images 或 assetIds。title≤200，description≤5000，tags≤30项/每项≤50，locationCode≤64，locationDetail≤200，copyright≤200。relatedLinks≤20条、label≤80、URL≤2048；站内路径只允许 /wiki、/forum、/gallery、/events、/tickets、/music、/album、/search、/announcements、/more、/users 内容根目录。至少一张图片。本站图片须是当前用户 ready asset，不能提交任意外部 URL；图片内容不能重复。未给 title 时用“默认图集”。201 {gallery}。
- PATCH /api/galleries/:id：owner/admin；只更新出现的字段。省略字段不改；tags=[] 与 relatedLinks=[] 可整体清空；eventDate:null 清除日期；locationCode/locationDetail/copyright 的空值清除。images 若提交则是完整图片指令快照：existing imageId 保留并排序，assetId/url 新增，没列出的旧图会删除；至少保留一张图。不能把上传会话 ID 当资源 ID。
- PATCH /api/galleries/:id/publish：body published 布尔/可解析布尔值；管理者与作者仍受审核状态规则影响。POST /:id/submit 提交审核。DELETE /:id 为软删除；删除他人图库须 reason。
- POST /:id/like|dislike、DELETE 同路径反向操作；需登录且未封禁，赞/踩互斥，返回状态和计数。
- POST /:id/images：body assetIds 非空数组，可选 uploadSessionId，向现有图库追加图片；不可重复已有资源/内容；返回更新后的 {gallery}。
- DELETE /:id/images：body imageIds，最多 200 个去重 id；需保留至少一张图片，返回 {deleted,gallery}。DELETE /:id/images/:imageId 单张删除也需保留至少一张。
- PATCH /:id/images/reorder：body imageIds 必须恰好包含图库当前所有图片一次；部分顺序或重复 ID 返回 400；成功 {gallery}。

### 通用上传三步

单个文件最大 20 MiB；允许 JPG/JPEG、PNG、WEBP、GIF、BMP 扩展名与受支持的实际 MIME/图片格式。上传创建媒体资源 claim；使用同一用户身份和会话完成所有步骤。

```bash
# 1. 创建会话；从 session.id 保存 SESSION_ID
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"maxFiles":1}' "$BASE_URL/api/uploads/sessions"

# 2. 追加文件；curl 自动产生 multipart boundary，asset.id 是业务绑定 ID
curl --fail-with-body -H "$AUTH_HEADER" -F 'file=@./image.png' \
  "$BASE_URL/api/uploads/sessions/$SESSION_ID/files"

# 3. finalize 后资源才能用于业务绑定
curl --fail-with-body -X POST -H "$AUTH_HEADER" \
  "$BASE_URL/api/uploads/sessions/$SESSION_ID/finalize"
```

- POST /api/uploads/sessions：认证且未封禁；maxFiles 可选，整数 1–50，默认 50；201 {session:{id,ownerUid,status,maxFiles,uploadedFiles,expiresAt,createdAt,updatedAt}}。
- GET /sessions/:sessionId：仅会话 owner；会话超时后读取会把状态标成 expired。
- POST /sessions/:sessionId/files：multipart file 必填；201 返回 session、asset（id/imageMapId/publicUrl/storageKey/fileName/mimeType/sizeBytes/md5/status/reused）、storageErrors；query tripleStorage=true 时另含各存储 URL。必须属于本人且会话可接收文件。
- POST /sessions/:sessionId/finalize：空会话 400，过期 410，已完成重复调用仍返回 finalized session，竞态状态变化 409；成功把会话下上传资源置 ready。
- POST /assets/reuse：body imageMapId/fileName/mimeType/sizeBytes；复用本人可用映射，201 {asset,storageErrors}。
- DELETE /assets/:assetId：释放当前用户 media claim，不保证删除被引用的物理图片。
- DELETE /sessions/:sessionId：只可取消本人 open/expired 会话；finalized 返回 409；会释放会话资源并删除会话。
- DELETE /superbed：管理员，body imageIds 非空数组最多 1000，要求配置 Superbed token；外部图床删除是破坏性操作，成功 {success,deletedCount}。

### 逐接口契约（26 项）

<a id="api-post-api-uploads-sessions"></a>

### POST /api/uploads/sessions

- 用途：创建/提交/触发 uploads / sessions；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart maxFiles integer1–50 optional default50；解析 schema upload session create。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>session</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUploadSessionResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: maxFiles 必须是 1 到 50 之间的整数；HTTP 500: 创建上传会话失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"maxFiles":1}' "$BASE_URL/api/uploads/sessions"
```

<a id="api-get-api-uploads-sessions-sessionid"></a>

### GET /api/uploads/sessions/:sessionId

- 用途：读取 uploads / sessions；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path sessionId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>session</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUploadSessionResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权访问该会话；HTTP 404: 上传会话不存在；HTTP 500: 获取上传会话失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/uploads/sessions/REPLACE_SESSIONID"
```

<a id="api-post-api-uploads-sessions-sessionid-files"></a>

### POST /api/uploads/sessions/:sessionId/files

- 用途：创建/提交/触发 uploads / sessions / files；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。限流器 uploadLimiter。
- 参数契约：path sessionId: required string path parameter；query multipart file required; tripleStorage?:boolean query default false; single file limit20MiB；body/multipart multipart file 必填；单文件最多20 MiB，支持格式见第8章；解析 schema upload file options。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>session</code>、<code>asset</code>、<code>nested DTO fields</code>、<code>storageErrors</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUploadSessionResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 404, 500。HTTP 400: 请上传文件；HTTP 404: 上传会话不存在；HTTP 500: 上传后处理失败，媒体资源已释放 / 上传文件失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" -F 'file=@./test-fixture.png' "$BASE_URL/api/uploads/sessions/REPLACE_SESSIONID/files"
```

<a id="api-post-api-uploads-sessions-sessionid-finalize"></a>

### POST /api/uploads/sessions/:sessionId/finalize

- 用途：创建/提交/触发 uploads / sessions / finalize；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path sessionId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>session</code>、<code>error</code>；HTTP 500: <code>error</code>；DTO transformer toUploadSessionResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 完成上传会话失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/uploads/sessions/REPLACE_SESSIONID/finalize"
```

<a id="api-post-api-uploads-assets-reuse"></a>

### POST /api/uploads/assets/reuse

- 用途：创建/提交/触发 uploads / assets / reuse；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart imageMapId/fileName/mimeType/sizeBytes required; imageMap must exist and be reusable；解析 schema reuse media asset。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>asset</code>、<code>storageErrors</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 500。HTTP 400: 复用媒体资源参数不合法；HTTP 500: 复用媒体资源失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageMapId":"REPLACE_WITH_IMAGE_MAP_ID","fileName":"image.png","mimeType":"image/png","sizeBytes":1}' "$BASE_URL/api/uploads/assets/reuse"
```

<a id="api-delete-api-uploads-assets-assetid"></a>

### DELETE /api/uploads/assets/:assetId

- 用途：删除/移除 uploads / assets；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path assetId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 释放媒体资源失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/uploads/assets/REPLACE_ASSETID"
```

<a id="api-delete-api-uploads-sessions-sessionid"></a>

### DELETE /api/uploads/sessions/:sessionId

- 用途：删除/移除 uploads / sessions；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path sessionId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 删除上传会话失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/uploads/sessions/REPLACE_SESSIONID"
```

<a id="api-delete-api-uploads-superbed"></a>

### DELETE /api/uploads/superbed

- 用途：删除/移除 uploads / superbed；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart imageIds: required string[]。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>deletedCount</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供要删除的图片 ID 列表 / 每次最多删除 1000 张图片 / Superbed API Token 未配置；HTTP 500: 删除图片失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageIds":["REPLACE_WITH_ID"]}' "$BASE_URL/api/uploads/superbed"
```

<a id="api-get-api-galleries"></a>

### GET /api/galleries

- 用途：读取 galleries；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；refreshThumbnails: optional boolean/string parser；body/multipart 此处理器不读取 body；数值/布尔解析 refreshThumbnails: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>galleries</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/galleries?limit=20&page=1&refreshThumbnails=REPLACE_VALUE"
```

<a id="api-get-api-galleries-tags"></a>

### GET /api/galleries/tags

- 用途：读取 galleries / tags；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>tags</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/galleries/tags"
```

<a id="api-get-api-galleries-slug"></a>

### GET /api/galleries/:slug

- 用途：读取 galleries；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 403, 404, 500。HTTP 403: 该图集尚未发布；HTTP 404: 图集不存在；HTTP 500: 获取图集详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/galleries/REPLACE_SLUG"
```

<a id="api-post-api-galleries-id-like"></a>

### POST /api/galleries/:id/like

- 用途：创建/提交/触发 galleries / like；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>liked</code>、<code>likesCount</code>、<code>dislikesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 图集不存在；HTTP 500: 点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/like"
```

<a id="api-delete-api-galleries-id-like"></a>

### DELETE /api/galleries/:id/like

- 用途：删除/移除 galleries / like；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>liked</code>、<code>likesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 图集不存在；HTTP 500: 取消点赞失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/like"
```

<a id="api-post-api-galleries-id-dislike"></a>

### POST /api/galleries/:id/dislike

- 用途：创建/提交/触发 galleries / dislike；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>disliked</code>、<code>dislikesCount</code>、<code>likesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 图集不存在；HTTP 500: 踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/dislike"
```

<a id="api-delete-api-galleries-id-dislike"></a>

### DELETE /api/galleries/:id/dislike

- 用途：删除/移除 galleries / dislike；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>disliked</code>、<code>dislikesCount</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 图集不存在；HTTP 500: 取消踩失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/dislike"
```

<a id="api-post-api-galleries"></a>

### POST /api/galleries

- 用途：创建/提交/触发 galleries；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。限流器 galleryWriteLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart title/description/tags/eventDate/location/copyright/relatedLinks/status/published/uploadSessionId plus images or assetIds; requires at least one caller-owned ready image asset；解析 schema manual Gallery create。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>gallery</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 500。HTTP 400: 日期格式无效，请使用 yyyy-MM-dd 格式 / 图集至少需要一张图片 / 图片地址不合法，请重新上传 / 图片地址未关联当前用户的媒体资源，请重新上传 / 图片列表包含重复资源；HTTP 403: 当前图集已临时限制为仅管理员可操作；HTTP 500: 创建图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离图库","assetIds":["REPLACE_WITH_ASSET_ID"],"tags":[]}' "$BASE_URL/api/galleries"
```

<a id="api-patch-api-galleries-id"></a>

### PATCH /api/galleries/:id

- 用途：部分更新 galleries；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart only provided fields update; tags=[]/relatedLinks=[] clear; eventDate:null clears; images when sent is a full image snapshot; use owner/admin asset IDs；解析 schema manual Gallery partial update。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 日期格式无效，请使用 yyyy-MM-dd 格式 / 图片保存数据无效 / 没有可更新的字段；HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限编辑该图集；HTTP 404: 图集不存在；HTTP 500: 更新图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"更新图库标题"}' "$BASE_URL/api/galleries/REPLACE_ID"
```

<a id="api-patch-api-galleries-id-publish"></a>

### PATCH /api/galleries/:id/publish

- 用途：部分更新 galleries / publish；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart published: optional boolean/string parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限修改图集发布状态；HTTP 404: 图集不存在；HTTP 500: 修改图集发布状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"published":true}' "$BASE_URL/api/galleries/REPLACE_ID/publish"
```

<a id="api-post-api-galleries-id-submit"></a>

### POST /api/galleries/:id/submit

- 用途：创建/提交/触发 galleries / submit；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限提交该图集；HTTP 404: 图集不存在；HTTP 500: 提交审核失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/submit"
```

<a id="api-delete-api-galleries-id"></a>

### DELETE /api/galleries/:id

- 用途：删除/移除 galleries；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart reason?:string max1000; required when admin deletes another owner’s gallery；validateBody schema galleryDeleteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 删除理由不能为空；HTTP 403: 无权删除该图集；HTTP 404: 图集不存在；HTTP 500: 删除图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"reason":"隔离测试原因"}' "$BASE_URL/api/galleries/REPLACE_ID"
```

<a id="api-post-api-galleries-id-images"></a>

### POST /api/galleries/:id/images

- 用途：创建/提交/触发 galleries / images；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart assetIds nonempty array of caller-owned ready assets; optional uploadSessionId；解析 schema append gallery images。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 请提供至少一个图片资源 / 图片列表包含重复资源；HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限编辑该图集；HTTP 404: 图集不存在；HTTP 500: 追加图集图片失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"assetIds":["REPLACE_WITH_ASSET_ID"]}' "$BASE_URL/api/galleries/REPLACE_ID/images"
```

<a id="api-delete-api-galleries-id-images"></a>

### DELETE /api/galleries/:id/images

- 用途：删除/移除 galleries / images；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart imageIds unique array1–200; gallery must retain at least one image；validateBody schema adminBatchGalleryImagesSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleted</code>、<code>gallery</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 图片列表包含无效图片 / 图集至少需要保留一张图片；HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限编辑该图集；HTTP 404: 图集不存在；HTTP 500: 批量删除图集图片失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageIds":["REPLACE_WITH_IMAGE_ID"]}' "$BASE_URL/api/galleries/REPLACE_ID/images"
```

<a id="api-delete-api-galleries-id-images-imageid"></a>

### DELETE /api/galleries/:id/images/:imageId

- 用途：删除/移除 galleries / images；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；imageId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 图集至少需要保留一张图片；HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限编辑该图集；HTTP 404: 图集不存在 / 图片不存在；HTTP 500: 删除图集图片失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/galleries/REPLACE_ID/images/REPLACE_IMAGEID"
```

<a id="api-patch-api-galleries-id-images-reorder"></a>

### PATCH /api/galleries/:id/images/reorder

- 用途：部分更新 galleries / images / reorder；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart imageIds: required array（元素以 handler 检查为准）。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>gallery</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 请提供图片排序列表 / 排序列表与当前图片数量不一致 / 排序列表包含无效图片；HTTP 403: 当前图集已临时限制为仅管理员可操作 / 无权限编辑该图集；HTTP 404: 图集不存在；HTTP 500: 重排图集图片失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageIds":["REPLACE_WITH_ID"]}' "$BASE_URL/api/galleries/REPLACE_ID/images/reorder"
```

<a id="api-get-api-galleries-id-comments"></a>

### GET /api/galleries/:id/comments

- 用途：读取 galleries / comments；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：公开/可选身份。
- 参数契约：path id: required string path parameter；query no pagination; includeDeleted=true can be used only by admin for deleted entries；body/multipart 此处理器不读取 JSON body；解析 schema gallery comment list。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>comments</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 403, 404, 500。HTTP 403: 该图集尚未发布；HTTP 404: 图集不存在；HTTP 500: 获取图集评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/galleries/REPLACE_ID/comments"
```

<a id="api-post-api-galleries-id-comments"></a>

### POST /api/galleries/:id/comments

- 用途：创建/提交/触发 galleries / comments；目标资源与完整业务约束见第 8 章「图库与媒体上传」。
- 权限：已认证且未封禁。限流器 galleryWriteLimiter。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart content: required string；parentId: optional string | null。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>comment</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toCommentResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 500。HTTP 400: 评论内容不能为空 / 回复目标不存在；HTTP 403: 仅已发布内容可评论；HTTP 404: 图集不存在；HTTP 500: 发表评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"content":"文档测试内容","parentId":null}' "$BASE_URL/api/galleries/REPLACE_ID/comments"
```

## 9. 音乐管理

### 读取、管理和导入

- GET /api/music：query page/limit(1–100，默认20)、tag、albumDocId、includeInstrumentals(默认true)、sortOrder=asc|desc（默认desc）。按 albumDocId 查询时只列该专辑关联曲目；返回 songs 与分页元数据；列表省略 lyric/description。
- GET /tags：返回全站未删除歌曲标签。
- GET /:slug：slug 为公开数字 slug；返回 {song}，含歌词/description 及用户收藏状态。
- GET /song/:id（同挂载 /api/music）：id 是 Netease 外部 sourceId，不是 docId。存在已入库映射时返回歌曲与播放数据；未入库时可能返回 docId:null 的外部预览。不能拿此 ID 更新/删除歌曲。
- GET /:docId/play-url：业务 docId；返回 playUrl/mode/platform/sourceId/playable/cached/cacheExpiresAt。外部解析失败时 playable 可能为 false，不等同资源不存在。
- GET /instrumental-targets：{docIds}，已登记伴奏目标歌曲的 docId。
- GET /match-suggestions：query platform/title/artists（或 artist）必填；搜索外部平台并最多给 5 个候选，返回 suggestions 与 autoSelectedIndex。依赖对应音乐服务。
- POST /api/music：管理员。最少 {title,artists:[string]}；可选 lyricists/composers/arrangers/vocals、album、audioUrl、lyric、description、releaseDate、durationMs、sources、tags、customPlatformLinks、playableOverride。releaseDate/durationMs 不传创建为 null；无效格式 400。playableOverride=auto|enabled|disabled。相同平台 sourceId 可共享，只在 {duplicates} 提醒，不拒绝创建。201 {song,duplicates}。
- PATCH /:docId：管理员，docId 是业务 ID。仅更新提交字段；artists/credits/tags/sources/customPlatformLinks 等数组/链接在提交时整体替换，空数组清空。lyric/description 可用 null 清除；releaseDate/durationMs 可用 null 清除；displayAlbumMode/manualAlbumName 与 coverAlbumDocId 依字段逻辑联动。sources 未提交时保留，提交 [] 会删除该歌曲的所有外部来源。成功 {song,duplicates}。
- DELETE /:docId：管理员软删除，不等同永久删除。永久删除另走 POST /api/admin/:tab/:id/permanent 的 music 分支。

### 平台解析与批量导入

POST /api/music/parse-url 管理员 body {url}，仅解析预览、不写库；返回 resource，其中 songs 含 sourceId、匹配状态和 matchSummary。POST /api/music/import 管理员 body url、可选 selectedSongIds（外部 sourceId 数组）、duplicateStrategy=fill|overwrite|skip（默认 fill）。省略/空 selectedSongIds 会导入该资源全部曲目；未知策略归一成 fill。无可导入歌曲 400。返回 summary{imported,skipped,failed}、linked、linkedSongs、importedSongs、collection；HTTP 成功仍可能逐曲失败，必须检查 summary 和结果列表。

- fill：仅填补空标题/艺人/专辑/音频、空歌词与缺失的词曲编/演唱/发行日期/时长字段；overwrite 覆盖标题、艺人、专辑名、音频与可替换歌词，但词曲编/演唱/发行日期/时长仍只填缺失字段；description 保留现有值。skip 不改已匹配条目。sourceId 对应唯一已有歌曲时合并；同一来源对应多首歌时不会盲目覆盖。标题/艺人精确匹配可链接已有歌曲并新增 source 关系。
- 单曲导入不创建专辑实体；专辑/歌单型资源可能创建或增量更新 collection，并同步曲目快照/关系及封面。
- 外部解析与导入依赖站点音乐解析/播放服务；未配置测试服务时只能依据本地 parser/helper 和现有测试做静态契约核对，不对生产平台发请求。
- POST /api/music/from-netease|from-qq|from-kugou|from-baidu|from-kuwo：管理员旧入口全部返回 410，正文引导 /api/music/import；不要按成功导入接口使用。

### 歌曲封面、专辑关联、伴奏和自定义链接

- GET /:docId/covers：{covers:[{id,assetId,storageKey,url,thumbnailUrl,isDefault,sortOrder}]}。
- POST /:docId/covers：管理员 body assetId、isDefault 可选，assetId 必须是本人的 ready media asset；201 {cover}。
- DELETE /:docId/covers：管理员 body coverIds（1–200 个唯一字符串），循环逐项处理，返回 {success,deleted}；缺一项不会使其他成功项自动回滚。DELETE /:docId/covers/:coverId 单删；PATCH /:docId/covers/:coverId/default 设默认并清除 coverAlbumDocId。
- GET /:docId/albums：{relations:[{id,songDocId,albumDocId,discNumber,trackOrder,isDisplay,album}]}；读取时若已有关系但没有展示关系，会将排序首项补为展示关系。
- POST /:docId/albums：管理员 body albumDocId 必填，discNumber 默认1、范围1–20；trackOrder 默认0、范围0–5000；isDisplay 默认false。创建关系而非创建专辑；重复关联 409。成功 201 {song}，同时同步专辑 tracks。
- PATCH /:docId/albums/:albumDocId：只更新提供的 discNumber/trackOrder/isDisplay，isDisplay=true 会清同歌曲其他展示关系；返回 {song}。
- DELETE 同路径：删除关系并重建专辑曲目快照；若歌曲仍有关联但没有展示关系，服务端选排序首项；返回 {song}。
- GET /:docId/instrumentals 与 /:docId/instrumental-for：分别列原曲伴奏与关联原曲；POST /:docId/instrumentals body instrumentalSongDocId 必填，目标必须是已登记伴奏歌曲，否则 400；重复关联 409；201 {relation}。DELETE /:docId/instrumentals/:instrumentalSongDocId 删除关系。
- PATCH /:docId/custom-platforms：管理员 body customPlatformLinks 整体替换；元素为 {label,url}，label≤30字符，url≤2048且只允许 http/https，最多10项；无效项丢弃、重复项去重、按上限截断。GET /:docId/posts 返回关联且对当前用户可见帖子。

自定义平台链接/上传封面不接受任意可访问 URL 代替资产权限。重复 source 的 duplicates 是提示，不是冲突；覆盖导入为破坏性写入，先对照候选再使用。

### 管理员本地创建、关联、上传封面与重排

不调用第三方音乐平台：创建歌曲/专辑后用返回 docId 建立关系；再创建上传会话、上传图片、finalize、用 asset.id 添加默认歌曲封面。最后从专辑详情生成完整 tracks 快照；jq 用于从上一步 JSON 取 ID 与构造请求体。

```bash
SONG_JSON=$(curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"title":"本地歌曲","artists":["示例艺人"]}' "$BASE_URL/api/music")
SONG_DOC_ID=$(printf '%s' "$SONG_JSON" | jq -r '.song.docId')
ALBUM_JSON=$(curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"title":"本地专辑","artist":"示例艺人"}' "$BASE_URL/api/albums")
ALBUM_DOC_ID=$(printf '%s' "$ALBUM_JSON" | jq -r '.album.docId')
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg albumDocId "$ALBUM_DOC_ID" '{albumDocId:$albumDocId,discNumber:1,trackOrder:0,isDisplay:true}')" \
  "$BASE_URL/api/music/$SONG_DOC_ID/albums"
UPLOAD_JSON=$(curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"maxFiles":1}' "$BASE_URL/api/uploads/sessions")
SESSION_ID=$(printf '%s' "$UPLOAD_JSON" | jq -r '.session.id')
FILE_JSON=$(curl --fail-with-body -H "$AUTH_HEADER" -F 'file=@./cover.png' \
  "$BASE_URL/api/uploads/sessions/$SESSION_ID/files")
ASSET_ID=$(printf '%s' "$FILE_JSON" | jq -r '.asset.id')
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/uploads/sessions/$SESSION_ID/finalize"
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg assetId "$ASSET_ID" '{assetId:$assetId,isDefault:true}')" \
  "$BASE_URL/api/music/$SONG_DOC_ID/covers"
ALBUM_SLUG=$(printf '%s' "$ALBUM_JSON" | jq -r '.album.slug')
ALBUM_DETAIL=$(curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/albums/$ALBUM_SLUG")
TRACKS=$(printf '%s' "$ALBUM_DETAIL" | jq -c '[.album.discs[] | {disc,name,songs:[.songs[] | {songDocId,trackOrder}]}]')
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -nc --argjson tracks "$TRACKS" '{tracks:$tracks}')" \
  "$BASE_URL/api/albums/$ALBUM_DOC_ID/tracks/reorder"
```

### 外部资源预览与导入流程

仅当站点已配置测试音乐解析/播放服务及测试 URL 时调用；不要对生产平台作冒烟请求。parse-url 只做预览；保存 resource.songs[].sourceId 后提交 import。HTTP 响应后仍检查 summary.imported/skipped/failed、linkedSongs 与 collection。

```bash
MUSIC_URL='替换为批准的测试音乐 URL'
PREVIEW=$(curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg url "$MUSIC_URL" '{url:$url}')" "$BASE_URL/api/music/parse-url")
SOURCE_IDS=$(printf '%s' "$PREVIEW" | jq -c '[.resource.songs[].sourceId]')
IMPORT_BODY=$(jq -nc --arg url "$MUSIC_URL" --argjson ids "$SOURCE_IDS" \
  '{url:$url,selectedSongIds:$ids,duplicateStrategy:"fill"}')
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$IMPORT_BODY" "$BASE_URL/api/music/import"
```

### 逐接口契约（32 项）

<a id="api-get-api-music"></a>

### GET /api/music

- 用途：读取 music；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query page integer default1; limit integer1–100 default20; tag?:string; albumDocId?:business docId; includeInstrumentals:boolean default true; sortOrder=asc|desc default desc；body/multipart 此处理器不读取 JSON body；解析 schema query parameters；数值/布尔解析 limit: integer; default 20; range 1–100；page: integer; default 1；includeInstrumentals: boolean; default true。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>songs</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取音乐失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music?page=1&limit=20&includeInstrumentals=true&sortOrder=desc"
```

<a id="api-get-api-music-tags"></a>

### GET /api/music/tags

- 用途：读取 music / tags；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>tags</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/tags"
```

<a id="api-post-api-music"></a>

### POST /api/music

- 用途：创建/提交/触发 music；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart title required≤200; artists nonempty string array; credits/tags/sources/customPlatformLinks optional; lyric≤500KiB; description≤5000; releaseDate YYYY-MM-DD|null; durationMs positive integer|null; playableOverride=auto|enabled|disabled；解析 schema create song。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>song</code>、<code>duplicates</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: 播放状态无效 / 发行日期或时长格式无效 / 缺少歌曲信息；HTTP 500: 添加歌曲失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离歌曲","artists":["示例艺人"]}' "$BASE_URL/api/music"
```

<a id="api-post-api-music-parse-url"></a>

### POST /api/music/parse-url

- 用途：创建/提交/触发 music / parse url；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart url: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>resource</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供音乐链接 / 无法识别的音乐链接；HTTP 500: 解析音乐链接失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"url":"https://example.invalid"}' "$BASE_URL/api/music/parse-url"
```

<a id="api-post-api-music-import"></a>

### POST /api/music/import

- 用途：创建/提交/触发 music / import；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart duplicateStrategy: optional string；selectedSongIds: optional array（元素以 handler 检查为准）；url: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>summary</code>、<code>linked</code>、<code>linkedSongs</code>、<code>importedSongs</code>、<code>collection</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供音乐链接 / 无法识别的音乐链接 / 没有可导入的歌曲；HTTP 500: 导入音乐失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"duplicateStrategy":"fill","selectedSongIds":["REPLACE_WITH_ID"],"url":"https://example.invalid"}' "$BASE_URL/api/music/import"
```

<a id="api-post-api-music-from-netease"></a>

### POST /api/music/from-netease

- 用途：创建/提交/触发 music / from netease；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 410。HTTP 410: 请使用通用导入接口 /api/music/import。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/music/from-netease"
```

<a id="api-post-api-music-from-qq"></a>

### POST /api/music/from-qq

- 用途：创建/提交/触发 music / from qq；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 410。HTTP 410: 请使用通用导入接口 /api/music/import。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/music/from-qq"
```

<a id="api-post-api-music-from-kugou"></a>

### POST /api/music/from-kugou

- 用途：创建/提交/触发 music / from kugou；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 410。HTTP 410: 请使用通用导入接口 /api/music/import。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/music/from-kugou"
```

<a id="api-post-api-music-from-baidu"></a>

### POST /api/music/from-baidu

- 用途：创建/提交/触发 music / from baidu；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 410。HTTP 410: 请使用通用导入接口 /api/music/import。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/music/from-baidu"
```

<a id="api-post-api-music-from-kuwo"></a>

### POST /api/music/from-kuwo

- 用途：创建/提交/触发 music / from kuwo；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：401, 403, 410。HTTP 410: 请使用通用导入接口 /api/music/import。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/music/from-kuwo"
```

<a id="api-get-api-music-docid-play-url"></a>

### GET /api/music/:docId/play-url

- 用途：读取 music / play url；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>playUrl</code>、<code>mode</code>、<code>platform</code>、<code>sourceId</code>、<code>playable</code>、<code>cached</code>、<code>cacheExpiresAt</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 获取播放链接失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/play-url"
```

<a id="api-get-api-music-instrumental-targets"></a>

### GET /api/music/instrumental-targets

- 用途：读取 music / instrumental targets；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>docIds</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取伴奏列表失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/instrumental-targets"
```

<a id="api-get-api-music-match-suggestions"></a>

### GET /api/music/match-suggestions

- 用途：读取 music / match suggestions；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query platform:title source required; title required string; artists or artist string/list; max5 returned；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>suggestions</code>、<code>autoSelectedIndex</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 400: 缺少必要参数：platform, title, artists / 无效的平台；HTTP 500: 搜索匹配歌曲失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/match-suggestions?platform=netease&title=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2&artists=%E7%A4%BA%E4%BE%8B%E8%89%BA%E4%BA%BA"
```

<a id="api-get-api-music-slug"></a>

### GET /api/music/:slug

- 用途：读取 music；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>song</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 获取歌曲详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_SLUG"
```

<a id="api-delete-api-music-docid"></a>

### DELETE /api/music/:docId

- 用途：删除/移除 music；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 删除歌曲失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/music/REPLACE_DOCID"
```

<a id="api-patch-api-music-docid"></a>

### PATCH /api/music/:docId

- 用途：部分更新 music；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart only supplied fields update; text/list fields use song limits; playableOverride=auto|enabled|disabled; lyric/description/releaseDate/durationMs can be null to clear; sources/customPlatformLinks when supplied replace entire set；解析 schema partial song update。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>song</code>、<code>duplicates</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 播放状态无效 / 发行日期格式无效 / 时长格式无效 / 请至少填写一位歌手 / 封面来源专辑不存在；HTTP 404: 歌曲不存在；HTTP 500: 更新歌曲失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"替换为歌曲标题"}' "$BASE_URL/api/music/REPLACE_DOCID"
```

<a id="api-get-api-music-docid-covers"></a>

### GET /api/music/:docId/covers

- 用途：读取 music / covers；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>covers</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 获取歌曲封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/covers"
```

<a id="api-post-api-music-docid-covers"></a>

### POST /api/music/:docId/covers

- 用途：创建/提交/触发 music / covers；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart assetId: required string；isDefault: optional boolean/string parser；数值/布尔解析 isDefault: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>cover</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 404, 500。HTTP 400: 缺少 assetId；HTTP 404: 歌曲不存在；HTTP 500: 添加歌曲封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"assetId":"REPLACE_WITH_ASSET_ID","isDefault":true}' "$BASE_URL/api/music/REPLACE_DOCID/covers"
```

<a id="api-delete-api-music-docid-covers"></a>

### DELETE /api/music/:docId/covers

- 用途：删除/移除 music / covers；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart coverIds array1–200; trim/deduplicate, process each independently；validateBody schema adminBatchSongCoversSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>deleted</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 404: 歌曲不存在 / 封面不存在；HTTP 500: 批量删除歌曲封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"coverIds":["REPLACE_WITH_COVER_ID"]}' "$BASE_URL/api/music/REPLACE_DOCID/covers"
```

<a id="api-delete-api-music-docid-covers-coverid"></a>

### DELETE /api/music/:docId/covers/:coverId

- 用途：删除/移除 music / covers；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path coverId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 封面不存在；HTTP 500: 删除歌曲封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/music/REPLACE_DOCID/covers/REPLACE_COVERID"
```

<a id="api-patch-api-music-docid-covers-coverid-default"></a>

### PATCH /api/music/:docId/covers/:coverId/default

- 用途：部分更新 music / covers / default；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path coverId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 封面不存在；HTTP 500: 设置默认封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" "$BASE_URL/api/music/REPLACE_DOCID/covers/REPLACE_COVERID/default"
```

<a id="api-get-api-music-docid-albums"></a>

### GET /api/music/:docId/albums

- 用途：读取 music / albums；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>relations</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 获取歌曲关联专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/albums"
```

<a id="api-post-api-music-docid-albums"></a>

### POST /api/music/:docId/albums

- 用途：创建/提交/触发 music / albums；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart albumDocId: required string；discNumber: optional integer（按 handler 范围/默认解析）；isDisplay: optional boolean/string parser；trackOrder: optional integer（按 handler 范围/默认解析）；数值/布尔解析 discNumber: integer; default 1; range 1–20；trackOrder: integer; default 0; range 0–5000；isDisplay: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>song</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 409, 500。HTTP 400: 缺少 albumDocId；HTTP 404: 歌曲或专辑不存在；HTTP 409: 歌曲已经关联此专辑；HTTP 500: 创建歌曲专辑关联失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"albumDocId":"REPLACE_WITH_ALBUM_DOC_ID","discNumber":1,"isDisplay":true,"trackOrder":1}' "$BASE_URL/api/music/REPLACE_DOCID/albums"
```

<a id="api-patch-api-music-docid-albums-albumdocid"></a>

### PATCH /api/music/:docId/albums/:albumDocId

- 用途：部分更新 music / albums；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path albumDocId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart discNumber: optional integer（按 handler 范围/默认解析）；isDisplay: optional boolean/string parser；trackOrder: optional integer（按 handler 范围/默认解析）；数值/布尔解析 discNumber: integer; default existing.discNumber; range 1–20,；trackOrder: integer; default existing.trackOrder; range 0–5000,。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>song</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 关联不存在 / 歌曲或专辑不存在；HTTP 500: 更新歌曲专辑关联失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"discNumber":1,"isDisplay":true,"trackOrder":1}' "$BASE_URL/api/music/REPLACE_DOCID/albums/REPLACE_ALBUMDOCID"
```

<a id="api-delete-api-music-docid-albums-albumdocid"></a>

### DELETE /api/music/:docId/albums/:albumDocId

- 用途：删除/移除 music / albums；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path albumDocId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>song</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 关联不存在 / 歌曲或专辑不存在；HTTP 500: 删除歌曲专辑关联失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/music/REPLACE_DOCID/albums/REPLACE_ALBUMDOCID"
```

<a id="api-get-api-music-docid-instrumentals"></a>

### GET /api/music/:docId/instrumentals

- 用途：读取 music / instrumentals；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>instrumentals</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取歌曲伴奏失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/instrumentals"
```

<a id="api-get-api-music-docid-instrumental-for"></a>

### GET /api/music/:docId/instrumental-for

- 用途：读取 music / instrumental for；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>originals</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取歌曲原曲失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/instrumental-for"
```

<a id="api-post-api-music-docid-instrumentals"></a>

### POST /api/music/:docId/instrumentals

- 用途：创建/提交/触发 music / instrumentals；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart instrumentalSongDocId: required string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>relation</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 409, 500。HTTP 400: 缺少 instrumentalSongDocId / 目标歌曲不是伴奏；HTTP 404: 歌曲不存在；HTTP 409: 该伴奏已关联；HTTP 500: 创建歌曲伴奏关联失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"instrumentalSongDocId":"REPLACE_WITH_SONG_DOC_ID"}' "$BASE_URL/api/music/REPLACE_DOCID/instrumentals"
```

<a id="api-delete-api-music-docid-instrumentals-instrumentalsongdocid"></a>

### DELETE /api/music/:docId/instrumentals/:instrumentalSongDocId

- 用途：删除/移除 music / instrumentals；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；instrumentalSongDocId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 关联不存在；HTTP 500: 删除歌曲伴奏关联失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/music/REPLACE_DOCID/instrumentals/REPLACE_INSTRUMENTALSONGDOCID"
```

<a id="api-patch-api-music-docid-custom-platforms"></a>

### PATCH /api/music/:docId/custom-platforms

- 用途：部分更新 music / custom platforms；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart customPlatformLinks: optional Array<{label:string,url:http/https}>（无效项丢弃）。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>song</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 歌曲不存在；HTTP 500: 更新自定义平台失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"customPlatformLinks":[{"label":"平台","url":"https://example.invalid"}]}' "$BASE_URL/api/music/REPLACE_DOCID/custom-platforms"
```

<a id="api-get-api-music-docid-posts"></a>

### GET /api/music/:docId/posts

- 用途：读取 music / posts；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query limit integer1–100 default20; sort=latest|hot|recommended default latest；body/multipart 此处理器不读取 JSON body；解析 schema linked post query；数值/布尔解析 limit: integer; default 20; range 1–100。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>posts</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取音乐关联帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/REPLACE_DOCID/posts?limit=20&sort=latest"
```

<a id="api-get-api-music-song-id"></a>

### GET /api/music/song/:id

- 用途：读取 music / song；目标资源与完整业务约束见第 9 章「音乐管理」。
- 权限：公开/可选身份。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>playUrl</code>、<code>playMeta</code>、<code>docId</code>、<code>title</code>、<code>artists</code>、<code>album</code>、<code>description</code>、<code>releaseDate</code>、<code>durationMs</code>、<code>cover</code>、<code>audioUrl</code>、<code>sources</code>、<code>playable</code>、<code>customPlatformLinks</code>、<code>createdAt</code>、<code>updatedAt</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 未找到歌曲信息；HTTP 500: Failed to fetch song metadata。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/music/song/REPLACE_ID"
```

## 10. 专辑管理

- GET /api/albums：query platform、page、limit(1–100，默认20)、sortOrder=asc|desc（默认desc）；返回 albums、分页元数据、trackCount。GET /:slug 使用公开数字 slug，详情返回 album、关联 tracks/discs；DELETE/ PATCH 等写操作使用 docId。
- GET /:id/posts 中 id 实际是 album docId，不是公开 slug；query limit(1–100) 与 sort=latest|hot|recommended；只返回可见关联帖子，无分页元数据。
- POST /api/albums：管理员，最少 {title,artist}；description、releaseDate、tracks、sources 可选。tracks 是碟片数组，source ID 可共享并在 duplicates 提醒。201 {album,duplicates}。
- PATCH /:docId：管理员 partial 更新 title/artist/description/releaseDate/tracks/sources；description:null 清空；releaseDate:null 清除；tracks 提交时是完整碟片快照；sources 提交时整体替换，[] 清空；未提交字段保留。成功 {album,duplicates}。
- DELETE /:docId：管理员软删除专辑；物理删除是后台 permanent 分支。
- GET /:docId/covers、POST /:docId/covers、DELETE /:docId/covers、DELETE /:docId/covers/:coverId、PATCH /:docId/covers/:coverId/default 与歌曲封面同结构。创建封面使用本人 ready assetId；批删 body coverIds 1–200 去重 ID；批删返回实际 deleted 数，不代表每项都存在。
- POST /:docId/sync-covers-to-songs：管理员；body songDocIds 可选。省略/空数组时同步该专辑所有已关联歌曲；非空则只同步命中的关联歌曲。专辑必须有可展示封面；返回 {success,syncedCount}。
- POST /:docId/discs：管理员；body discNumber 可选（默认下一个可用碟号，1–20）、name 可选（默认 Disc N）；碟片不能重复，201 {disc}。
- DELETE /:docId/discs/:discNumber：只能删除空碟片；含曲目时 400。
- PATCH /:docId/tracks/reorder：管理员；body {tracks:[{disc,name,songs:[{songDocId,trackOrder}]}]}，最多 20 碟、每碟最多 5000 曲；disc 1–20 且唯一，name 非空且受长度限制；songDocId 非空且最多 191 字符；trackOrder 0–5000；歌曲不能跨碟重复。此为全量快照，必须包含专辑当前全部未删除关联歌曲，否则 400；成功 {success:true}。
- POST /:docId/sync-display-to-songs：管理员；可选 songDocIds；省略时全部设置为该专辑展示曲目，有值时仅更新已与此专辑关联的指定曲目；返回 {success,updated}。

```bash
# 用创建接口返回的 docId 建立歌曲与专辑关系
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data '{"albumDocId":"替换为专辑docId","discNumber":1,"trackOrder":0,"isDisplay":true}' \
  "$BASE_URL/api/music/替换为歌曲docId/albums"
```

完整专辑入库流程：管理员创建歌曲 → 创建专辑 → 用两个响应的 docId 建关联 → GET /api/music/:docId/albums 确认关系 → 通过上传会话上传并 finalize → 用 asset.id 添加默认封面 → 从专辑详情或后台取得当前全部关联歌曲，构造 tracks 快照并调用 reorder。reorder 缺少当前歌曲会 400；不要把专辑内部 tracks JSON 当作局部 patch。

### 逐接口契约（16 项）

<a id="api-get-api-albums"></a>

### GET /api/albums

- 用途：读取 albums；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query platform?:string; page integer default1; limit integer1–100 default20; sortOrder=asc|desc default desc；body/multipart 此处理器不读取 JSON body；解析 schema query parameters；数值/布尔解析 limit: integer; default 20; range 1–100；page: integer; default 1。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>albums</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>；DTO transformer toAlbumResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/albums?page=1&limit=20&sortOrder=desc"
```

<a id="api-get-api-albums-slug"></a>

### GET /api/albums/:slug

- 用途：读取 albums；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>album</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toSongResponse、toAlbumResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 专辑不存在；HTTP 500: 获取专辑详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/albums/REPLACE_SLUG"
```

<a id="api-get-api-albums-id-posts"></a>

### GET /api/albums/:id/posts

- 用途：读取 albums / posts；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：公开/可选身份。
- 参数契约：path id: required string path parameter；query id in path is album docId; limit integer1–100 default20; sort=latest|hot|recommended default latest；body/multipart 此处理器不读取 JSON body；解析 schema linked post query；数值/布尔解析 limit: integer; default 20; range 1–100。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>posts</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toPostResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404, 500。HTTP 404: 专辑不存在；HTTP 500: 获取专辑关联帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/albums/REPLACE_ID/posts?limit=20&sort=latest"
```

<a id="api-post-api-albums"></a>

### POST /api/albums

- 用途：创建/提交/触发 albums；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart title:string required≤200; artist:string required≤200; description?:string≤5000; releaseDate?:YYYY-MM-DD|null; tracks?:Array<{disc?:integer1–20,name?:string≤120,songs?:Array<{songDocId:business docId,trackOrder?:integer0–5000}>}>; sources?:external source list, replaced only when supplied；解析 schema album create parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>album</code>、<code>duplicates</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toAlbumResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: 发行日期格式无效 / 缺少专辑信息；HTTP 500: 创建专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离专辑","artist":"示例艺人"}' "$BASE_URL/api/albums"
```

<a id="api-patch-api-albums-docid"></a>

### PATCH /api/albums/:docId

- 用途：部分更新 albums；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart title?/artist?:string≤200; description?:string|null≤5000; releaseDate?:YYYY-MM-DD|null; tracks?:complete normalized disc list; sources?:external source list, whole replacement when supplied; omitted fields unchanged；解析 schema album partial update parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>album</code>、<code>duplicates</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toAlbumResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 专辑标题不能为空 / 艺人不能为空 / 发行日期格式无效；HTTP 404: 专辑不存在；HTTP 500: 更新专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"替换为专辑标题"}' "$BASE_URL/api/albums/REPLACE_DOCID"
```

<a id="api-delete-api-albums-docid"></a>

### DELETE /api/albums/:docId

- 用途：删除/移除 albums；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 专辑不存在；HTTP 500: 删除专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/albums/REPLACE_DOCID"
```

<a id="api-get-api-albums-docid-covers"></a>

### GET /api/albums/:docId/covers

- 用途：读取 albums / covers；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：公开/可选身份。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>covers</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 专辑不存在；HTTP 500: 获取专辑封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/albums/REPLACE_DOCID/covers"
```

<a id="api-post-api-albums-docid-covers"></a>

### POST /api/albums/:docId/covers

- 用途：创建/提交/触发 albums / covers；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart assetId: required string；isDefault: optional boolean/string parser；数值/布尔解析 isDefault: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>cover</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 404, 500。HTTP 400: 缺少 assetId；HTTP 404: 专辑不存在；HTTP 500: 添加专辑封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"assetId":"REPLACE_WITH_ASSET_ID","isDefault":true}' "$BASE_URL/api/albums/REPLACE_DOCID/covers"
```

<a id="api-delete-api-albums-docid-covers"></a>

### DELETE /api/albums/:docId/covers

- 用途：删除/移除 albums / covers；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart coverIds array1–200; trim/deduplicate, process each independently；validateBody schema adminBatchAlbumCoversSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>deleted</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 404: 专辑不存在 / 封面不存在；HTTP 500: 删除专辑封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"coverIds":["REPLACE_WITH_COVER_ID"]}' "$BASE_URL/api/albums/REPLACE_DOCID/covers"
```

<a id="api-delete-api-albums-docid-covers-coverid"></a>

### DELETE /api/albums/:docId/covers/:coverId

- 用途：删除/移除 albums / covers；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path coverId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 专辑不存在 / 封面不存在；HTTP 500: 删除专辑封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/albums/REPLACE_DOCID/covers/REPLACE_COVERID"
```

<a id="api-patch-api-albums-docid-covers-coverid-default"></a>

### PATCH /api/albums/:docId/covers/:coverId/default

- 用途：部分更新 albums / covers / default；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path coverId: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 404: 专辑不存在 / 封面不存在；HTTP 500: 设置默认封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" "$BASE_URL/api/albums/REPLACE_DOCID/covers/REPLACE_COVERID/default"
```

<a id="api-post-api-albums-docid-sync-covers-to-songs"></a>

### POST /api/albums/:docId/sync-covers-to-songs

- 用途：创建/提交/触发 albums / sync covers to songs；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart songDocIds: optional array（元素以 handler 检查为准）。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>syncedCount</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 专辑没有可同步的封面 / 没有可同步的歌曲；HTTP 404: 专辑不存在；HTTP 500: 同步专辑封面失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"songDocIds":["REPLACE_WITH_ID"]}' "$BASE_URL/api/albums/REPLACE_DOCID/sync-covers-to-songs"
```

<a id="api-post-api-albums-docid-discs"></a>

### POST /api/albums/:docId/discs

- 用途：创建/提交/触发 albums / discs；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart discNumber: optional integer（按 handler 范围/默认解析）；name: optional string；数值/布尔解析 discNumber: integer; default 0; range 1–20。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>disc</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 500。HTTP 400: Disc 已存在；HTTP 404: 专辑不存在；HTTP 500: 新增 Disc 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"discNumber":1,"name":"文档测试名称"}' "$BASE_URL/api/albums/REPLACE_DOCID/discs"
```

<a id="api-delete-api-albums-docid-discs-discnumber"></a>

### DELETE /api/albums/:docId/discs/:discNumber

- 用途：删除/移除 albums / discs；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path discNumber: required string path parameter；docId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: Disc 参数无效 / Disc 下仍有歌曲，无法删除；HTTP 404: 专辑不存在 / Disc 不存在；HTTP 500: 删除 Disc 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/albums/REPLACE_DOCID/discs/REPLACE_DISCNUMBER"
```

<a id="api-patch-api-albums-docid-tracks-reorder"></a>

### PATCH /api/albums/:docId/tracks/reorder

- 用途：部分更新 albums / tracks / reorder；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart tracks complete snapshot; ≤20 discs; disc1–20 unique; name≤120; songs≤5000; songDocId≤191, trackOrder0–5000; must include every current relation exactly once；validateBody schema adminAlbumTrackReorderSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 曲目快照必须包含专辑当前全部歌曲；HTTP 404: 专辑不存在；HTTP 500: 重排专辑曲目失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"tracks":[{"disc":1,"name":"Disc 1","songs":[{"songDocId":"REPLACE_WITH_SONG_DOC_ID","trackOrder":0}]}]}' "$BASE_URL/api/albums/REPLACE_DOCID/tracks/reorder"
```

<a id="api-post-api-albums-docid-sync-display-to-songs"></a>

### POST /api/albums/:docId/sync-display-to-songs

- 用途：创建/提交/触发 albums / sync display to songs；目标资源与完整业务约束见第 10 章「专辑管理」。
- 权限：管理员。
- 参数契约：path docId: required string path parameter；query 无 query 字段；body/multipart songDocIds: optional array（元素以 handler 检查为准）。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>updated</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 同步展示专辑失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"songDocIds":["REPLACE_WITH_ID"]}' "$BASE_URL/api/albums/REPLACE_DOCID/sync-display-to-songs"
```

## 11. 活动与票务

### 活动

- GET /api/events：公开，query tag、sortOrder=asc|upcoming|desc（默认desc）、page、limit；upcoming 按未来时间排序；返回 events,total,page,limit,totalPages,hasMore。GET /tags 返回全站未删除活动标签。GET /:slug 使用公开数字 slug。
- POST /api/events 与 PUT /api/events/:id：管理员，使用完整写入 schema。title 必填；location/content/timeSlots/timeStatus/ticketPrices/saleTimes/lineup/tags/externalLinks/relatedLinks/coverAssetId/uploadSessionId/posters 可选并按 schema 默认空值。至少提供 timeSlots 或 timeStatus=pending|postponed，不能同时有明确时间和待定/推迟。
  - timeSlots 元素：{type:date|datetime,start,end?}；date 用 YYYY-MM-DD，datetime 用 YYYY-MM-DDTHH:mm。
  - saleTimes 元素：{time:YYYY-MM-DDTHH:mm,note?}；ticketPrices 元素严格为 {description?,price:number>=0}。
  - externalLinks/relatedLinks 元素 {label?,url?}，各最多20条、label最多80字符；外部 URL 只允许有效 http/https（最多2048字符），空行丢弃，非空行 label/url 必须同时提供；活动链接不允许站内相对路径；图片封面/海报使用 assetId/imageId 并可传 uploadSessionId，不提交任意图片 URL 替代资产。
  - POST 返回 201 {event}；PUT 是完整覆盖写入，海报会先删除再创建新集合，未传 cover/posters 等默认内容可能被清除。修改后会尝试释放不再引用的旧媒体资源。
- DELETE /:id 管理员软删除并释放关联媒体；POST /:id/restore 恢复已删除活动；DELETE /:id/permanent 永久删除，先把关联票务改为自定义活动名称再删除活动。永久删除不可逆。

### 票务信息

- GET /api/ticket-listings：公开已发布记录；query type=offer|request、eventId、q、page、limit；返回 listings 与分页字段。GET /events 可按 q 搜索活动，limit 1–20 默认20；GET /mine 需认证，返回本人记录（含私有详情）。
- GET /:slug：slug 为公开数字 slug；私有 description/contact 仅作者或管理员可见。
- POST /api/ticket-listings 和 PUT /:id 使用 strict 完整 schema：type、quantity(1–10000)、ticketTier(最多100字符)、contact(最多100 KiB) 必填；seat(最多200)/description(最多500 KiB) 默认空；eventId 与 customEventName 必须二选一；status 可选 draft/pending/published。PUT 为全量替换，普通用户编辑已发布/待审条目会重新提交审核。POST 201 {listing}。
- DELETE /:id：作者或管理员软删除；删除他人记录需 reason；返回 {success:true}。管理员通用恢复/永久删除见第 14 章。

### 逐接口契约（15 项）

<a id="api-get-api-ticket-listings"></a>

### GET /api/ticket-listings

- 用途：读取 ticket listings；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query type?:offer|request; eventId?:string internal event ID; q?:string; page:integer default1; limit:integer default20 clamp1–100；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>listings</code>、<code>nested DTO fields</code>；HTTP 400: <code>error</code>；DTO transformer toTicketListingListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400。HTTP 400: 无效的盘票类型。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/ticket-listings?type=offer&page=1&limit=20"
```

<a id="api-get-api-ticket-listings-events"></a>

### GET /api/ticket-listings/events

- 用途：读取 ticket listings / events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query q?:string; limit:integer 1–20 default20；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>events</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400。HTTP 400 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/ticket-listings/events?q=%E7%A4%BA%E4%BE%8B&limit=20"
```

<a id="api-get-api-ticket-listings-mine"></a>

### GET /api/ticket-listings/mine

- 用途：读取 ticket listings / mine；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>listings</code>、<code>nested DTO fields</code>；DTO transformer toTicketListingListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/ticket-listings/mine?limit=20&page=1"
```

<a id="api-get-api-ticket-listings-slug"></a>

### GET /api/ticket-listings/:slug

- 用途：读取 ticket listings；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>listing</code>；HTTP 404: <code>error</code>；DTO transformer toTicketListingResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404。HTTP 404: 盘票信息未找到。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/ticket-listings/REPLACE_SLUG"
```

<a id="api-post-api-ticket-listings"></a>

### POST /api/ticket-listings

- 用途：创建/提交/触发 ticket listings；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：已认证且未封禁。限流器 postWriteLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart strict；type=offer|request required；quantity integer1–10000；ticketTier required1–100 chars；contact required≤100KiB；seat optional≤200/default""；description optional≤500KiB/default""；eventId and customEventName exactly one；status=draft|pending|published optional；validateBody schema ticketListingWriteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>listing</code>；HTTP 400: <code>error</code>；DTO transformer toTicketListingResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403。HTTP 400: 关联活动不存在或已删除。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"offer","quantity":1,"ticketTier":"站票","contact":"隔离测试联系方式","customEventName":"隔离测试活动","status":"draft"}' "$BASE_URL/api/ticket-listings"
```

<a id="api-put-api-ticket-listings-id"></a>

### PUT /api/ticket-listings/:id

- 用途：更新/执行 ticket listings；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：已认证且未封禁。限流器 postWriteLimiter。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart strict；type=offer|request required；quantity integer1–10000；ticketTier required1–100 chars；contact required≤100KiB；seat optional≤200/default""；description optional≤500KiB/default""；eventId and customEventName exactly one；status=draft|pending|published optional；validateBody schema ticketListingWriteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>listing</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；DTO transformer toTicketListingResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404。HTTP 400: 关联活动不存在或已删除；HTTP 403: 无权编辑该盘票信息；HTTP 404: 盘票信息未找到。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"offer","quantity":1,"ticketTier":"站票","contact":"隔离测试联系方式","customEventName":"隔离测试活动","status":"draft"}' "$BASE_URL/api/ticket-listings/REPLACE_ID"
```

<a id="api-delete-api-ticket-listings-id"></a>

### DELETE /api/ticket-listings/:id

- 用途：删除/移除 ticket listings；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart reason?:string; owner can omit, deleting another owner requires reason；validateBody schema postDeleteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404。HTTP 400: 删除理由不能为空；HTTP 403: 无权删除该盘票信息；HTTP 404: 盘票信息未找到。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"reason":"隔离测试原因"}' "$BASE_URL/api/ticket-listings/REPLACE_ID"
```

<a id="api-get-api-events"></a>

### GET /api/events

- 用途：读取 events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query tag?:string; sortOrder=asc|upcoming|desc default desc; page integer default1; limit integer default20 clamp1–100；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>events</code>、<code>total</code>、<code>page</code>、<code>limit</code>、<code>totalPages</code>、<code>hasMore</code>；HTTP 400: <code>error</code>；DTO transformer toEventListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400。HTTP 400 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/events?sortOrder=upcoming&page=1&limit=20"
```

<a id="api-get-api-events-tags"></a>

### GET /api/events/tags

- 用途：读取 events / tags；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>tags</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/events/tags"
```

<a id="api-get-api-events-slug"></a>

### GET /api/events/:slug

- 用途：读取 events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：公开/可选身份。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>event</code>；HTTP 404: <code>error</code>；DTO transformer toEventResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404。HTTP 404: 活动不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/events/REPLACE_SLUG"
```

<a id="api-post-api-events"></a>

### POST /api/events

- 用途：创建/提交/触发 events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart title:string required trim max200; location:string max200 default""; content:string max500KiB default""; timeSlots array≤30 of {type:date|datetime,start:YYYY-MM-DD[THH:mm],end?}; timeStatus=pending|postponed|null default null; ticketPrices≤30 of {description?,price finite≥0}; saleTimes≤30 of {time:YYYY-MM-DDTHH:mm,note?}; lineup≤50 strings max100; tags≤30 strings max50 dedup; links≤20(label≤80); coverAssetId?:string|null; uploadSessionId?:string; posters array defaults[]；validateBody schema eventWriteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>event</code>；DTO transformer toEventResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403。HTTP 400/401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离测试活动","timeSlots":[{"type":"date","start":"2030-01-01"}]}' "$BASE_URL/api/events"
```

<a id="api-put-api-events-id"></a>

### PUT /api/events/:id

- 用途：更新/执行 events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart title:string required trim max200; location:string max200 default""; content:string max500KiB default""; timeSlots array≤30 of {type:date|datetime,start:YYYY-MM-DD[THH:mm],end?}; timeStatus=pending|postponed|null default null; ticketPrices≤30 of {description?,price finite≥0}; saleTimes≤30 of {time:YYYY-MM-DDTHH:mm,note?}; lineup≤50 strings max100; tags≤30 strings max50 dedup; links≤20(label≤80); coverAssetId?:string|null; uploadSessionId?:string; posters array defaults[]；validateBody schema eventWriteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>event</code>、<code>error</code>；HTTP 404: <code>error</code>；DTO transformer toEventResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404。HTTP 404: 活动不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"title":"隔离测试活动","timeSlots":[{"type":"date","start":"2030-01-01"}]}' "$BASE_URL/api/events/REPLACE_ID"
```

<a id="api-delete-api-events-id"></a>

### DELETE /api/events/:id

- 用途：删除/移除 events；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404。HTTP 404: 活动不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/events/REPLACE_ID"
```

<a id="api-post-api-events-id-restore"></a>

### POST /api/events/:id/restore

- 用途：创建/提交/触发 events / restore；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>event</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；DTO transformer toEventResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404。HTTP 400: 该记录未被删除；HTTP 404: 活动不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/events/REPLACE_ID/restore"
```

<a id="api-delete-api-events-id-permanent"></a>

### DELETE /api/events/:id/permanent

- 用途：删除/移除 events / permanent；目标资源与完整业务约束见第 11 章「活动与票务」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404。HTTP 404: 活动不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/events/REPLACE_ID/permanent"
```

## 12. 收藏、通知与公告

- GET /api/favorites：认证；query type=wiki|post|music|gallery 可选；最多读取最近 500 条并过滤当前不可见目标。返回 {favorites:[{id,targetType,targetId,createdAt,target}]}。
- POST /api/favorites：body {targetType,targetId}；类型对应 Wiki slug、帖子内部 id、歌曲 docId、图库内部 id；无权/不存在目标 404；upsert 幂等，201 {favorited:true}。
- DELETE /api/favorites/:type/:id：认证且未封禁；幂等删除，{favorited:false}。
- GET /api/notifications：认证；query page/limit、unread=true、type；返回 notifications、unreadCount 及分页元数据。通知 DTO 为 id/userUid/type/payload/isRead/createdAt。
- POST /:id/read、POST /read-all：只操作当前用户通知，返回 {success:true}；DELETE /:id 只删除本人通知。
- GET /api/announcements/latest：最新 active 未删除公告，包装 {announcement}，可为空。
- GET /list：公开 active 公告分页；GET /：管理员最多 100 条未删除公告。
- POST /api/announcements：管理员 body content 必填，link 可选、active 默认 true；201 {announcement}。PATCH /:id 仅处理提交的 active/content/link；DELETE /:id 为软删除并清最新公告缓存。

### 逐接口契约（13 项）

<a id="api-get-api-notifications"></a>

### GET /api/notifications

- 用途：读取 notifications；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query page integer default1; limit handler pagination; unread?:boolean query string; type?:string notification kind；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>notifications</code>、<code>unreadCount</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 获取通知失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/notifications?page=1&limit=20"
```

<a id="api-post-api-notifications-id-read"></a>

### POST /api/notifications/:id/read

- 用途：创建/提交/触发 notifications / read；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权操作该通知；HTTP 404: 通知不存在；HTTP 500: 标记已读失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/notifications/REPLACE_ID/read"
```

<a id="api-post-api-notifications-read-all"></a>

### POST /api/notifications/read-all

- 用途：创建/提交/触发 notifications / read all；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 全部标记已读失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/notifications/read-all"
```

<a id="api-delete-api-notifications-id"></a>

### DELETE /api/notifications/:id

- 用途：删除/移除 notifications；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404, 500。HTTP 403: 无权操作该通知；HTTP 404: 通知不存在；HTTP 500: 删除通知失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/notifications/REPLACE_ID"
```

<a id="api-get-api-favorites"></a>

### GET /api/favorites

- 用途：读取 favorites；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证。
- 参数契约：path 无 path 字段；query type?:wiki|post|music|gallery; omitted reads all types; each target is visibility-filtered；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>favorites</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse、toPostResponse、toGalleryResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 无效收藏类型；HTTP 500: 获取收藏列表失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/favorites?type=wiki"
```

<a id="api-post-api-favorites"></a>

### POST /api/favorites

- 用途：创建/提交/触发 favorites；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart targetType required enum wiki|post|music|gallery; targetId required string (slug/id/docId by type)；解析 schema manual favorite parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>favorited</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 404, 500。HTTP 400: 缺少必要字段；HTTP 404: 目标不存在；HTTP 500: 收藏失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"targetType":"post","targetId":"REPLACE_WITH_POST_ID"}' "$BASE_URL/api/favorites"
```

<a id="api-delete-api-favorites-type-id"></a>

### DELETE /api/favorites/:type/:id

- 用途：删除/移除 favorites；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；type: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>favorited</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 参数错误；HTTP 500: 取消收藏失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/favorites/REPLACE_TYPE/REPLACE_ID"
```

<a id="api-get-api-announcements-latest"></a>

### GET /api/announcements/latest

- 用途：读取 announcements / latest；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>announcement</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/announcements/latest"
```

<a id="api-get-api-announcements-list"></a>

### GET /api/announcements/list

- 用途：读取 announcements / list；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>announcements</code>、<code>nested DTO fields</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/announcements/list?limit=20&page=1"
```

<a id="api-get-api-announcements"></a>

### GET /api/announcements

- 用途：读取 announcements；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>announcements</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/announcements"
```

<a id="api-post-api-announcements"></a>

### POST /api/announcements

- 用途：创建/提交/触发 announcements；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart active: optional boolean；content: required string；link: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>announcement</code>；HTTP 400: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403。HTTP 400: 公告内容不能为空。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"active":true,"content":"文档测试内容","link":"REPLACE_LINK"}' "$BASE_URL/api/announcements"
```

<a id="api-patch-api-announcements-id"></a>

### PATCH /api/announcements/:id

- 用途：部分更新 announcements；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart active: optional boolean；content: optional string；link: optional string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>announcement</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"active":true,"content":"文档测试内容","link":"REPLACE_LINK"}' "$BASE_URL/api/announcements/REPLACE_ID"
```

<a id="api-delete-api-announcements-id"></a>

### DELETE /api/announcements/:id

- 用途：删除/移除 announcements；目标资源与完整业务约束见第 12 章「收藏、通知与公告」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 404。HTTP 404: 公告不存在。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/announcements/REPLACE_ID"
```

## 13. 搜索、地区与 EXIF

### 搜索

GET /api/search 是多领域关键词入口：query q、type=all|wiki|posts|galleries|music|albums|lyrics、mode=keyword|vector|hybrid、category、tags(逗号分隔)、startDate/endDate、detail，以及 wikiPage/postsPage/galleriesPage/musicPage/albumsPage/lyricsPage。默认 keyword/all；detail 控制多数领域是否匹配正文，歌词搜索始终按歌词内容。返回分领域分页结果与 searchMeta；分页固定按各分领域 page 查询。

vector/hybrid 在主搜索中只有 q、detail=true 才走向量路径。纯 vector 在功能关闭时 404；hybrid 可降级为关键词并在 searchMeta 标出 degraded/degradationReason。GET /text-semantic 与 /semantic-search 要求语义检索启用且 q 非空；前者只在 detail=true 请求文本向量结果。GET /hot-keywords 返回最多 20 项或配置关闭时空数组。GET /suggest 要求 q 至少 2 字符，返回关键字、Wiki、帖子、歌曲和专辑候选。

POST /api/search/by-image 使用 multipart image 或 imageBase64；须启用语义搜索，输出 sessionId 与分组结果。GET /by-image/:sessionId 必须由同一匿名身份/同一用户继续访问；会话 5 分钟过期，query source=semantic|wiki|post|gallery、page。过期 410，不能将 sessionId 当持久化搜索记录。

### 地区、地址与 EXIF

- GET /api/regions：query q、level(1–4)、parentCode、limit(1–100默认20)。q 存在时搜索；否则按 parentCode/level 返回省市或地区。GET /search 与 /suggest：q、limit(默认20/5，范围1–100)，缺 q 返回空 regions。
- GET /provinces、/cities/:provinceCode、/districts/:cityCode、/:code：返回行政区划，最后一个 code 是地区代码。
- GET/POST /resolve：经纬度 lng(-180..180)、lat(-90..90)，GET 取 query，POST 取 JSON body；匹配不到 404，Amap 缺配置/服务失败由 handler 返回服务错误。
- GET /search/address：query q 必填 1–100 字符，city 可选最多 50；依赖 Amap 地址搜索。
- POST /api/exif/extract-gps、/extract-gps-with-region：认证且未封禁；JSON imageUrls 非空数组。第二个还要求 Amap 配置，未配置 503。响应 success/data，包括 hasGps、gpsResults、mostFrequentGps、regionSuggestion。
- GET /api/exif/extract-single：认证且未封禁；query url 必填；返回 success/data.url/gps。

### 图片映射与 S3

- GET /api/image-maps、GET /:id：公开读取映射；列表可按 md5、page、limit 筛选；导出/统计/导入/修改/删除及批量刷新仅管理员。
- POST /import：管理员 body items 非空数组、mode=create|update|upsert；逐项校验 32 位 md5、localUrl、存储类型/URL 一致性；返回 success/failed/errors，属于部分成功接口。
- POST /api/image-maps：管理员创建映射；PATCH /:id 仅更新字段，切换物理存储地址前必须没有引用、active media claim 或变体任务，否则 409；DELETE 是软删除，仍有引用同样 409。
- GET /export?format=json|csv；csv 是 text/csv 附件。POST /refresh-all-blurhash 与 POST /:id/refresh-blurhash 可触发后台图片处理；POST /migrate-to-s3 是批量迁移，需 S3 开启，检查 processed/failed/errors。
- GET /api/s3/config 与 GET /api/config/s3/config 返回公开 S3 配置(enabled/endpoint/bucket/prefix/publicDomain/maxFileSize/allowedContentTypes/md5Required/s3BaseUrl)，不返回密钥。
- GET /api/s3/presign-upload 与 GET /api/config/s3/presign-upload：需认证未封禁，query filename 必填，contentType/contentMd5/fileSize 可选；输出 uploadUrl/url/key/expiresIn/md5Required。实际上传必须对返回的预签名 URL 发 PUT，并按签名要求提供 Content-Type/MD5。
- GET /api/s3/presign-download/*key：认证，可访问需授权对象并得到 downloadUrl。GET /api/s3/presign-delete/*key：管理员，得到 deleteUrl；拿到签名并未自动删除，危险操作由调用方执行。

### 逐接口契约（35 项）

<a id="api-get-api-s3-config"></a>

### GET /api/s3/config

- 用途：读取 s3 / config；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from config</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取 S3 配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/s3/config"
```

<a id="api-get-api-s3-presign-upload"></a>

### GET /api/s3/presign-upload

- 用途：读取 s3 / presign upload；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query filename required string; contentType?:MIME; contentMd5?:32-hex; fileSize?:positive integer；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>、<code>error</code>；HTTP 400: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400: 缺少 filename 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/s3/presign-upload?filename=test.png&contentType=image%2Fpng&fileSize=1024"
```

<a id="api-get-api-s3-presign-download-wildcard-key"></a>

### GET /api/s3/presign-download/\*key

- 用途：读取 s3 / presign download；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：已认证。
- 参数契约：path key: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>downloadUrl</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 缺少 key 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/s3/presign-download/example/key"
```

<a id="api-get-api-s3-presign-delete-wildcard-key"></a>

### GET /api/s3/presign-delete/\*key

- 用途：读取 s3 / presign delete；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path key: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleteUrl</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 缺少 key 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/s3/presign-delete/example/key"
```

<a id="api-get-api-search"></a>

### GET /api/search

- 用途：读取 search；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path 无 path 字段；query q?:string; type=all|wiki|posts|galleries|music|albums|lyrics default all; mode=keyword|vector|hybrid default keyword; category/tags/startDate/endDate/detail; per-domain page parameters default1；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>response from makeHybridPagedResponse(hybridResponse, {
  wiki: wikiPage,
  posts: postsPage,
  galleries: galleriesPage,
  music: musicPage,
  albums: albumsPage,
  lyrics: lyricsPage,
  })</code>、<code>wiki</code>、<code>posts</code>、<code>galleries</code>、<code>music</code>、<code>albums</code>、<code>lyrics</code>、<code>searchMeta</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toGalleryListResponse、toMusicResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404, 500。HTTP 500: 搜索失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/search?q=%E7%A4%BA%E4%BE%8B&type=all&mode=keyword&page=1"
```

<a id="api-get-api-search-text-semantic"></a>

### GET /api/search/text-semantic

- 用途：读取 search / text semantic；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path 无 path 字段；query q required nonempty; detail?:boolean query string; requires semantic-search feature enabled；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>results</code>、<code>total</code>、<code>query</code>、<code>minScore</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 400: 请提供搜索文字 (q 参数)；HTTP 500: 文本语义搜索失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/search/text-semantic?q=%E7%A4%BA%E4%BE%8B&detail=true"
```

<a id="api-get-api-search-hot-keywords"></a>

### GET /api/search/hot-keywords

- 用途：读取 search / hot keywords；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>keywords</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取热门关键词失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/search/hot-keywords"
```

<a id="api-post-api-search-by-image"></a>

### POST /api/search/by-image

- 用途：创建/提交/触发 search / by image；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart multipart image 或 JSON imageBase64 二选一；body page/minScore 可选；解析 schema image search request。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>mode</code>、<code>sessionId</code>、<code>categoryPages</code>、<code>totalMatches</code>、<code>results</code>；HTTP 400: <code>error</code>；HTTP 413: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 413, 500。HTTP 400: 请上传图片文件，或提供 imageBase64；HTTP 413: 图片像素超过搜索上限，请压缩后重试；HTTP 500: 图片语义搜索失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -F 'image=@./test-fixture.png' "$BASE_URL/api/search/by-image"
```

<a id="api-get-api-search-by-image-sessionid"></a>

### GET /api/search/by-image/:sessionId

- 用途：读取 search / by image；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path sessionId: required string path parameter；query source=semantic|wiki|post|gallery; page integer default1; same anonymous/user identity required；body/multipart 此处理器不读取 JSON body；解析 schema image search polling。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>mode</code>、<code>sessionId</code>、<code>totalMatches</code>、<code>results</code>；HTTP 400: <code>error</code>；HTTP 410: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 410。HTTP 400: 无效的图片搜索来源；HTTP 410: 图片搜索会话已过期，请重新上传图片。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/search/by-image/REPLACE_SESSIONID?source=semantic&page=1"
```

<a id="api-get-api-search-semantic-search"></a>

### GET /api/search/semantic-search

- 用途：读取 search / semantic search；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path 无 path 字段；query q required nonempty; detail?:boolean; minScore?:number; requires semantic-search feature enabled；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>mode</code>、<code>query</code>、<code>totalMatches</code>、<code>results</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 400: 请提供搜索文字 (q 参数)；HTTP 500: 语义搜索失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/search/semantic-search?q=%E7%A4%BA%E4%BE%8B&detail=true"
```

<a id="api-get-api-search-suggest"></a>

### GET /api/search/suggest

- 用途：读取 search / suggest；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。限流器 searchLimiter。
- 参数契约：path 无 path 字段；query q required min2 chars; limit handler-clamped; returns candidates；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>suggestions</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 搜索建议失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/search/suggest?q=%E7%A4%BA%E4%BE%8B"
```

<a id="api-get-api-image-maps"></a>

### GET /api/image-maps

- 用途：读取 image maps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query md5?:32-hex; page integer default1; limit integer default20; response fields include normalized mapping；body/multipart 此处理器不读取 JSON body；解析 schema query parameters。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>items</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/image-maps?page=1&limit=20"
```

<a id="api-get-api-image-maps-export"></a>

### GET /api/image-maps/export

- 用途：读取 image maps / export；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query format=json|csv; default json；body/multipart 此处理器不读取 JSON body；解析 schema image-map export。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：JSON by format branch or file stream; download Content-Type/CSV are described in the domain section。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 导出图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/export?format=json"
```

<a id="api-get-api-image-maps-stats"></a>

### GET /api/image-maps/stats

- 用途：读取 image maps / stats；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>total</code>、<code>stats</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取图片统计失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/stats"
```

<a id="api-post-api-image-maps-import"></a>

### POST /api/image-maps/import

- 用途：创建/提交/触发 image maps / import；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart externalUrl: optional string；id: optional string；items: optional Array<{；localUrl: optional string；md5: required string；mode: optional 'update' | 'create' | 'upsert'；s3Url: optional string；storageType: optional 'local' | 'external' | 's3'。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>failed</code>、<code>errors</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 缺少导入数据或模式 / 导入模式无效；HTTP 500: 导入图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"externalUrl":"REPLACE_EXTERNALURL","id":"REPLACE_ID","items":"REPLACE_ITEMS","localUrl":"REPLACE_LOCALURL","md5":"REPLACE_MD5","mode":"dry-run","s3Url":"REPLACE_S3URL","storageType":"REPLACE_STORAGETYPE"}' "$BASE_URL/api/image-maps/import"
```

<a id="api-post-api-image-maps-refresh-all-blurhash"></a>

### POST /api/image-maps/refresh-all-blurhash

- 用途：创建/提交/触发 image maps / refresh all blurhash；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query limit: optional string；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>processed</code>、<code>failed</code>、<code>total</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 刷新 blurhash 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/refresh-all-blurhash"
```

<a id="api-get-api-image-maps-id"></a>

### GET /api/image-maps/:id

- 用途：读取 image maps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>item</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 图片映射不存在；HTTP 500: 获取图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/image-maps/REPLACE_ID"
```

<a id="api-post-api-image-maps"></a>

### POST /api/image-maps

- 用途：创建/提交/触发 image maps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart externalUrl: optional string；id: required string；localUrl: optional string；md5: required string；s3Url: optional string；storageType: optional 'local' | 'external' | 's3'。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>item</code>；HTTP 400: <code>error</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 409, 500。HTTP 400: id、32 位 md5 和非空 localUrl 为必填字段；HTTP 409: 图片映射已存在，请使用管理员导入或更新接口；HTTP 500: 保存图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"externalUrl":"REPLACE_EXTERNALURL","id":"REPLACE_ID","localUrl":"REPLACE_LOCALURL","md5":"REPLACE_MD5","s3Url":"REPLACE_S3URL","storageType":"REPLACE_STORAGETYPE"}' "$BASE_URL/api/image-maps"
```

<a id="api-patch-api-image-maps-id"></a>

### PATCH /api/image-maps/:id

- 用途：部分更新 image maps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart blurhash: optional string | null；externalUrl: optional string | null；localUrl: optional string | null；s3Url: optional string | null；storageType: optional 'local' | 'external' | 's3'；thumbhash: optional string | null。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>item</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: localUrl 不能为空；HTTP 500: 更新图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"blurhash":"REPLACE_BLURHASH","externalUrl":"REPLACE_EXTERNALURL","localUrl":"REPLACE_LOCALURL","s3Url":"REPLACE_S3URL","storageType":"REPLACE_STORAGETYPE","thumbhash":"REPLACE_THUMBHASH"}' "$BASE_URL/api/image-maps/REPLACE_ID"
```

<a id="api-delete-api-image-maps-id"></a>

### DELETE /api/image-maps/:id

- 用途：删除/移除 image maps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 删除图片映射失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/REPLACE_ID"
```

<a id="api-post-api-image-maps-id-refresh-blurhash"></a>

### POST /api/image-maps/:id/refresh-blurhash

- 用途：创建/提交/触发 image maps / refresh blurhash；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>item</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 没有可用的本地图片路径；HTTP 404: 图片映射不存在；HTTP 500: 生成 blurhash 失败 / 刷新 blurhash 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/REPLACE_ID/refresh-blurhash"
```

<a id="api-post-api-image-maps-migrate-to-s3"></a>

### POST /api/image-maps/migrate-to-s3

- 用途：创建/提交/触发 image maps / migrate to s3；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query limit: optional string；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>total</code>、<code>processed</code>、<code>failed</code>、<code>errors</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: S3 存储未启用，请先配置 S3；HTTP 500: 迁移到 S3 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/image-maps/migrate-to-s3"
```

<a id="api-get-api-regions"></a>

### GET /api/regions

- 用途：读取 regions；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query q?:string; level?:integer1–4; parentCode?:region code; limit integer1–100 default20; q search precedes hierarchy list；body/multipart 此处理器不读取 JSON body；解析 schema region search/list。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>regions</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取地区失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions?limit=20"
```

<a id="api-get-api-regions-search"></a>

### GET /api/regions/search

- 用途：读取 regions / search；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query q?:string; limit integer1–100 default20；body/multipart 此处理器不读取 JSON body；解析 schema region search。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>regions</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 搜索地区失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/search?q=%E5%8C%97%E4%BA%AC&limit=20"
```

<a id="api-get-api-regions-suggest"></a>

### GET /api/regions/suggest

- 用途：读取 regions / suggest；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query q?:string; limit integer1–100 default5；body/multipart 此处理器不读取 JSON body；解析 schema region suggest。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>regions</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 500。HTTP 500: 获取地区建议失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/suggest?q=%E5%8C%97%E4%BA%AC&limit=5"
```

<a id="api-get-api-regions-provinces"></a>

### GET /api/regions/provinces

- 用途：读取 regions / provinces；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>provinces</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取省份失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/provinces"
```

<a id="api-get-api-regions-cities-provincecode"></a>

### GET /api/regions/cities/:provinceCode

- 用途：读取 regions / cities；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path provinceCode: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>cities</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取城市失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/cities/REPLACE_PROVINCECODE"
```

<a id="api-get-api-regions-districts-citycode"></a>

### GET /api/regions/districts/:cityCode

- 用途：读取 regions / districts；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path cityCode: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>districts</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取区县失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/districts/REPLACE_CITYCODE"
```

<a id="api-get-api-regions-resolve"></a>

### GET /api/regions/resolve

- 用途：读取 regions / resolve；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>result</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404。HTTP 400: 无效的坐标参数；HTTP 404: 无法解析该坐标对应的行政区划。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/resolve"
```

<a id="api-post-api-regions-resolve"></a>

### POST /api/regions/resolve

- 用途：创建/提交/触发 regions / resolve；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart lat: required number；lng: required number；validateBody schema coordinateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>result</code>；HTTP 404: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 404。HTTP 404: 无法解析该坐标对应的行政区划。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"lat":"REPLACE_LAT","lng":"REPLACE_LNG"}' "$BASE_URL/api/regions/resolve"
```

<a id="api-get-api-regions-search-address"></a>

### GET /api/regions/search/address

- 用途：读取 regions / search / address；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>results</code>；HTTP 400: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400。HTTP 400: 无效的地址搜索参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/search/address"
```

<a id="api-get-api-regions-code"></a>

### GET /api/regions/:code

- 用途：读取 regions；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：公开/可选身份。
- 参数契约：path code: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>region</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 404, 500。HTTP 404: 地区不存在；HTTP 500: 获取地区详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/regions/REPLACE_CODE"
```

<a id="api-post-api-exif-extract-gps"></a>

### POST /api/exif/extract-gps

- 用途：创建/提交/触发 exif / extract gps；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart imageUrls: required string[]。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供图片 URL 列表；HTTP 500: 提取 GPS 信息失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageUrls":["https://example.invalid/image.jpg"]}' "$BASE_URL/api/exif/extract-gps"
```

<a id="api-post-api-exif-extract-gps-with-region"></a>

### POST /api/exif/extract-gps-with-region

- 用途：创建/提交/触发 exif / extract gps with region；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart imageUrls: required string[]。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；HTTP 503: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500, 503。HTTP 400: 请提供图片 URL 列表；HTTP 500: 提取 GPS 信息并解析行政区划失败；HTTP 503: 地图服务未配置，无法解析行政区划。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"imageUrls":["https://example.invalid/image.jpg"]}' "$BASE_URL/api/exif/extract-gps-with-region"
```

<a id="api-get-api-exif-extract-single"></a>

### GET /api/exif/extract-single

- 用途：读取 exif / extract single；目标资源与完整业务约束见第 13 章「搜索、地区与 EXIF」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query url required nonempty image URL; server fetches file, so use only trusted URLs；body/multipart 此处理器不读取 JSON body；解析 schema EXIF single URL。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供图片 URL；HTTP 500: 提取单张图片 GPS 信息失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/exif/extract-single?url=https%3A%2F%2Fexample.invalid%2Fimage.jpg"
```

## 14. 管理后台与系统配置

### 管理后台总览

GET /api/admin/dashboard：管理员，响应 {success,data,timestamp}。data.stats 为 wiki/posts/galleries/users/music 计数；reviewQueue 为 status=pending、counts{wiki,posts,galleries,tickets}、total；system.disk/variants/cloudSync 各为 {data:...} 或 {error}；trends 为最近日期数组与 posts/galleries/wiki/users 数组和 totals。disk 子对象含 totalSpaceGB/freeSpaceGB/usedSpaceGB/usagePercent/status/lastChecked；变体/云同步子对象含 queueLength/processingCount/completedToday/failedToday/averageProcessingTime，另有 timeoutCount/available。

### 审核、内容回收站与锁

- GET /api/admin/review-queue/count：管理员；query type=wiki|posts|galleries|tickets|all 可选、status 默认 pending；返回 status、counts、total。
- GET /api/admin/review-queue：管理员；query type=all 或 wiki/posts/galleries/tickets，status 默认 pending、page/limit；混合 all 响应 items 带 reviewType/reviewId。PUT /review-queue/:id/approve|reject：管理员，body type 指明 wiki/post/gallery/ticketListing（缺省 wiki）；reject 必须 note。POST /review/:type/:id/:action 是旧兼容路由，action 只接受 approve/reject。审核对象不存在/状态冲突按 handler 返回 404/409。
- GET /api/admin/sensitive-words?word=...：管理员，只检查敏感词；POST /sensitive-words、DELETE /sensitive-words/:id 虽有路由，但当前返回 501，须人工编辑 public/sensitive-words/words.txt，每行一个词。
- GET /locks：管理员，先清理过期锁，再 page/limit 返回 locks。
- POST /locks：任意已认证未封禁用户；body collection、recordId 必填；服务端固定 15 分钟锁，重复本人锁会续期，其他人的未过期锁 409。当前 handler 中 force 固定 false，不能用 body 强制接管。
- DELETE /locks/:id：锁拥有者或管理员释放；不存在也返回成功。DELETE /locks：管理员 body lockIds（1–200 个唯一 ID）批量释放，返回 deleted。
- GET /moderation_logs 与 /ban_logs：管理员 page/limit 分页；分别返回操作/封禁日志与操作者/目标摘要。

### 通用管理员数据路由

GET /api/admin/:tab 支持以下精确 tab：wiki、posts、galleries、ticket-listings、events、users、music、albums、announcements、sections、wiki-categories。query includeDeleted=true 可包含软删除记录；page/limit 有效。music/albums 另读 sortBy、sortOrder 和后台过滤参数。结果包装为 {data,...pagination}。

GET /api/admin/:tab/:id 只支持 wiki、posts、galleries、ticket-listings、events、users、locks。对应记录 ID 是内部 ID；歌曲/专辑分支使用业务 docId 的路径约定在其他专属端点，通用详情不支持任意 tab。

DELETE /api/admin/:tab/:id 支持 wiki、posts、galleries、ticket-listings、events、music、albums、announcements、sections、wiki-categories、image-maps、users、locks。内容删除为软删除；Wiki/帖子/图库/票务删除他人记录要求 reason；users 不可删自己，管理员只可软删普通用户，且撤销其 API keys。POST /:tab/:id/restore 支持相应内容、用户、图片映射等软删除实体；账户恢复不会恢复已撤销密钥。

DELETE /api/admin/:tab/:id/permanent 是不可逆硬删除，仅管理员；包括用户时不可删自己并受目标角色管理限制，永久删除专辑需先软删除。删除 Wiki/帖子/图库、图像映射等会清理引用与关联数据；失败前后状态以 handler/依赖结果为准，不要在生产环境试探。

### 批量操作与 Wiki 链接

- PATCH /api/admin/music/batch-display：管理员；body songDocIds 与 displayAlbumMode，模式需匹配支持的展示类型；manual 模式要 manualAlbumName，linked 模式可给 displayAlbumDocId 且专辑须关联所有选中歌曲；成功 {success,updated}。
- POST /batch-delete-posts、/batch-delete-galleries：管理员；body postIds/galleryIds 非空数组；涉及他人资源需要 reason；事务里逐项软删除并写日志，返回 deleted。
- POST /batch-delete-comments：管理员；body commentIds 非空数组；删除他人评论需要 reason；返回 deleted；不假设它与单条评论删除的计数/副作用完全一致。
- GET /wiki-links/scan、GET /wiki-links/:slug：管理员读取扫描/页面链接结果。
- PUT /wiki-links/:id：body mappings 非空数组，元素 {oldUrl,newUrl,useRegex?}，可选 slugs；仅预览匹配结果。
- POST /wiki-links/update：相同 mappings，dryRun 可选；dryRun=true 预览，不写；false 批量更新并清 Wiki 缓存。
- POST /wiki-links/switch-storage：body fromStorage/toStorage(local|s3|external)、config、dryRun；from/to 不能相同；批量切换存储 URL 前先 dryRun。
- POST /wiki-links/sync-with-imagemap：从 ImageMap 生成映射，dryRun 可选；执行会批量改 Wiki 链接。
- POST /wiki-categories：管理员 body id/name 必填，description/order/requiresAdminEdit 可选；201 {category}。PATCH /wiki-categories/:id 要 name；删除/恢复/永久删除由通用 tab 操作完成，分类有页面引用时不能硬删。

### 备份与恢复（破坏性）

创建备份、删除备份和数据库恢复仅超级管理员可用。恢复会替换目标数据库 public schema，执行前先生成 pre-restore 备份；仍须只在正确隔离/维护环境使用。文档示例不自动执行这些操作。

- POST /api/admin/backup/create：body note 可选；同一时间只允许一个备份。服务器调用 pg_dump、生成 ZIP 与元数据；如配置 BACKUP_PASSWORD 会加密 SQL。成功返回 backup 文件名/大小/时间/note 与清理掉的旧备份文件名；无 pg_dump 返回 500。
- GET /backup/list：返回备份列表。
- POST /backup/:filename/note：body note，限制安全文件名；更新备注。
- POST /backup/:filename/download：没有 JSON 包装；响应 application/zip 附件。
- POST /backup/restore：multipart file + JSON 字段 confirm:true、可选解密密码；缺 confirm/file 400。加密 ZIP 还需站点 BACKUP_PASSWORD 或提交解密密码。成功 {success,message,mediaReport,mediaReportError}。
- POST /backup/:filename/restore：恢复站内备份，body confirm:true、解密密码可选；不删除原备份；成功结构同上传恢复。
- POST /backup/media-reports/:filename/download：超级管理员下载 application/json 图片恢复清单附件。
- POST /backup/:filename/delete：超级管理员删除指定站内备份；确认文件名与环境后执行。

### 运行时配置、凭证与限流

- GET/PATCH/POST /api/admin/rate-limits/config、/reset：超级管理员。配置为 auth、emailVerification、passwordResetRequest、passwordResetConfirm、global、search、upload、wikiWrite、postWrite、galleryWrite、profile 各桶；每桶 enabled、windowMs、max、message。windowMs 1000–86400000 ms、max 1–100000、message 1–120 字符；PATCH 顶层只接受这些桶且嵌套字段部分更新；reset 恢复默认。
- GET/PATCH/POST /runtime-config、/reset：超级管理员。GET 返回完整 config；PATCH 只处理已知字段，未提交不变，未知键忽略。bool 必须为 JSON boolean；数字超范围会 clamp，不是拒绝；字符串 trim，logLevel=debug|info|warn|error，s3SignatureVersion 当前只接受 v4。字段包括 semanticSearchEnabled、galleryAdminOnly、allowSuperAdminManageSuperAdmins、blurhashEnabled/AutoGenerate/组件数、上传会话 TTL、备份保留数、播放缓存/搜索、Qdrant、图片批量/变体队列、云同步、日志、S3 公共/私有桶、向量集合、Lsky 参数。reset 使用运行时默认值。
  数字约束：blurhashComponentsX/Y 1–16；uploadSessionTtlMinutes 5–1440；backupRetainCount 1–365；playUrlCacheTtlSeconds 60–86400；cacheMaxKeys 100–1000000；qdrantTimeoutMs 100–30000；imageEmbeddingBatchSize 1–2000；editLockCleanupIntervalMs/mediaCleanupIntervalMs 10000–3600000；variantMaxConcurrent 1–32，variantTaskTimeoutMs 1000–600000，variantQueueMaxWaitMs 1000–86400000，variantSharpMemoryLimitMb 64–8192，variantMaxRetries/cloudSyncMaxRetries 0–20，cloudSyncMaxConcurrent 1–16；s3ExpiresIn 60–86400 秒，s3MaxFileSize 1–1073741824 bytes；lskyTimeout 1000–300000 ms。越界数字会 clamp 到范围。
- GET /secrets-config：超级管理员；返回 disabled 与每个凭证 {configured,last4}，绝不返回明文。PATCH /secrets-config：需要 SECRETS_ENCRYPTION_KEY 有效（base64 32 字节）；body 对象按字段更新，省略不变，null/空字符串清除。字段有 superbedApiToken、amapApiKey、qdrantApiKey、lskyToken、S3 读写 access key/secret、微信小程序 app id/secret。仅 last4 掩码回显。
- GET /disk/status、GET /disk/config、PUT /disk/config、POST /disk/config/reset、/check、/monitor/stop、/monitor/resume：管理员。PUT 可选 warningThresholdGB/criticalThresholdGB 正数，critical 必须小于 warning；checkIntervalMs 至少 60000，uploadsMinFreeMB 至少 10。stop/resume 会更改进程监控状态。
- GET /variants/stats 与 /cloud-sync/stats：管理员读取任务队列与类型统计。
- POST /api/admin/rebuild-all-variants：管理员 body type=imageMap|songCover|albumCover|all（默认 imageMap）、scope=all|failed|missing|outdated（默认 missing）、batchSize 1–1000（默认50）、dryRun/force 布尔值。返回 queued/completed 与 summary；GET /rebuild-status/:jobId 实际返回全局队列状态统计，不是按 jobId 的持久任务明细。GET /cleanup/stats 返回变体清理统计。

### 媒体健康与维护

- GET /api/admin/media-health/scan：管理员，query mode/limit；返回 {success,data} 扫描结果。POST /cleanup：管理员 body targets[{recordType,id}] 与 mode；targets 只保留合法前 100 项；每项结果可能 cleaned/skipped/failed，汇总不代表全部成功。
- /api/admin/media-maintenance/scan：管理员 query mode=strict|business、limit 1–100（默认100）、type=all|gallery|song|album；scan 只接受 type=all。
- POST /reconcile、/bind-legacy、/localize、/repair-thumbnails：管理员，body mode=dry-run|apply（默认 dry-run）、cursor、batchSize 1–100（默认100）、type=all|gallery|song|album（默认all）。type 仅 localize 有效；响应 {success,data}，含 scanned/processed/skipped/failed/nextCursor/hasMore 等，按游标继续执行。相同操作/游标会并发合并，但不是跨进程幂等保证。
- POST /orphans/preview：管理员 body cursor/batchSize/olderThanHours(默认1，0–8760)/includeVariants；只预览并返回 previewToken。
- POST /orphans/delete：仅超级管理员；body previewToken 与 storageKeys（1–100，键最多512）；这是物理 orphan 删除，必须使用对应预览 token。参数错误批次可能 413，响应会记录审计信息。

### 公共配置、邮箱与对象存储

- GET /api/config/gallery-access：公开返回图库管理员限制开关。
- GET /features：公开返回 semanticSearch、registrationEnabled、searchHotKeywordsEnabled。
- GET /admin-permissions、GET /registration/admin、GET /search-hot-keywords/admin、GET /email-verification/admin：超级管理员配置读取。
- PATCH /registration、PATCH /search-hot-keywords：超级管理员 body {enabled:boolean}，返回 success/config。
- GET /email-verification：公开安全配置，不返回 SMTP 密码。PATCH 此路径仅超级管理员；enabled/smtpSecure 必须布尔值，tokenTtlMinutes 5–10080，smtpPort 1–65535；启用前要求 publicBaseUrl、smtpHost、smtpFrom。smtpPass 不传保持现值，clearSmtpPass:true 清除。响应不回显明文凭证。
- GET /image-preference：公开当前图片策略；PATCH 管理员 body strategy=local|s3|external、fallback 与 autoSync（默认 true）。切换外部策略可启动同步任务；任务启动失败不回滚已保存的配置。
- GET/POST/DELETE /image-sync：管理员读取/启动/取消任务。POST body strategy=s3|external；GET 可选 taskId，不传返回最新任务；状态含 processed/succeeded/failed/errors/progress；只能取消仍运行任务。
- /api/config/s3/config：管理员；返回公开 S3 配置(enabled/endpoint/bucket/prefix/publicDomain/maxFileSize/allowedContentTypes/md5Required/s3BaseUrl)，不含访问密钥。
- /api/config/s3/presign-upload|presign-download/*key|presign-delete/*key 与 /api/s3 同业务实现，详见对应逐接口条目。

### 逐接口契约（88 项）

<a id="api-get-api-admin-media-maintenance-scan"></a>

### GET /api/admin/media-maintenance/scan

- 用途：读取 admin / media maintenance / scan；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query mode:strict|business(default strict); limit:integer1–100(default100); type=all only；body/multipart 此处理器不读取 JSON body；validateBody schema mediaMaintenanceScanQuerySchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/media-maintenance/scan?mode=strict&limit=100&type=all"
```

<a id="api-post-api-admin-media-maintenance-reconcile"></a>

### POST /api/admin/media-maintenance/reconcile

- 用途：创建/提交/触发 admin / media maintenance / reconcile；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart mode=dry-run|apply(default dry-run); cursor?:string1–1024; batchSize:integer1–100(default100); type=all|gallery|song|album(default all), only localize accepts non-all type；解析 schema mediaMaintenanceBatchSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"mode":"dry-run","batchSize":100,"type":"all"}' "$BASE_URL/api/admin/media-maintenance/reconcile"
```

<a id="api-post-api-admin-media-maintenance-bind-legacy"></a>

### POST /api/admin/media-maintenance/bind-legacy

- 用途：创建/提交/触发 admin / media maintenance / bind legacy；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart mode=dry-run|apply(default dry-run); cursor?:string1–1024; batchSize:integer1–100(default100); type=all|gallery|song|album(default all), only localize accepts non-all type；解析 schema mediaMaintenanceBatchSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"mode":"dry-run","batchSize":100,"type":"all"}' "$BASE_URL/api/admin/media-maintenance/bind-legacy"
```

<a id="api-post-api-admin-media-maintenance-localize"></a>

### POST /api/admin/media-maintenance/localize

- 用途：创建/提交/触发 admin / media maintenance / localize；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart mode=dry-run|apply(default dry-run); cursor?:string1–1024; batchSize:integer1–100(default100); type=all|gallery|song|album(default all), only localize accepts non-all type；解析 schema mediaMaintenanceBatchSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"mode":"dry-run","batchSize":100,"type":"all"}' "$BASE_URL/api/admin/media-maintenance/localize"
```

<a id="api-post-api-admin-media-maintenance-repair-thumbnails"></a>

### POST /api/admin/media-maintenance/repair-thumbnails

- 用途：创建/提交/触发 admin / media maintenance / repair thumbnails；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart mode=dry-run|apply(default dry-run); cursor?:string1–1024; batchSize:integer1–100(default100); type=all|gallery|song|album(default all), only localize accepts non-all type；解析 schema mediaMaintenanceBatchSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"mode":"dry-run","batchSize":100,"type":"all"}' "$BASE_URL/api/admin/media-maintenance/repair-thumbnails"
```

<a id="api-post-api-admin-media-maintenance-orphans-preview"></a>

### POST /api/admin/media-maintenance/orphans/preview

- 用途：创建/提交/触发 admin / media maintenance / orphans；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart cursor?:string1–1024; batchSize:integer1–100(default100); olderThanHours:number0–8760(default1); includeVariants:boolean(default false)；validateBody schema mediaMaintenanceOrphanPreviewSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"batchSize":100,"olderThanHours":1,"includeVariants":false}' "$BASE_URL/api/admin/media-maintenance/orphans/preview"
```

<a id="api-post-api-admin-media-maintenance-orphans-delete"></a>

### POST /api/admin/media-maintenance/orphans/delete

- 用途：创建/提交/触发 admin / media maintenance / orphans；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart previewToken:nonempty max32768; storageKeys:array1–100, each string1–512; strict；validateBody schema mediaMaintenanceOrphanDeleteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200 {success:true,data:<maintenance result>}；本章列出 operation-specific counters/cursors。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 413。ZodError 400；batchSize/limit 超上限 413；MediaMaintenanceRequestError 返回其 statusCode。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"previewToken":"REPLACE_WITH_PREVIEW_TOKEN","storageKeys":["REPLACE_WITH_PREVIEW_STORAGE_KEY"]}' "$BASE_URL/api/admin/media-maintenance/orphans/delete"
```

<a id="api-get-api-admin-review-queue-count"></a>

### GET /api/admin/review-queue/count

- 用途：读取 admin / review queue / count；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query type=all|wiki|post/posts|gallery/galleries|ticket/tickets/ticketListing; status=draft|pending|published|rejected default pending；body/multipart 此处理器不读取 JSON body；解析 schema moderation count query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>status</code>、<code>counts</code>、<code>total</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: type 必须为 wiki、posts、galleries 或 tickets；HTTP 500: 获取审核队列数量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/review-queue/count?type=all&status=pending"
```

<a id="api-get-api-admin-review-queue"></a>

### GET /api/admin/review-queue

- 用途：读取 admin / review queue；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query type=all or one target alias; status=draft|pending|published|rejected default pending; page/limit pagination for all；body/multipart 此处理器不读取 JSON body；解析 schema moderation list query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>type</code>、<code>status</code>、<code>items</code>、<code>nested DTO fields</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse、toGalleryListResponse、toPostResponse、toTicketListingListResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: type 必须为 wiki、posts、galleries 或 tickets；HTTP 500: 获取审核队列失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/review-queue?type=all&status=pending&page=1&limit=20"
```

<a id="api-put-api-admin-review-queue-id-approve"></a>

### PUT /api/admin/review-queue/:id/approve

- 用途：更新/执行 admin / review queue / approve；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart type?:wiki|post/posts|gallery/galleries|ticket/tickets/ticketListing; defaults wiki；解析 schema review action body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 无效审核类型；HTTP 500: 审核通过失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"wiki"}' "$BASE_URL/api/admin/review-queue/REPLACE_ID/approve"
```

<a id="api-put-api-admin-review-queue-id-reject"></a>

### PUT /api/admin/review-queue/:id/reject

- 用途：更新/执行 admin / review queue / reject；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart type optional (default wiki); note required trimmed nonempty string；解析 schema review rejection body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 无效审核类型 / 驳回原因不能为空；HTTP 500: 驳回失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"wiki","note":"隔离测试说明"}' "$BASE_URL/api/admin/review-queue/REPLACE_ID/reject"
```

<a id="api-post-api-admin-review-type-id-action"></a>

### POST /api/admin/review/:type/:id/:action

- 用途：创建/提交/触发 admin / review；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path action: required string path parameter；id: required string path parameter；type: required string path parameter；query 无 query 字段；body/multipart type/action from path; action approve|reject; reject requires note；解析 schema legacy review action body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>、<code>error</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 无效的操作 / 驳回原因不能为空 / 无效的类型；HTTP 500: 审核操作失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试说明"}' "$BASE_URL/api/admin/review/REPLACE_TYPE/REPLACE_ID/REPLACE_ACTION"
```

<a id="api-get-api-admin-sensitive-words"></a>

### GET /api/admin/sensitive-words

- 用途：读取 admin / sensitive words；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query word: optional string；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>word</code>、<code>isSensitive</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供要检查的词语；HTTP 500: 检查敏感词失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/sensitive-words?word=REPLACE_VALUE"
```

<a id="api-post-api-admin-sensitive-words"></a>

### POST /api/admin/sensitive-words

- 用途：创建/提交/触发 admin / sensitive words；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart word: required string。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；HTTP 501: <code>error</code>、<code>hint</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：400, 401, 403, 500, 501。HTTP 400: 请提供要添加的敏感词；HTTP 500: 添加敏感词失败；HTTP 501: 敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"word":"REPLACE_WORD"}' "$BASE_URL/api/admin/sensitive-words"
```

<a id="api-delete-api-admin-sensitive-words-id"></a>

### DELETE /api/admin/sensitive-words/:id

- 用途：删除/移除 admin / sensitive words；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；HTTP 501: <code>error</code>、<code>hint</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：400, 401, 403, 500, 501。HTTP 400: 请提供要删除的敏感词；HTTP 500: 删除敏感词失败；HTTP 501: 敏感词管理需要通过文件系统操作，请手动编辑 public/sensitive-words/words.txt 文件。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/admin/sensitive-words/REPLACE_ID"
```

<a id="api-get-api-admin-locks"></a>

### GET /api/admin/locks

- 用途：读取 admin / locks；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>locks</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取编辑锁列表失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/locks?limit=20&page=1"
```

<a id="api-post-api-admin-locks"></a>

### POST /api/admin/locks

- 用途：创建/提交/触发 admin / locks；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart collection:string and recordId:string required; fixed 15-minute lease；解析 schema manual edit-lock parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>lock</code>、<code>acquired</code>、<code>takeover</code>、<code>renewed</code>；HTTP 201: <code>lock</code>、<code>acquired</code>；HTTP 400: <code>error</code>；HTTP 409: <code>error</code>、<code>lock</code>；HTTP 500: <code>error</code>；DTO transformer toEditLockResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 401, 403, 409, 500。HTTP 400: 缺少有效的锁定目标；HTTP 409: 该记录正在被其他用户编辑；HTTP 500: 申请编辑锁失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"collection":"wiki","recordId":"REPLACE_WITH_RECORD_ID"}' "$BASE_URL/api/admin/locks"
```

<a id="api-delete-api-admin-locks-id"></a>

### DELETE /api/admin/locks/:id

- 用途：删除/移除 admin / locks；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：已认证且未封禁。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 403: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 403: 无权限释放该编辑锁；HTTP 500: 释放编辑锁失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/admin/locks/REPLACE_ID"
```

<a id="api-delete-api-admin-locks"></a>

### DELETE /api/admin/locks

- 用途：删除/移除 admin / locks；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart lockIds:1–200 unique nonempty strings；validateBody schema adminBatchEditLocksSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>deleted</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 批量释放编辑锁失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"lockIds":["REPLACE_WITH_LOCK_ID"]}' "$BASE_URL/api/admin/locks"
```

<a id="api-get-api-admin-moderation-logs"></a>

### GET /api/admin/moderation_logs

- 用途：读取 admin / moderation logs；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>logs</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取操作日志失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/moderation_logs?limit=20&page=1"
```

<a id="api-get-api-admin-ban-logs"></a>

### GET /api/admin/ban_logs

- 用途：读取 admin / ban logs；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query limit: integer default 20 clamp 1–100 unless handler overrides；page: integer default 1 minimum 1；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>logs</code>、<code>nested DTO fields</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取封禁日志失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/ban_logs?limit=20&page=1"
```

<a id="api-patch-api-admin-music-batch-display"></a>

### PATCH /api/admin/music/batch-display

- 用途：部分更新 admin / music / batch display；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart songDocIds:1–200 unique string IDs; displayAlbumMode=linked|manual|none required; manualAlbumName?:string|null max200 (required for manual); displayAlbumDocId?:string|null；validateBody schema adminBatchMusicDisplaySchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>updated</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 展示模式无效 / 歌曲列表包含无效歌曲 / 手动专辑名不能为空 / 展示专辑必须已关联所有选中歌曲；HTTP 500: 批量更新歌曲展示信息失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"songDocIds":["REPLACE_WITH_SONG_DOC_ID"],"displayAlbumMode":"none"}' "$BASE_URL/api/admin/music/batch-display"
```

<a id="api-post-api-admin-batch-delete-posts"></a>

### POST /api/admin/batch-delete-posts

- 用途：创建/提交/触发 admin / batch delete posts；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart postIds nonempty array of internal Post IDs; reason conditional on ownership；解析 schema post batch delete。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleted</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请选择要删除的帖子 / 删除理由不能为空；HTTP 500: 批量删除帖子失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"postIds":["REPLACE_WITH_POST_ID"],"reason":"隔离测试原因"}' "$BASE_URL/api/admin/batch-delete-posts"
```

<a id="api-post-api-admin-batch-delete-galleries"></a>

### POST /api/admin/batch-delete-galleries

- 用途：创建/提交/触发 admin / batch delete galleries；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart galleryIds nonempty array of internal Gallery IDs; reason conditional on ownership；解析 schema gallery batch delete。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleted</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请选择要删除的图集 / 删除理由不能为空；HTTP 500: 批量删除图集失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"galleryIds":["REPLACE_WITH_GALLERY_ID"],"reason":"隔离测试原因"}' "$BASE_URL/api/admin/batch-delete-galleries"
```

<a id="api-post-api-admin-batch-delete-comments"></a>

### POST /api/admin/batch-delete-comments

- 用途：创建/提交/触发 admin / batch delete comments；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart commentIds nonempty array of Comment IDs; reason required for other authors；解析 schema comment batch delete。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleted</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请选择要删除的评论 / 删除理由不能为空；HTTP 500: 批量删除评论失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"commentIds":["REPLACE_WITH_COMMENT_ID"],"reason":"隔离测试原因"}' "$BASE_URL/api/admin/batch-delete-comments"
```

<a id="api-get-api-admin-wiki-links-scan"></a>

### GET /api/admin/wiki-links/scan

- 用途：读取 admin / wiki links / scan；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 扫描 Wiki 链接失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/wiki-links/scan"
```

<a id="api-get-api-admin-wiki-links-slug"></a>

### GET /api/admin/wiki-links/:slug

- 用途：读取 admin / wiki links；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path slug: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取 Wiki 页面链接失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/wiki-links/REPLACE_SLUG"
```

<a id="api-put-api-admin-wiki-links-id"></a>

### PUT /api/admin/wiki-links/:id

- 用途：更新/执行 admin / wiki links；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart mappings: required Array<{ oldUrl: string；newUrl: required string；slugs: optional string[]；useRegex: optional boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供链接映射规则；HTTP 500: 预览链接更新失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"mappings":[{"oldUrl":"https://example.invalid/old","newUrl":"https://example.invalid/new"}],"newUrl":"REPLACE_NEWURL","slugs":["REPLACE_WITH_ID"],"useRegex":"REPLACE_USEREGEX"}' "$BASE_URL/api/admin/wiki-links/REPLACE_ID"
```

<a id="api-post-api-admin-wiki-links-update"></a>

### POST /api/admin/wiki-links/update

- 用途：创建/提交/触发 admin / wiki links / update；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart dryRun: required boolean；mappings: required Array<{ oldUrl: string；newUrl: required string；useRegex: optional boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供链接映射规则；HTTP 500: 批量更新链接失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"dryRun":true,"mappings":[{"oldUrl":"https://example.invalid/old","newUrl":"https://example.invalid/new"}],"newUrl":"REPLACE_NEWURL","useRegex":"REPLACE_USEREGEX"}' "$BASE_URL/api/admin/wiki-links/update"
```

<a id="api-post-api-admin-wiki-links-switch-storage"></a>

### POST /api/admin/wiki-links/switch-storage

- 用途：创建/提交/触发 admin / wiki links / switch storage；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart config: required {；dryRun: optional boolean；externalBaseUrl: optional string；fromStorage: required 'local' | 's3' | 'external'；localBaseUrl: optional string；s3BaseUrl: optional string；toStorage: required 'local' | 's3' | 'external'。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供源存储和目标存储 / 源存储和目标存储不能相同；HTTP 500: 切换存储策略失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"config":"REPLACE_CONFIG","dryRun":true,"externalBaseUrl":"REPLACE_EXTERNALBASEURL","fromStorage":"REPLACE_FROMSTORAGE","localBaseUrl":"REPLACE_LOCALBASEURL","s3BaseUrl":"REPLACE_S3BASEURL","toStorage":"REPLACE_TOSTORAGE"}' "$BASE_URL/api/admin/wiki-links/switch-storage"
```

<a id="api-post-api-admin-wiki-links-sync-with-imagemap"></a>

### POST /api/admin/wiki-links/sync-with-imagemap

- 用途：创建/提交/触发 admin / wiki links / sync with imagemap；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart dryRun: required boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>message</code>、<code>result</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 同步 ImageMap 失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"dryRun":true}' "$BASE_URL/api/admin/wiki-links/sync-with-imagemap"
```

<a id="api-post-api-admin-backup-create"></a>

### POST /api/admin/backup/create

- 用途：创建/提交/触发 admin / backup / create；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart note: optional string；validateBody schema backupCreateSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>backup</code>、<code>removedFilenames</code>；HTTP 409: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 409, 500。HTTP 409: 已有备份正在创建，请稍后再试；HTTP 500: DATABASE_URL 格式无效 / 创建备份失败，请查看服务器日志。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作"}' "$BASE_URL/api/admin/backup/create"
```

<a id="api-get-api-admin-backup-list"></a>

### GET /api/admin/backup/list

- 用途：读取 admin / backup / list；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：由领域 transformer/helper 构造；包装/嵌套模型见第14章，不能假设统一 data。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/backup/list"
```

<a id="api-post-api-admin-backup-filename-note"></a>

### POST /api/admin/backup/:filename/note

- 用途：创建/提交/触发 admin / backup / note；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path filename: required string path parameter；query 无 query 字段；body/multipart note: required string；validateBody schema backupNoteSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>note</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效的文件名；HTTP 404: 备份文件不存在；HTTP 500: 更新备份备注失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"note":"隔离测试操作"}' "$BASE_URL/api/admin/backup/REPLACE_FILENAME/note"
```

<a id="api-post-api-admin-backup-filename-download"></a>

### POST /api/admin/backup/:filename/download

- 用途：创建/提交/触发 admin / backup / download；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path filename: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：JSON by format branch or file stream; download Content-Type/CSV are described in the domain section。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效的文件名；HTTP 404: 备份文件不存在；HTTP 500: 下载备份失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/backup/REPLACE_FILENAME/download"
```

<a id="api-post-api-admin-backup-restore"></a>

### POST /api/admin/backup/restore

- 用途：创建/提交/触发 admin / backup / restore；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart confirm: required boolean；password: optional string；validateBody schema backupRestoreSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>success</code>、<code>message</code>、<code>mediaReport</code>、<code>mediaReportError</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 恢复操作需要二次确认，请传入 confirm: true / 请上传备份文件；HTTP 500: DATABASE_URL 格式无效。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Isolated environment only: replaces the database
curl --fail-with-body -X POST -H "$AUTH_HEADER" -F 'file=@./approved-test-backup.zip' -F 'confirm=true' "$BASE_URL/api/admin/backup/restore"
```

<a id="api-post-api-admin-backup-filename-restore"></a>

### POST /api/admin/backup/:filename/restore

- 用途：创建/提交/触发 admin / backup / restore；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path filename: required string path parameter；query 无 query 字段；body/multipart confirm: required boolean；password: optional string；validateBody schema backupRestoreSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>、<code>success</code>、<code>message</code>、<code>mediaReport</code>、<code>mediaReportError</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 恢复操作需要二次确认，请传入 confirm: true / 无效的文件名；HTTP 404: 备份文件不存在；HTTP 500: DATABASE_URL 格式无效。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"confirm":true,"password":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/admin/backup/REPLACE_FILENAME/restore"
```

<a id="api-post-api-admin-backup-media-reports-filename-download"></a>

### POST /api/admin/backup/media-reports/:filename/download

- 用途：创建/提交/触发 admin / backup / media reports；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path filename: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：JSON by format branch or file stream; download Content-Type/CSV are described in the domain section。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 无效的文件名；HTTP 404: 图片清单不存在；HTTP 500: 下载图片清单失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/backup/media-reports/REPLACE_FILENAME/download"
```

<a id="api-post-api-admin-backup-filename-delete"></a>

### POST /api/admin/backup/:filename/delete

- 用途：创建/提交/触发 admin / backup / delete；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path filename: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：由领域 transformer/helper 构造；包装/嵌套模型见第14章，不能假设统一 data。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/backup/REPLACE_FILENAME/delete"
```

<a id="api-post-api-admin-wiki-categories"></a>

### POST /api/admin/wiki-categories

- 用途：创建/提交/触发 admin / wiki categories；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart description: optional string；id: optional string；name: optional string；order: optional number；requiresAdminEdit: optional boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 201: <code>category</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：201, 400, 401, 403, 500。HTTP 400: 分类 ID 和名称不能为空；HTTP 500: 创建百科分类失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"description":"文档测试说明","id":"REPLACE_ID","name":"文档测试名称","order":20,"requiresAdminEdit":"REPLACE_REQUIRESADMINEDIT"}' "$BASE_URL/api/admin/wiki-categories"
```

<a id="api-patch-api-admin-wiki-categories-id"></a>

### PATCH /api/admin/wiki-categories/:id

- 用途：部分更新 admin / wiki categories；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；query 无 query 字段；body/multipart description: optional string；name: optional string；order: optional number；requiresAdminEdit: optional boolean。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>category</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 分类名称不能为空；HTTP 500: 更新百科分类失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"description":"文档测试说明","name":"文档测试名称","order":20,"requiresAdminEdit":"REPLACE_REQUIRESADMINEDIT"}' "$BASE_URL/api/admin/wiki-categories/REPLACE_ID"
```

<a id="api-get-api-admin-tab"></a>

### GET /api/admin/:tab

- 用途：读取 admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path tab: required string path parameter；query includeDeleted?:string, only literal true includes; page/limit default1/20 clamp to shared ranges; music/albums may use sortBy allowed columns and sortOrder=asc|desc；body/multipart 此处理器不读取 JSON body；解析 schema admin tab list query。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>data</code>、<code>nested DTO fields</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse、toPostResponse、toGalleryResponse、toTicketListingListResponse、toEventListResponse、toMusicResponse、toAlbumResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 未知数据类型；HTTP 500: 获取管理数据失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/REPLACE_TAB?page=1&limit=20"
```

<a id="api-get-api-admin-tab-id"></a>

### GET /api/admin/:tab/:id

- 用途：读取 admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；tab: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>item</code>；HTTP 400: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>；DTO transformer toWikiResponse、toPostResponse、toGalleryResponse、toTicketListingResponse、toEventResponse、toUserResponse、toEditLockResponse。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 未知数据类型；HTTP 404: 记录不存在；HTTP 500: 获取详情失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/REPLACE_TAB/REPLACE_ID"
```

<a id="api-delete-api-admin-tab-id"></a>

### DELETE /api/admin/:tab/:id

- 用途：删除/移除 admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；tab: required string path parameter；query 无 query 字段；body/multipart reason?:string; required only for resource branches deleting another owner/moderation record; user self-delete forbidden；解析 schema per-resource admin delete body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 删除理由不能为空 / 不能删除自己 / 未知删除类型；HTTP 403: 只能删除普通用户；HTTP 404: 页面不存在 / 帖子不存在 / 图集不存在 / 盘票信息不存在 / 活动不存在 / 专辑不存在 / 用户不存在；HTTP 500: 删除失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"reason":"隔离测试原因"}' "$BASE_URL/api/admin/REPLACE_TAB/REPLACE_ID"
```

<a id="api-post-api-admin-tab-id-restore"></a>

### POST /api/admin/:tab/:id/restore

- 用途：创建/提交/触发 admin / restore；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；tab: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 该记录未被删除 / 未知恢复类型；HTTP 403: 无权恢复该用户；HTTP 404: 百科不存在 / 帖子不存在 / 图集不存在 / 盘票信息不存在 / 活动不存在 / 歌曲不存在 / 专辑不存在 / 公告不存在 / 版块不存在 / 分类不存在 / 图片映射不存在 / 用户不存在；HTTP 500: 恢复失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/REPLACE_TAB/REPLACE_ID/restore"
```

<a id="api-delete-api-admin-tab-id-permanent"></a>

### DELETE /api/admin/:tab/:id/permanent

- 用途：删除/移除 admin / permanent；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path id: required string path parameter；tab: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 403: <code>error</code>；HTTP 404: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 404, 500。HTTP 400: 请先软删除专辑 / 不能删除自己 / 未知彻底删除类型；HTTP 403: 无权彻底删除该用户；HTTP 404: 记录不存在 / 图集不存在 / 盘票信息不存在 / 活动不存在 / 歌曲不存在 / 专辑不存在 / 图片映射不存在 / 用户不存在；HTTP 500: 彻底删除失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/admin/REPLACE_TAB/REPLACE_ID/permanent"
```

<a id="api-get-api-admin-media-health-scan"></a>

### GET /api/admin/media-health/scan

- 用途：读取 admin / media health / scan；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query mode handler-supported; limit integer(default scan cap); result returns scan summary；body/multipart 此处理器不读取 JSON body；解析 schema media health scan。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400/401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/media-health/scan?limit=100"
```

<a id="api-post-api-admin-media-health-cleanup"></a>

### POST /api/admin/media-health/cleanup

- 用途：创建/提交/触发 admin / media health / cleanup；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart targets array of {recordType:mediaAsset|imageMap,id:nonempty string}, first100 valid items; mode dry-run|apply；解析 schema manual media health parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>；HTTP 400: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400: 请选择要清理的媒体记录。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"targets":[{"recordType":"imageMap","id":"REPLACE_WITH_IMAGE_MAP_ID"}],"mode":"dry-run"}' "$BASE_URL/api/admin/media-health/cleanup"
```

<a id="api-get-api-admin-dashboard"></a>

### GET /api/admin/dashboard

- 用途：读取 admin / dashboard；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取仪表盘数据失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/dashboard"
```

<a id="api-get-api-admin-rate-limits-config"></a>

### GET /api/admin/rate-limits/config

- 用途：读取 admin / rate limits / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取请求限流配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/rate-limits/config"
```

<a id="api-patch-api-admin-rate-limits-config"></a>

### PATCH /api/admin/rate-limits/config

- 用途：部分更新 admin / rate limits / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart partial JSON object; only 10 known buckets; bucket keys enabled/windowMs/max/message; windowMs integer1000–86400000, max integer1–100000, message1–120；解析 schema RateLimitAdminConfigUpdate。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 400: <code>success</code>、<code>error</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 更新请求限流配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/admin/rate-limits/config"
```

<a id="api-post-api-admin-rate-limits-config-reset"></a>

### POST /api/admin/rate-limits/config/reset

- 用途：创建/提交/触发 admin / rate limits / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 重置请求限流配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/rate-limits/config/reset"
```

<a id="api-get-api-admin-runtime-config"></a>

### GET /api/admin/runtime-config

- 用途：读取 admin / runtime config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取运行时配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/runtime-config"
```

<a id="api-patch-api-admin-runtime-config"></a>

### PATCH /api/admin/runtime-config

- 用途：部分更新 admin / runtime config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart JSON object; bool values must boolean; numbers finite/clamped; strings trimmed; unknown keys ignored; full per-key ranges in chapter14；解析 schema Partial<RuntimeConfig>。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 400: <code>success</code>、<code>error</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 更新运行时配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/admin/runtime-config"
```

<a id="api-post-api-admin-runtime-config-reset"></a>

### POST /api/admin/runtime-config/reset

- 用途：创建/提交/触发 admin / runtime config / reset；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 重置运行时配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/runtime-config/reset"
```

<a id="api-get-api-admin-secrets-config"></a>

### GET /api/admin/secrets-config

- 用途：读取 admin / secrets config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取服务凭证配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/secrets-config"
```

<a id="api-patch-api-admin-secrets-config"></a>

### PATCH /api/admin/secrets-config

- 用途：部分更新 admin / secrets config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart JSON object, only known credential names; values string|null; omitted unchanged; null/empty clears; response only exposes configured/last4；解析 schema Partial<SecretsConfig>。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 400: <code>success</code>、<code>error</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 未配置 SECRETS_ENCRYPTION_KEY，无法管理凭证 / 请求体必须是对象；HTTP 500: 更新服务凭证失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/admin/secrets-config"
```

<a id="api-get-api-admin-disk-status"></a>

### GET /api/admin/disk/status

- 用途：读取 admin / disk / status；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to get disk status。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/status"
```

<a id="api-get-api-admin-disk-config"></a>

### GET /api/admin/disk/config

- 用途：读取 admin / disk / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to get disk monitor configuration。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/config"
```

<a id="api-put-api-admin-disk-config"></a>

### PUT /api/admin/disk/config

- 用途：更新/执行 admin / disk / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart warningThresholdGB/criticalThresholdGB positive; critical < warning; checkIntervalMs>=60000; uploadsMinFreeMB>=10; each optional；解析 schema disk config partial object。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>data</code>、<code>previousConfig</code>、<code>timestamp</code>；HTTP 400: <code>success</code>、<code>error</code>、<code>details</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: Request body must be a JSON object / Validation failed / criticalThresholdGB must be less than warningThresholdGB；HTTP 500: Failed to update disk monitor configuration。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/admin/disk/config"
```

<a id="api-post-api-admin-disk-config-reset"></a>

### POST /api/admin/disk/config/reset

- 用途：创建/提交/触发 admin / disk / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to reset configuration。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/config/reset"
```

<a id="api-post-api-admin-disk-check"></a>

### POST /api/admin/disk/check

- 用途：创建/提交/触发 admin / disk / check；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Manual disk check failed。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/check"
```

<a id="api-post-api-admin-disk-monitor-stop"></a>

### POST /api/admin/disk/monitor/stop

- 用途：创建/提交/触发 admin / disk / monitor；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to stop monitoring。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/monitor/stop"
```

<a id="api-post-api-admin-disk-monitor-resume"></a>

### POST /api/admin/disk/monitor/resume

- 用途：创建/提交/触发 admin / disk / monitor；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>message</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to resume monitoring。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" "$BASE_URL/api/admin/disk/monitor/resume"
```

<a id="api-get-api-admin-variants-stats"></a>

### GET /api/admin/variants/stats

- 用途：读取 admin / variants / stats；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to get variant generator stats。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/variants/stats"
```

<a id="api-get-api-admin-cloud-sync-stats"></a>

### GET /api/admin/cloud-sync/stats

- 用途：读取 admin / cloud sync / stats；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>lskyProAvailable</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to get cloud sync stats。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/cloud-sync/stats"
```

<a id="api-post-api-admin-rebuild-all-variants"></a>

### POST /api/admin/rebuild-all-variants

- 用途：创建/提交/触发 admin / rebuild all variants；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart type=imageMap|songCover|albumCover|all(default imageMap); scope=all|failed|missing|outdated(default missing); batchSize integer1–1000(default50); dryRun/force:boolean；解析 schema rebuild variants request。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>jobId</code>、<code>status</code>、<code>summary</code>、<code>message</code>、<code>timestamp</code>、<code>nested DTO fields</code>；HTTP 400: <code>success</code>、<code>error</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: batchSize must be an integer between 1 and 1000 / dryRun and force must be boolean values；HTTP 500: Failed to initiate variant rebuild。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"imageMap","scope":"missing","batchSize":1,"dryRun":true,"force":false}' "$BASE_URL/api/admin/rebuild-all-variants"
```

<a id="api-get-api-admin-rebuild-status-jobid"></a>

### GET /api/admin/rebuild-status/:jobId

- 用途：读取 admin / rebuild status；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path jobId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>jobId</code>、<code>status</code>、<code>queueLength</code>、<code>processingCount</code>、<code>completedToday</code>、<code>failedToday</code>、<code>timestamp</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403。HTTP 401/403 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/rebuild-status/REPLACE_JOBID"
```

<a id="api-get-api-admin-cleanup-stats"></a>

### GET /api/admin/cleanup/stats

- 用途：读取 admin / cleanup / stats；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>data</code>、<code>timestamp</code>；HTTP 500: <code>success</code>、<code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: Failed to get variant statistics。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/admin/cleanup/stats"
```

<a id="api-get-api-config-gallery-access"></a>

### GET /api/config/gallery-access

- 用途：读取 config / gallery access；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>adminOnly</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取图集权限配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/config/gallery-access"
```

<a id="api-get-api-config-features"></a>

### GET /api/config/features

- 用途：读取 config / features；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>semanticSearch</code>、<code>registrationEnabled</code>、<code>searchHotKeywordsEnabled</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取站点功能配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/config/features"
```

<a id="api-get-api-config-admin-permissions"></a>

### GET /api/config/admin-permissions

- 用途：读取 config / admin permissions；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>allowSuperAdminRoleChanges</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取后台权限配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/admin-permissions"
```

<a id="api-get-api-config-registration-admin"></a>

### GET /api/config/registration/admin

- 用途：读取 config / registration / admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from config</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取注册配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/registration/admin"
```

<a id="api-patch-api-config-registration"></a>

### PATCH /api/config/registration

- 用途：部分更新 config / registration；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart enabled:boolean required；解析 schema feature toggle。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>config</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: enabled 必须是布尔值；HTTP 500: 更新注册配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"enabled":false}' "$BASE_URL/api/config/registration"
```

<a id="api-get-api-config-search-hot-keywords-admin"></a>

### GET /api/config/search-hot-keywords/admin

- 用途：读取 config / search hot keywords / admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from config</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取搜索热词配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/search-hot-keywords/admin"
```

<a id="api-patch-api-config-search-hot-keywords"></a>

### PATCH /api/config/search-hot-keywords

- 用途：部分更新 config / search hot keywords；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart enabled:boolean required；解析 schema feature toggle。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>config</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: enabled 必须是布尔值；HTTP 500: 更新搜索热词配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"enabled":false}' "$BASE_URL/api/config/search-hot-keywords"
```

<a id="api-get-api-config-email-verification"></a>

### GET /api/config/email-verification

- 用途：读取 config / email verification；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from toEmailVerificationPublicConfig(config)</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取邮箱验证配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/config/email-verification"
```

<a id="api-get-api-config-email-verification-admin"></a>

### GET /api/config/email-verification/admin

- 用途：读取 config / email verification / admin；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from toEmailVerificationAdminConfig(config)</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取邮箱验证配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/email-verification/admin"
```

<a id="api-patch-api-config-email-verification"></a>

### PATCH /api/config/email-verification

- 用途：部分更新 config / email verification；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：超级管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart enabled:boolean and smtpSecure:boolean required; publicBaseUrl/smtpHost/smtpUser/smtpFrom/smtpPass, smtpPort, tokenTtlMinutes and templates optional; TTL5–10080 minutes, port1–65535; clearSmtpPass:true clears credential；解析 schema email verification settings。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>config</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: enabled 必须是布尔值 / smtpSecure 必须是布尔值 / 验证链接有效期必须是 5 到 10080 分钟之间的整数 / SMTP 端口必须是 1 到 65535 之间的整数 / 站点公网地址必须使用 http 或 https / 站点公网地址格式无效 / 启用邮箱验证前请配置站点公网地址、SMTP Host 和发件人；HTTP 500: 更新邮箱验证配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"enabled":false,"smtpSecure":false,"publicBaseUrl":"https://example.invalid","tokenTtlMinutes":60,"smtpHost":"smtp.example.invalid","smtpPort":587,"smtpFrom":"noreply@example.invalid"}' "$BASE_URL/api/config/email-verification"
```

<a id="api-get-api-config-image-preference"></a>

### GET /api/config/image-preference

- 用途：读取 config / image preference；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from cached</code>、<code>response from preference</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 500。HTTP 500: 获取图片偏好设置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/config/image-preference"
```

<a id="api-patch-api-config-image-preference"></a>

### PATCH /api/config/image-preference

- 用途：部分更新 config / image preference；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart autoSync: optional boolean；fallback: optional boolean；strategy: optional 'local' | 's3' | 'external'。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>preference</code>、<code>syncTask</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 更新图片偏好设置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"autoSync":true,"fallback":true,"strategy":"local"}' "$BASE_URL/api/config/image-preference"
```

<a id="api-get-api-config-image-sync"></a>

### GET /api/config/image-sync

- 用途：读取 config / image sync；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query taskId: optional string；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>task</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取同步状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/image-sync?taskId=REPLACE_VALUE"
```

<a id="api-post-api-config-image-sync"></a>

### POST /api/config/image-sync

- 用途：创建/提交/触发 config / image sync；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart strategy: required 's3' | 'external'。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>、<code>task</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请指定有效的同步策略: s3 或 external。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"strategy":"local"}' "$BASE_URL/api/config/image-sync"
```

<a id="api-delete-api-config-image-sync-taskid"></a>

### DELETE /api/config/image-sync/:taskId

- 用途：删除/移除 config / image sync；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path taskId: required string path parameter；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>success</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 任务不存在或已完成/失败；HTTP 500: 取消同步任务失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X DELETE -H "$AUTH_HEADER" "$BASE_URL/api/config/image-sync/REPLACE_TASKID"
```

<a id="api-get-api-config-s3-config"></a>

### GET /api/config/s3/config

- 用途：读取 config / s3 / config；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from config</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取 S3 配置失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/s3/config"
```

<a id="api-get-api-config-s3-presign-upload"></a>

### GET /api/config/s3/presign-upload

- 用途：读取 config / s3 / presign upload；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：已认证且未封禁。
- 参数契约：path 无 path 字段；query filename required string; contentType?:MIME; contentMd5?:32 hex; fileSize?:positive integer；body/multipart 此处理器不读取 JSON body；解析 schema S3 upload signature request。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>response from result</code>、<code>error</code>；HTTP 400: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403。HTTP 400: 缺少 filename 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/s3/presign-upload?filename=test.png&contentType=image%2Fpng&fileSize=1"
```

<a id="api-get-api-config-s3-presign-download-wildcard-key"></a>

### GET /api/config/s3/presign-download/\*key

- 用途：读取 config / s3 / presign download；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：已认证。
- 参数契约：path key: required string path parameter；query 无 query 字段；body/multipart body 按 S3 object key 校验；解析 schema S3 object key。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>downloadUrl</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 缺少 key 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/s3/presign-download/example/key"
```

<a id="api-get-api-config-s3-presign-delete-wildcard-key"></a>

### GET /api/config/s3/presign-delete/\*key

- 用途：读取 config / s3 / presign delete；目标资源与完整业务约束见第 14 章「管理后台与系统配置」。
- 权限：管理员。
- 参数契约：path key: required string path parameter；query 无 query 字段；body/multipart body 按 S3 object key 校验；解析 schema S3 object key。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>deleteUrl</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 缺少 key 参数。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/config/s3/presign-delete/example/key"
```

## 15. 语义检索与运维任务

### 图片与文本向量管理

/api/embeddings 全部需要管理员，仅在 isSemanticSearchEnabled() 为真时挂载；关闭时返回普通 404。任务依赖本地模型与 Qdrant，存在较高 CPU/GPU/网络开销。

- GET /status：模型加载状态、来源可用性、表/集合状态及错误摘要。
- POST /enqueue-missing：body type=gallery|wiki|post|all（默认 all）、limit 默认运行时批大小，范围 1–2000；排队缺失图片向量。
- POST /sync-batch：body type、galleryImageIds、limit(1–500)、includeFailed=false、forceRebuild=false；同步图片向量。
- GET /errors：query type、limit 1–200 默认20；返回 errors、total、type、warnings、imageSourceAvailability；缺表会 warning 并跳过来源。
- POST /retry-failed：body type、limit(1–500)；重置并处理失败项。POST /rebuild-all：重置所选图片向量状态后按批重算。
- POST /sync-wiki：body slugs 非空数组；POST /sync-post：body ids 非空帖子内部 ID 数组；返回排队结果与 modelName/vectorSize。
- GET /text/status：文本向量模型、集合、表状态及摘要。
- POST /text/enqueue：body sourceType=wiki|post|music|album|all、limit、slugs、ids。提供 slugs 时同步 Wiki；提供 ids 时必须指定 post/music/album；都不提供时补齐缺失来源。
- POST /text/sync：body limit(1–500)、includeFailed=false。POST /text/retry-failed、/text/rebuild-all：body sourceType 与 limit(1–500)，分别重试失败项或重建所选文本来源。

### 逐接口契约（13 项）

<a id="api-get-api-embeddings-status"></a>

### GET /api/embeddings/status

- 用途：读取 embeddings / status；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>modelName</code>、<code>vectorSize</code>、<code>qdrantCollection</code>、<code>modelCacheDir</code>、<code>modelLoaded</code>、<code>textModelLoaded</code>、<code>tokenizerLoaded</code>、<code>modelErrors</code>、<code>usingModelScope</code>、<code>actualDtype</code>、<code>summary</code>、<code>imageSourceAvailability</code>、<code>imageEmbeddingReady</code>、<code>imageEmbeddingTableMissing</code>、<code>imageEmbeddingWarning</code>、<code>textSummary</code>、<code>textEmbeddingReady</code>、<code>textEmbeddingTableMissing</code>、<code>textEmbeddingWarning</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取向量状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/embeddings/status"
```

<a id="api-post-api-embeddings-enqueue-missing"></a>

### POST /api/embeddings/enqueue-missing

- 用途：创建/提交/触发 embeddings / enqueue missing；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart type=gallery|wiki|post|all(default all); limit integer1–2000(default runtime imageEmbeddingBatchSize); sync-batch additionally galleryImageIds/includeFailed/forceRebuild；解析 schema manual image embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>limit</code>、<code>type</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 补齐向量队列失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"gallery","limit":1}' "$BASE_URL/api/embeddings/enqueue-missing"
```

<a id="api-post-api-embeddings-sync-batch"></a>

### POST /api/embeddings/sync-batch

- 用途：创建/提交/触发 embeddings / sync batch；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart type=gallery|wiki|post|all(default all); limit integer1–500(default runtime imageEmbeddingBatchSize); sync-batch additionally galleryImageIds/includeFailed/forceRebuild；解析 schema manual image embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(；includeFailed: boolean; default false；forceRebuild: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>limit</code>、<code>includeFailed</code>、<code>forceRebuild</code>、<code>type</code>、<code>modelName</code>、<code>vectorSize</code>、<code>qdrantCollection</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 批量生成向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"gallery","limit":1}' "$BASE_URL/api/embeddings/sync-batch"
```

<a id="api-get-api-embeddings-errors"></a>

### GET /api/embeddings/errors

- 用途：读取 embeddings / errors；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query type=gallery|wiki|post|all(default all); limit integer1–200 default20；body/multipart 此处理器不读取 JSON body；解析 schema embedding error query；数值/布尔解析 limit: integer; default 20; range 1–200,。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>errors</code>、<code>total</code>、<code>type</code>、<code>warnings</code>、<code>imageSourceAvailability</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 获取向量失败记录失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/embeddings/errors?type=all&limit=20"
```

<a id="api-post-api-embeddings-retry-failed"></a>

### POST /api/embeddings/retry-failed

- 用途：创建/提交/触发 embeddings / retry failed；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart type=gallery|wiki|post|all(default all); limit integer1–500(default runtime imageEmbeddingBatchSize); sync-batch additionally galleryImageIds/includeFailed/forceRebuild；解析 schema manual image embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>limit</code>、<code>type</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 重试失败向量任务失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"gallery","limit":1}' "$BASE_URL/api/embeddings/retry-failed"
```

<a id="api-post-api-embeddings-rebuild-all"></a>

### POST /api/embeddings/rebuild-all

- 用途：创建/提交/触发 embeddings / rebuild all；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart type=gallery|wiki|post|all(default all); limit integer1–500(default runtime imageEmbeddingBatchSize); sync-batch additionally galleryImageIds/includeFailed/forceRebuild；解析 schema manual image embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>limit</code>、<code>type</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 重建所有向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"type":"gallery","limit":1}' "$BASE_URL/api/embeddings/rebuild-all"
```

<a id="api-post-api-embeddings-sync-wiki"></a>

### POST /api/embeddings/sync-wiki

- 用途：创建/提交/触发 embeddings / sync wiki；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart slugs nonempty string array; enqueue Wiki image vectors；解析 schema manual image embedding parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>slugs</code>、<code>modelName</code>、<code>vectorSize</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供至少一个 Wiki 页面 slug；HTTP 500: 同步 Wiki 页面向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"slugs":["REPLACE_WITH_WIKI_SLUG"]}' "$BASE_URL/api/embeddings/sync-wiki"
```

<a id="api-post-api-embeddings-sync-post"></a>

### POST /api/embeddings/sync-post

- 用途：创建/提交/触发 embeddings / sync post；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart ids nonempty Post internal ID array; enqueue Post image vectors；解析 schema manual image embedding parser。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>ids</code>、<code>modelName</code>、<code>vectorSize</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 请提供至少一个 Post ID；HTTP 500: 同步 Post 向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"ids":["REPLACE_WITH_POST_ID"]}' "$BASE_URL/api/embeddings/sync-post"
```

<a id="api-get-api-embeddings-text-status"></a>

### GET /api/embeddings/text/status

- 用途：读取 embeddings / text / status；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>summary</code>、<code>modelName</code>、<code>vectorSize</code>、<code>textCollection</code>、<code>textModelLoaded</code>、<code>tokenizerLoaded</code>、<code>textEmbeddingReady</code>、<code>textEmbeddingTableMissing</code>、<code>textEmbeddingWarning</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 401, 403, 500。HTTP 500: 获取文本向量状态失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -H "$AUTH_HEADER" "$BASE_URL/api/embeddings/text/status"
```

<a id="api-post-api-embeddings-text-enqueue"></a>

### POST /api/embeddings/text/enqueue

- 用途：创建/提交/触发 embeddings / text / enqueue；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart sourceType=wiki|post|music|album|all(default all); limit integer1–2000(default runtime imageEmbeddingBatchSize); slugs:string[] for Wiki or ids:string[] with sourceType post/music/album；解析 schema manual text embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>slugs</code>、<code>sourceType</code>、<code>ids</code>、<code>limit</code>；HTTP 400: <code>error</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 400: 提供 ids 时必须指定 sourceType 为 post/music/album；HTTP 500: 补齐文本向量队列失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"sourceType":"post","ids":["REPLACE_WITH_POST_ID"],"limit":1}' "$BASE_URL/api/embeddings/text/enqueue"
```

<a id="api-post-api-embeddings-text-sync"></a>

### POST /api/embeddings/text/sync

- 用途：创建/提交/触发 embeddings / text / sync；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart limit integer1–500(default runtime batch); includeFailed boolean(default false)；解析 schema manual text embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(；includeFailed: boolean; default false。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>limit</code>、<code>includeFailed</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 批量生成文本向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"limit":1,"includeFailed":false}' "$BASE_URL/api/embeddings/text/sync"
```

<a id="api-post-api-embeddings-text-retry-failed"></a>

### POST /api/embeddings/text/retry-failed

- 用途：创建/提交/触发 embeddings / text / retry failed；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart sourceType=wiki|post|music|album|all(default all); limit integer1–500(default runtime batch)；解析 schema manual text embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>limit</code>、<code>sourceType</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 重试失败文本向量任务失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"sourceType":"wiki","limit":1}' "$BASE_URL/api/embeddings/text/retry-failed"
```

<a id="api-post-api-embeddings-text-rebuild-all"></a>

### POST /api/embeddings/text/rebuild-all

- 用途：创建/提交/触发 embeddings / text / rebuild all；目标资源与完整业务约束见第 15 章「语义检索与运维任务」。
- 权限：管理员；仅条件开关开启时注册。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart sourceType=wiki|post|music|album|all(default all); limit integer1–500(default runtime batch)；解析 schema manual text embedding parser；数值/布尔解析 limit: integer; default getImageEmbeddingBatchSize(。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>nested DTO fields</code>、<code>limit</code>、<code>sourceType</code>；HTTP 500: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 400, 401, 403, 500。HTTP 500: 重建所有文本向量失败。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
# Resource-intensive or external side effect; use only in an isolated service environment.
curl --fail-with-body -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' --data '{"sourceType":"wiki","limit":1}' "$BASE_URL/api/embeddings/text/rebuild-all"
```

## 16. 仅网页登录、初始化及停用入口

### 初始化接口

GET /api/setup/status 返回 initialized/requiresSetup。POST /api/setup/initialize 仅允许用户表为空时调用；body email/displayName/password 必填；201 创建 super_admin 并设置网页登录 Cookie。初始化后再次请求 409。此端点不能发放 API key；不要在非空库或生产环境试用。

### 逐接口契约（2 项）

<a id="api-get-api-setup-status"></a>

### GET /api/setup/status

- 用途：读取 setup / status；目标资源与完整业务约束见第 16 章「仅网页登录、初始化及停用入口」。
- 权限：公开/可选身份。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart 此处理器不读取 body。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>initialized</code>、<code>requiresSetup</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200。无显式错误状态。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body "$BASE_URL/api/setup/status"
```

<a id="api-post-api-setup-initialize"></a>

### POST /api/setup/initialize

- 用途：创建/提交/触发 setup / initialize；目标资源与完整业务约束见第 16 章「仅网页登录、初始化及停用入口」。
- 权限：公开/可选身份。限流器 authRateLimiter。
- 参数契约：path 无 path 字段；query 无 query 字段；body/multipart displayName: required string；email: required string；password: required string；validateBody schema setupInitializeSchema。数组嵌套与字段长度按 referenced schema/DTO 表；省略/null/空数组和 PUT/PATCH 语义按领域说明。
- 成功响应：HTTP 200: <code>error</code>；HTTP 201: <code>success</code>、<code>user</code>；HTTP 409: <code>error</code>。嵌套字段见共享 DTO 表；包装按接口状态分支，不统一假设 data。
- HTTP 状态/失败：200, 201, 400, 409。HTTP 400/409 分支；触发条件见领域说明。所有权、可见性、软删除和副作用见本章业务说明。
- curl：传输格式模板；替换 REPLACE\_ 为前序响应真实 ID。破坏性操作只在隔离环境执行。

```bash
curl --fail-with-body -X POST -H 'Content-Type: application/json' --data '{"displayName":"文档测试用户","email":"user@example.invalid","password":"REPLACE_WITH_TEST_PASSWORD"}' "$BASE_URL/api/setup/initialize"
```

## 17. 错误、停用入口与重试

常见错误形状为 {error}，部分响应增加 code、fields 或 details。validateBody 校验失败返回 HTTP 400 {error:"Validation failed",fields}；字段错误路径由 Zod schema 决定。按状态和存在的 code 分支，不要依赖中文文案。

| HTTP | 说明                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 400  | 参数/schema/状态无效；根据具体 endpoint 的字段表修正。                                                       |
| 401  | 未认证或 API 密钥无效、过期、撤销；密钥错误 code 为 API_KEY_INVALID。                                        |
| 403  | 角色、封禁、资源归属/可见性或凭证类型限制；COOKIE_SESSION_REQUIRED 与 API_KEY_SESSION_FORBIDDEN 是不同边界。 |
| 404  | 资源不存在或不可见；核对 id/docId/slug/sourceId 类型。                                                       |
| 409  | 状态/重复关系/并发冲突；先读取当前记录。                                                                     |
| 410  | 上传会话过期；旧音乐导入接口也返回 410。                                                                     |
| 413  | 请求体/文件或维护批次过大；遵守单接口限制。                                                                  |
| 429  | 限流；按 Retry-After（若有）退避。                                                                           |
| 5xx  | 服务或依赖异常；写请求先确认服务端状态，不能假设未执行。                                                     |

下载端点返回附件而非 JSON：备份 ZIP 为 application/zip，恢复图片报告为 application/json，ImageMap CSV 为 text/csv。API 没有通用幂等键。重复上传文件可能重复创建 media claim；使用 session/asset 接口返回的 ID 查询状态，不要仅凭客户端断开认定失败。

明确停用/限制入口：

- POST /api/music/from-netease、/from-qq、/from-kugou、/from-baidu、/from-kuwo 均管理员可见但实际 HTTP 410；替代路径 POST /api/music/import。
- POST/DELETE /api/admin/sensitive-words 路由保留但返回 501；手动编辑 public/sensitive-words/words.txt。
- PUT /api/users/phone 返回 501，功能未启用。
- GET /api-docs.md 是静态 Markdown，不是 JSON API；设置密钥页入口路径保持不变。

```bash
unset API_KEY AUTH_HEADER
```
