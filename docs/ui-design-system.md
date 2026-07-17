# 黄诗扶 Wiki UI 设计系统

## 公共入口

业务代码只从 `@/src/components/ui` 导入。禁止导入 `src/components/ui/` 下的内部文件；组件库不得读取业务 Context、调用 API 或依赖 `pages`、`services`、`server`。

## 组件选型

- 页面或领域卡片保留在对应业务目录；仅无业务语义的容器使用 `Panel`、`Badge`、`EmptyState`。
- 页面跳转使用 `LinkButton`，提交和操作使用 `Button`，纯图标操作使用带可读 `aria-label` 的 `IconButton`。
- 表单项使用 `Field` 包裹 Input、Textarea 或 Select，由 Field 统一生成 label、说明、错误与 `aria-describedby`。
- 需要焦点管理、键盘导航或 Portal 的交互优先组合 Dialog、AlertDialog、DropdownMenu、Popover、Tooltip、Tabs 等组件，不自行实现行为内核。

## 变体与 Token

Button 变体固定为 `primary`、`secondary`、`ghost`、`danger`、`warning`、`success`，尺寸固定为 `sm`、`md`、`lg`。颜色必须来自 `src/index.css` 的 CSS 变量或主题语义类，UI 内部禁止十六进制、RGB、HSL 字面量。

调用方可通过 `className` 扩展布局，但不应复制组件的基础视觉样式。合并 class 使用 `cn()`，以便 Tailwind 冲突由 `tailwind-merge` 处理。

## 无障碍要求

- 每个表单控件必须有可访问名称，错误信息需要关联到控件。
- IconButton 必须提供描述操作目的的 `aria-label`。
- 不移除可见焦点样式；浮层关闭后焦点应恢复到触发元素。
- 状态不能只靠颜色传达；加载状态使用 `aria-busy`，Toast 使用 live region。

## 新增流程

1. 确认现有组件无法通过组合或变体满足需求。
2. 在 `src/components/ui/` 内实现 ref、原生属性和 `className` 透传。
3. 从 `src/components/ui/index.ts` 导出，不暴露内部实现路径。
4. 在 `/__ui` 展示主要状态，并在 Testing Library 中覆盖关键行为。
5. 执行 `npm run check:ui` 和 `npm run verify`。

`/__ui` 只在开发环境注册，生产构建不得包含展厅 chunk。
