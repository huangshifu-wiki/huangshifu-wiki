# 贡献指南

感谢你愿意参与黄诗扶 Wiki 的改进。项目当前为源码可见项目，暂未开放开源许可证；提交贡献前，请确认你接受贡献合入后继续遵循本仓库当前授权状态。

## 开发环境

- Node.js 22+
- npm
- PostgreSQL 16+

初始化：

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run db:seed
```

启动开发服务：

```bash
npm run dev
```

## 开发约束

- 前端请求统一通过 `src/lib/apiClient.ts`，不要直接写 `fetch`。
- 后端请求体验证优先放在 `src/server/schemas/`，路由保持薄层组装。
- 后端公共工具优先从 `src/server/utils/index.ts` barrel 导入。
- 涉及 Prisma schema 时，同步检查迁移、Prisma Client、服务端类型、前端类型和调用方。
- 不提交 `dist/`、`coverage/`、`uploads/`、`backups/`、`models/` 等生成或运行时目录。

## 提交前验证

至少运行：

```bash
npm run verify
```

安全相关或依赖变更还应运行：

```bash
npm audit --omit=dev --audit-level=high
```

## 提交信息

提交消息使用约定式提交格式，说明使用中文：

```text
type(scope): 中文说明
```

示例：

```text
fix(upload): 修复图片变体清理逻辑
docs(readme): 完善本地运行说明
```

## Pull Request

PR 请包含：

- 改动目的和用户可见影响
- 关键实现说明
- 已执行的验证命令
- 涉及接口、数据库、环境变量或部署步骤时的兼容说明

安全漏洞请不要提交公开 issue 或 PR，按 [SECURITY.md](SECURITY.md) 处理。
