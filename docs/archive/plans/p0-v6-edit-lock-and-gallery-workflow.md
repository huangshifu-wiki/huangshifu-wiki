# P0 v6 实现记录：编辑锁 + 图集发布流

## 变更范围

- 后端新增记录级编辑锁能力（申请、续期、释放、管理员强制释放）。
- 图集新增发布状态能力，支持草稿/发布切换。
- 图集新增存量编辑能力：基础信息更新、追加图片、删除图片、重排。
- 图集列表/详情增加发布态可见性控制。
- 管理后台新增 `编辑锁` 管理 tab。

## 代码变更

- `prisma/schema.prisma`
  - `Gallery` 新增 `published`、`publishedAt` 字段与索引 `@@index([published, updatedAt])`
  - 新增 `EditLock` 模型（包含唯一键 `@@unique([collection, recordId])`）
- `prisma/migrate.sql`
  - 新增 `EditLock` 建表 SQL
  - 补齐 `Gallery.published`、`Gallery.publishedAt` 与 `Gallery_published_updatedAt_idx`
- `server.ts`
  - 新增编辑锁 API：
    - `POST /api/admin/locks`
    - `PATCH /api/admin/locks/:id/renew`
    - `DELETE /api/admin/locks/:id`
    - `DELETE /api/admin/locks/:collection/:recordId`
  - 新增图集编辑与发布 API：
    - `PATCH /api/galleries/:id`
    - `PATCH /api/galleries/:id/publish`
    - `POST /api/galleries/:id/images`
    - `DELETE /api/galleries/:id/images/:imageId`
    - `PATCH /api/galleries/:id/images/reorder`
  - 增强图集访问控制：
    - `GET /api/galleries`：游客只返回已发布图集
    - `GET /api/galleries/:id`：未发布图集仅作者和管理员可见
  - 管理后台接口扩展 `locks` tab 数据源：
    - `GET /api/admin/locks`
    - `GET /api/admin/locks/:id`
    - `DELETE /api/admin/locks/:id`
- `src/pages/Admin.tsx`
  - 新增 `编辑锁` tab 与列表展示
  - 支持在后台直接删除锁
- `docs/server-deployment.md`
  - 增补 v6 上线说明、环境变量、部署命令和接口验证清单

## 验证结果

- 本地静态检查：`npm run lint` 通过。
- 本地构建：`npm run build` 通过（存在 Vite chunk size warning，不阻断）。

## 部署状态

当前由于远端 SSH banner 交换超时，无法完成自动部署执行；需待服务器 SSH 服务恢复后按 `docs/server-deployment.md` 第 18 节执行。
