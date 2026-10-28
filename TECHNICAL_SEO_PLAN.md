## Context

为黄诗扶 Wiki 实施不依赖 SSR 的技术 SEO 优化。保留现有 React SPA 架构；不实现 Twitter Card、不实现面包屑、不实现 SSR 或预渲染。最终结果包括统一的客户端页面元数据、canonical、Open Graph（不含 Twitter 元数据）、JSON-LD、公开资源的 robots.txt、动态 sitemap.xml、私有/筛选页面的 noindex，以及静态 HTML 语言和基础元数据修正。

当前 `index.html` 只有统一标题“黄诗扶 Wiki”，没有 description、canonical、Open Graph、robots；未发现 SEO 元数据管理器、robots.txt 或 sitemap。生产环境由 `server.ts:478-495` 对未匹配页面返回同一 SPA 壳，因此本方案不声称修复 HTTP 软 404；详情页加载失败时改用客户端 `noindex`，避免将错误页作为正常内容继续索引。

## Approach

### 1. 建立统一的客户端 SEO 元数据管理

1. 新增 `src/lib/seo.ts`，因为当前仓库没有可复用的 SEO 工具。定义并导出：
   - `SEO_SITE_NAME = '黄诗扶 Wiki'`。
   - `SEO_SITE_DESCRIPTION = '黄诗扶 Wiki，整理黄诗扶的音乐作品、歌曲、专辑、活动、图集与百科资料。'`。
   - `type SeoRobots = 'index,follow' | 'noindex,follow' | 'noindex,nofollow'`。
   - `interface SeoMetadata`：`title`、`description`、`canonicalPath`、`robots`、`ogType`、可选 `ogImage`、可选 `ogImageAlt`、可选 `jsonLd`；`jsonLd` 支持一个对象或对象数组。
   - `toAbsoluteSeoUrl(value: string): string`：浏览器环境使用 `window.location.origin` 将站内相对路径转为绝对 URL；已是 `http:`/`https:` 的 URL 原样保留；移除 hash，不把用户查询参数放入详情页 canonical。
   - `summarizeSeoText(value: string | null | undefined, fallback: string, maxLength = 160): string`：去除 HTML、Markdown 图片目标、Markdown 链接语法、标题/引用/强调/代码标记和重复空白；空值使用 fallback；按字符长度截断，保证 description 有界。
   - `normalizeCanonicalPath(pathname: string): string`：保留根路径 `/`，其他路径移除末尾 `/`，不包含 hash 或 query。
   - `applySeoMetadata(metadata: SeoMetadata): void`：只在 `document` 可用时运行；更新 `document.title`；按固定 `data-hsf-seo` 标记创建或更新 description、robots、canonical、`og:title`、`og:description`、`og:url`、`og:type`、`og:site_name`、`og:locale`、可选 `og:image` 和 `og:image:alt`；移除当前页面不需要的可选标签，避免导航后残留旧图片；用 `script[type='application/ld+json'][data-hsf-seo='jsonld']` 的 `textContent` 写入 JSON-LD，不使用 HTML 字符串拼接。
   - `useSeo(metadata: SeoMetadata): void`：以标题、描述、canonical、robots、OG 字段和序列化后的 JSON-LD 作为 effect 依赖调用 `applySeoMetadata`，避免页面普通状态更新时重复改写 head。
   - `getStaticRouteSeo(pathname: string, search: string): SeoMetadata | null`：为布局级路由提供确定元数据。首页、`/wiki`、`/forum`、`/gallery`、`/events`、`/music` 基础列表页使用 `index,follow`；`/search`、带筛选/分页 query 的公开列表使用 `noindex,follow` 且 canonical 指向无 query 的列表路径；`/admin`、`/settings`、认证、初始化、用户资料、编辑、历史、分支、PR、上传创建/编辑和 UI 展示路径使用 `noindex,nofollow`；详情路径返回 `null`，交由对应详情组件在数据加载期间和成功后设置自己的元数据。

2. 新增 `src/components/Seo.tsx`，提供无 UI 输出的 `Seo` 组件，签名为 `Seo({ metadata }: { metadata: SeoMetadata }): null`，内部调用 `useSeo`。它不是领域 UI 组件，不新增原生表单控件，也不发起网络请求。

3. 在 `src/App.tsx:58-214` 的 `MainLayout` 中根据 `useLocation()` 调用布局级 SEO。详情路径不由布局覆盖；详情组件必须在加载、成功、失败三种状态都调用 `Seo`，从而避免父级通用标题覆盖内容详情标题。`NotFound` 页面单独设置 `noindex,follow`。

### 2. 补齐基础 HTML 与路由级 noindex

1. 修改 `index.html:1-3`，将 `<html lang="cn">` 改为 `<html lang="zh-CN">`。
2. 修改 `index.html:139-140`，将统一 title 改为“黄诗扶 Wiki｜音乐作品、专辑、活动与百科资料”，并加入基础 description、`meta name="robots" content="index,follow"`、`og:title`、`og:description`、`og:type="website"`、`og:site_name`、`og:locale="zh_CN"`。不加入任何 `twitter:*` 标签；不加入静态 canonical，避免所有 SPA 路径在脚本运行前错误指向首页。静态 meta 使用 `data-hsf-seo` 标记，供客户端管理器原位更新而不产生重复标签。
3. 在 `src/pages/NotFound.tsx:8-43` 使用 `Seo`，固定 title 为“页面不存在｜黄诗扶 Wiki”、description 为“当前路径没有对应页面。”、robots 为 `noindex,follow`，canonical 为当前 pathname 的规范化路径。
4. 在 `src/pages/Search.tsx:10-114` 显式使用 `Seo`：title 为“搜索｜黄诗扶 Wiki”、description 为“搜索黄诗扶 Wiki 中的百科、音乐、活动、图集和社区内容。”、robots 为 `noindex,follow`、canonical 为 `/search`。查询参数不进入 canonical。
5. 其他认证、设置、管理、编辑、历史和协作页面由 `MainLayout` 的 `getStaticRouteSeo` 统一设置 noindex；不在各页面重复添加同一套逻辑。

### 3. 为公开详情页生成动态 title、description、canonical、OG 和 JSON-LD

以下组件都必须在已有 API 状态逻辑之后、任何条件 return 之前调用 `useSeo` 或渲染 `Seo`。加载中或请求失败/资源不存在时使用 `noindex,follow`；数据成功且内容可公开时使用 `index,follow`。所有 canonical 只使用当前详情路径，不带 query/hash。

1. `src/pages/wiki/WikiPageView.tsx:83-176`：
   - 成功：title `${page.title}｜黄诗扶 Wiki`；description 用 `summarizeSeoText(page.content, `${page.title}，黄诗扶 Wiki 百科资料。`)`；canonical `/wiki/${slug}`；OG type `article`。
   - JSON-LD 使用 `Article`，字段为 `@context`、`@type`、`headline`、`description`、`mainEntityOfPage`、`datePublished`、`dateModified`；只在有对应值时写日期。不要把“最后编辑者”虚构成文章作者。
   - 失败或无 page：title “百科页面不存在｜黄诗扶 Wiki”、robots `noindex,follow`。
2. `src/pages/MusicDetail.tsx:120-133`：
   - 成功：title `${song.title}｜歌曲信息与歌词｜黄诗扶 Wiki`；description 按“歌曲名 + 艺术家 + 专辑 + 简介”组合并通过 `summarizeSeoText` 限长；canonical `/music/${songId}`；OG type `music.song`；有封面时设置 `og:image`。
   - JSON-LD 使用 `MusicRecording`，包含 `name`、`url`、`byArtist`、可选 `inAlbum`、`datePublished`、`image`、`duration`；只输出数据库确实存在且格式有效的字段。
   - 加载失败或 song 为空：noindex。
3. `src/pages/AlbumDetail.tsx:55-115`：
   - 成功：title `${album.title}｜专辑曲目与介绍｜黄诗扶 Wiki`；description 使用专辑简介，缺失时使用包含艺术家和曲目数量的默认描述；canonical `/album/${albumId}`；OG type `music.album`；有封面时设置图片。
   - JSON-LD 使用 `MusicAlbum`，包含 `name`、`url`、`byArtist`、`image`、`numTracks`，有发行日期时加入 `datePublished`；曲目仅使用详情 API 已返回的标题和 URL。
   - 加载失败或 album 为空：noindex。
4. `src/pages/EventDetail.tsx:67-107`：
   - 成功：title `${event.title}｜黄诗扶活动记录`；description 使用活动正文摘要并在缺失时使用地点/活动默认描述；canonical `/events/${slug}`；OG type `article`；封面存在时设置图片。
   - JSON-LD 使用 `Event`，包含 `name`、`url`、`description`、`image`、`location`；只有 `sortStart` 能被解析为有效日期时才设置 `startDate`，否则省略，不猜测活动时间。
   - 加载失败或 event 为空：noindex。
5. `src/pages/GalleryDetail.tsx:93-96,779-821`：
   - 成功：title `${gallery.title}｜黄诗扶图集`；description 使用图集简介并在缺失时使用图集默认描述；canonical `/gallery/${galleryId}`；OG type `article`；首张图片作为 OG image。
   - JSON-LD 使用 `ImageGallery`，包含 `name`、`description`、`url`、`image` 数组；图片 URL 通过 `toAbsoluteSeoUrl` 转为绝对地址，过滤空 URL。
   - 加载失败或 gallery 为空：noindex。
6. `src/pages/Forum.tsx:407-492,852-923` 的 `PostDetail`：
   - 成功：title `${post.title}｜黄诗扶 Wiki 社区`；description 用帖子正文摘要；canonical `/forum/${postPublicId}`；OG type `article`。
   - JSON-LD 使用 `Article`，包含 `headline`、`description`、`mainEntityOfPage`、`datePublished`、`dateModified`；不把用户生成内容作者未经确认地映射为站点 Person。
   - 加载失败、无 post 或状态不是 `published` 且当前用户不是其合法可见者：noindex；公开已发布帖子才 index。

### 4. 增加服务端 robots.txt 与动态 sitemap.xml

1. 新增 `src/server/utils/seo.ts`，因为服务端需要独立于浏览器 DOM 的 URL/XML 逻辑。定义并导出：
   - `PUBLIC_SITE_URL_ENV = 'PUBLIC_SITE_URL'`。
   - `getPublicSiteUrl(req: Request): string`：优先读取 `PUBLIC_SITE_URL`；要求 `http:` 或 `https:`，去掉末尾 `/`；未配置或值非法时退回 `req.protocol + '://' + req.get('host')`，并保留该 fallback 的可测试行为。
   - `escapeXml(value: string): string`：转义 `&`、`<`、`>`、`"`、`'`。
   - `interface SitemapEntry { path: string; lastmod: Date }`。
   - `buildSitemapXml(entries: SitemapEntry[], siteUrl: string): string`：输出 XML 声明和 `<urlset>`，每项仅包含规范化 `<loc>` 与 ISO `<lastmod>`；禁止携带查询参数或 hash。
   - `buildSitemapIndexXml(pageCount: number, siteUrl: string): string`：当 URL 数量超过单文件上限时输出 sitemap index。
   - `getRobotsDirective(pathname: string, hasQuery: boolean): 'index, follow' | 'noindex, follow' | 'noindex, nofollow'`：对 `/admin`、`/settings`、认证、初始化、用户资料、编辑/历史/分支/PR、上传创建/编辑和 `/__ui` 返回 `noindex, nofollow`；对 `/search` 或公开列表 query 返回 `noindex, follow`；其余文档路径返回 `index, follow`。
   - `isDocumentPath(pathname: string): boolean`：排除 `/api/`、`/assets/`、`/uploads/`、已知静态文件扩展名，避免给 API、图片和构建产物添加无意义的 X-Robots-Tag。
2. 新增 `src/server/routes/seo.routes.ts`，注册 `registerSeoRoutes(app: Router)`，包含：
   - `GET /robots.txt`：`Content-Type: text/plain; charset=utf-8`，`Cache-Control: public, max-age=3600`；正文允许 `/`，禁止 `/api/`、`/admin`、`/settings`、`/login`、`/forgot-password`、`/reset-password`、`/verify-email`、`/setup`、`/search`、`/__ui`，并输出由 `getPublicSiteUrl` 生成的 `Sitemap: <site>/sitemap.xml`。
   - `GET /sitemap.xml`：并行查询公开 URL 的 slug 与 updatedAt，使用现有公开可见性规则的等价条件：Wiki `status: 'published', deletedAt: null`；Post `status: 'published', deletedAt: null`；Gallery `status: 'published', deletedAt: null`；Event `deletedAt: null`；MusicTrack `deletedAt: null`；Album `deletedAt: null`。生成 `/wiki/:slug`、`/forum/:slug`、`/gallery/:slug`、`/events/:slug`、`/music/:slug`、`/album/:slug` 和 `/`，去重并按 path 排序。
   - sitemap 单文件上限固定为 45,000 个 URL；不超过上限输出 urlset，超过上限输出 sitemap index，并提供 `GET /sitemap-:page.xml` 输出对应分片；页码不是正整数、超出范围或查询失败返回合适的 404/500，不返回伪造的空 sitemap。
   - 使用现有 `enhancedCache` 缓存已加载的 sitemap entries 600 秒，缓存 key 固定为 `seo:sitemap`；设置 `Cache-Control: public, max-age=600`。单次查询失败记录 logger 并返回 500。
3. 在 `server.ts:28-65` 引入并在静态资源和 SPA fallback 之前注册 `registerSeoRoutes(app)`，确保生产环境不会被 `dist/index.html` 抢先处理 `/robots.txt` 或 `/sitemap.xml`。路由只查询数据库，不改变任何业务 API。
4. 在 `server.ts` 的生产/开发文档请求中增加 X-Robots-Tag 中间件：使用 `getRobotsDirective(req.path, Object.keys(req.query).length > 0)`，仅对 `isDocumentPath(req.path)` 设置 `X-Robots-Tag`。该 header 负责在首个 SPA 壳返回时保护私有页面和筛选页面；详情资源不存在仍由客户端详情 SEO 设置 noindex，因本方案不引入 SSR。
5. 在 `.env.example` 增加可选 `PUBLIC_SITE_URL`，说明生产环境填写完整站点根 URL，例如 `https://wiki.example.com`；未填写时按请求协议和 Host fallback。该配置不是数据库 schema，不需要迁移或 Prisma Client 变更。

### 5. 保持公开链接和图片的技术 SEO 约束

1. 详情页的所有 canonical、JSON-LD URL 和 OG URL 必须由统一 URL helper 生成，去掉 query/hash；sitemap 只写无 query/hash URL。
2. 不改现有数字 slug，不引入中文 slug、重定向或兼容别名，避免无必要的 URL 迁移。
3. 不修改现有业务 `alt` 文本策略；对新增 JSON-LD 的图片只引用已有的封面、首张图集图片和海报 URL，不生成虚假图片描述。
4. 不新增 Twitter Card、不新增面包屑、不把页面正文复制到基础 HTML；所有公开详情内容仍由现有 API 和 React 渲染。

## Critical files & anchors

- `src/lib/seo.ts`：新增客户端 SEO 类型、文本摘要、URL 规范化、head/JSON-LD 更新和路由元数据映射。
- `src/components/Seo.tsx`：新增无 UI 的 SEO 组件，供布局和详情页复用。
- `src/server/utils/seo.ts`、`src/server/routes/seo.routes.ts`：新增 robots、sitemap、XML、站点 URL 和 X-Robots-Tag 逻辑。
- `server.ts:28-65,269-307,419-496`：注册 SEO 路由、设置文档 X-Robots-Tag，并保持既有静态资源与 SPA fallback 顺序。
- `src/App.tsx:58-214` 及 `src/pages/{wiki/WikiPageView,MusicDetail,AlbumDetail,EventDetail,GalleryDetail,Forum,NotFound,Search}.tsx`：布局级和数据详情级元数据接入；实现者必须在条件 return 前调用 hook。

## Verification

1. 新增 `tests/unit/seo.test.ts`，使用 node 项目覆盖纯函数：
   - `summarizeSeoText` 会去除 Markdown/HTML、压缩空白并截断；空字符串返回 fallback。
   - `normalizeCanonicalPath('/wiki/123/?x=1#top')` 返回 `/wiki/123`。
   - `getRobotsDirective('/admin/settings', false)` 返回 `noindex, nofollow`；`getRobotsDirective('/events', true)` 返回 `noindex, follow`；`getRobotsDirective('/wiki/123', false)` 返回 `index, follow`。
   - XML 入口在标题或路径含 `&<>"'` 时输出合法转义，sitemap URL 不含 query/hash。
2. 在 jsdom 测试中覆盖 `applySeoMetadata`/`useSeo`：先应用一个带 OG image 和 JSON-LD 的 Wiki metadata，再应用一个无图片的列表 metadata；断言 `document.title`、description、robots、唯一 canonical、OG 标签、JSON-LD 内容和旧 `og:image` 均符合第二次 metadata，证明客户端导航不会残留旧 head。
3. 扩展 `tests/unit/serverStaticHtmlRouting.test.ts` 或新增服务端 SEO 路由测试：使用 Express 测试 app 注册 `robots.txt`，断言响应为 `text/plain`、包含禁止路径和配置站点的 sitemap URL；用固定 SitemapEntry 断言 XML 响应包含 `<lastmod>` 和正确转义。数据库查询失败路径使用 mock，断言返回 500 而不是空的 200 sitemap。
4. 详情页至少新增/扩展一个现有页面测试，模拟 API 成功、失败和空结果，断言成功时 title/canonical/robots/JSON-LD，失败时 robots 为 `noindex,follow`；优先复用 `tests/unit/musicDetail.test.tsx` 或 `tests/unit/wikiPageLoading.test.tsx` 的现有 mock 模式。
5. 运行格式化与完整验证：在仓库根目录执行 `npm run format`，随后执行 `npm run verify`。`verify` 必须覆盖 check:ui、TypeScript、单元测试、集成测试和 Vite build；若 `.env.test`/数据库等现有集成测试前置条件缺失，按仓库既有测试约定准备，不缩小验证范围。
6. 手工 smoke：以生产构建启动服务，访问 `/robots.txt`、`/sitemap.xml`、`/`、一个已存在的公开详情路径、`/search?q=黄诗扶` 和 `/admin`；确认前两者不是 SPA HTML，详情成功后浏览器 head 为对应 title/canonical/OG/JSON-LD，搜索和管理页为 noindex，公开列表 query canonical 不带 query。

## Assumptions & contingencies

- 站点生产域名通过新增的 `PUBLIC_SITE_URL` 提供；若部署环境暂时未配置，服务端按当前请求的协议和 Host 生成 sitemap，客户端按浏览器 origin 生成 canonical。若 `PUBLIC_SITE_URL` 不是 http/https，忽略该值并使用请求 fallback，同时记录 warning，不阻塞页面响应。
- 当前数据库中 Event、Album、MusicTrack 的公开 API 以 `deletedAt: null` 作为匿名可见条件；Wiki、Post、Gallery 额外要求 `status: 'published'`，实现严格采用已读取的路由和 `authorization.ts` 规则，不把草稿或仅登录用户可见内容写入 sitemap。
- 不做 SSR 意味着搜索引擎初始 HTML 仍是 SPA 壳；本次通过客户端 head、X-Robots-Tag、robots、sitemap 和 JSON-LD改善可抓取信号，但不把客户端渲染效果表述为服务端首屏可见正文。若后续要求搜索引擎在未执行 JS 时直接读取正文，必须另立 SSR/预渲染任务。
- Sitemap 分片路由使用缓存中的完整公开 URL 列表；缓存 600 秒内新增或修改内容可能暂时不反映在 sitemap，过期后自动刷新，不增加每次内容写入的跨路由失效耦合。
