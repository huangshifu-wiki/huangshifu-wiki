# 黄诗扶 Wiki UI 设计系统

## 公共入口

业务代码只从 `@/src/components/ui` 导入。禁止导入 `src/components/ui/` 下的内部文件；组件库不得读取业务 Context、调用 API 或依赖 `pages`、`services`、`server`。

## 组件选型

- 页面或领域卡片保留在对应业务目录；仅无业务语义的容器使用 `Panel`、`Badge`、`EmptyState`。
- 页面跳转使用 `LinkButton`，提交和操作使用 `Button`，纯图标操作使用带可读 `aria-label` 的 `IconButton`。
- 表单项使用 `Field` 包裹 Input、Textarea 或 Select，由 Field 统一生成 label、说明、错误与 `aria-describedby`。
- 需要焦点管理、键盘导航或 Portal 的交互优先组合 Dialog、AlertDialog、DropdownMenu、Popover、Tooltip、Tabs 等组件，不自行实现行为内核。

## 变体与 Token

Button 变体固定为 `primary`、`secondary`、`ghost`、`danger`、`warning`、`success`、`info`，尺寸固定为 `sm`、`md`、`lg`。`soft` 修饰符提供浅色底 + 语义文字色的轻量按钮（用于列表行内操作），对 `secondary`、`danger`、`warning`、`success`、`info` 生效，`primary` 与 `ghost` 下等同原样式。颜色必须来自 `src/index.css` 的 CSS 变量或主题语义类，UI 内部禁止十六进制、RGB、HSL 字面量。

调用方可通过 `className` 扩展布局，但不应复制组件的基础视觉样式。合并 class 使用 `cn()`，以便 Tailwind 冲突由 `tailwind-merge` 处理。

## 无障碍要求

- 每个表单控件必须有可访问名称，错误信息需要关联到控件。
- IconButton 必须提供描述操作目的的 `aria-label`。
- 不移除可见焦点样式；浮层关闭后焦点应恢复到触发元素。
- 状态不能只靠颜色传达；加载状态使用 `aria-busy`，Toast 使用 live region。

## 加载状态

- 页面代码分片或首屏数据请求使用布局匹配的 `PageSkeleton`；`default` 旋转圈只用于没有确定布局的全局 fallback。
- 已有内容刷新时保留旧内容，使用 `Spinner` 或 `aria-busy` 标记刷新，不用整页骨架覆盖已可读内容。
- 状态顺序固定为加载中、错误、成功空态/成功内容；请求未完成或失败时不得显示业务空态。
- 接口失败使用 `LoadErrorState`，错误信息使用 `role="alert"`，可重试请求必须提供“重新加载”操作。
- 操作按钮、上传进度和弹窗内部请求使用控件级 `Button.loading`/`Spinner`，不触发页面级加载状态。

## 响应式布局

- 页面默认从 320px 视口开始设计，再通过 `sm`、`md`、`lg` 增强布局。
- Grid 或 Flex 中承载动态内容的容器必须允许收缩；使用 `min-w-0`，需要占满时同时使用 `w-full max-w-full`。
- 用户可控或长度不确定的文本必须明确选择 `break-words`、`break-all`、`truncate` 或行数限制，不能依赖默认断行。
- 文本与固定控件同行时，文本容器使用 `min-w-0`，固定控件使用 `shrink-0`；操作组空间不足时必须换行或纵向排列。
- 横向滚动只能出现在标签栏、表格等明确的局部容器中，页面根节点不得产生横向滚动。
- 设置类页面使用 `SettingsSection`、`SettingRow` 和 `SegmentedControl` 组合。`SettingRow` 的 `stackOnMobile` 用于窄屏下需要独占一行的复杂控件。
- 新增或修改响应式页面时，至少人工检查 320px、360px、390px、768px 和桌面宽度。

## 新增流程

1. 确认现有组件无法通过组合或变体满足需求。
2. 在 `src/components/ui/` 内实现 ref、原生属性和 `className` 透传。
3. 从 `src/components/ui/index.ts` 导出，不暴露内部实现路径。
4. 在 `/__ui` 展示主要状态，并在 Testing Library 中覆盖关键行为。
5. 执行 `npm run check:ui` 和 `npm run verify`。

`/__ui` 只在开发环境注册，生产构建不得包含展厅 chunk。

## 按压反馈

真实的 `a[href]`、`button` 或带交互 role 的节点复用全局 `initPressFeedback`，通过 `data-press-feedback` 选择语义：

- `state`：整卡或大面积导航，反馈层覆盖真实导航节点的矩形。
- `ripple`：直接打开大图的封面按钮和小型动作按钮，涟漪从触点展开。
- `inline`：筛选 tab、标签和正文文字导航，只反馈当前文字行。

标记必须放在实际接收点击、键盘和触摸事件的节点上，不能放在仅负责布局、hover 或拖拽的 `article`/`div` 上。图片 hover 缩放、遮罩、阴影、标题变色和业务选中态不属于按压反馈，不用 `:active` 或局部 keyframe 重建。Lightbox 手势、关系图画布、上传 dropzone、编辑器输入面和拖拽排序面不添加标记；必要时使用 `data-press-feedback="none"` 明确退出。
直接打开 Lightbox 的封面按钮必须同时使用 `data-press-feedback="ripple"` 与 `press-feedback-cover`；后者只把 `--color-theme-accent` 作为 `currentColor` 提供给共享 ripple，不负责 hover、遮罩或布局。

封面图片的 hover 缩放与提示和按压 ripple 是独立状态；按压反馈不得依赖页面专属的整面色层，也不得在 Lightbox 内容、拖拽或手势区域添加反馈标记。
