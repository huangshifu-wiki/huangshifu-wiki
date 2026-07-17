import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const uiRoot = path.join(root, 'src/components/ui')
const sourceExtensions = new Set(['.ts', '.tsx'])

const walk = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(file) : sourceExtensions.has(path.extname(file)) ? [file] : []
  })

const failures: string[] = []
const sourceFiles = walk(sourceRoot)
const sourceCache = new Map<string, string>()
const readSource = (file: string) => {
  const cached = sourceCache.get(file)
  if (cached !== undefined) return cached

  const source = fs.readFileSync(file, 'utf8')
  sourceCache.set(file, source)
  return source
}
const report = (file: string, rule: string) => {
  failures.push(`${path.relative(root, file)}: ${rule}`)
}

for (const file of sourceFiles.filter((file) => file.startsWith(uiRoot + path.sep))) {
  const source = readSource(file)
  if (/from\s+['"][^'"]*(?:pages|context|services|server|apiClient)[^'"]*['"]/.test(source)) {
    report(file, 'UI 层不得依赖 pages、context、services、server 或 apiClient')
  }
  if (/(?:#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i.test(source)) {
    report(file, 'UI 组件不得硬编码颜色，请使用共享 token')
  }
}

for (const file of sourceFiles) {
  if (file.startsWith(uiRoot + path.sep)) continue
  const source = readSource(file)
  if (/from\s+['"][^'"]*(?:components\/ui\/|@\/src\/components\/ui\/)[^'"]*['"]/.test(source)) {
    report(file, '业务代码只能从 @/src/components/ui 公共入口导入')
  }
}

const migratedFiles = [
  'src/components/AccountMenu.tsx',
  'src/components/AnnouncementBar.tsx',
  'src/components/AuthForm.tsx',
  'src/components/BackToTop.tsx',
  'src/components/BookEditor.tsx',
  'src/components/CommentActionMenu.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/components/Events/EventFilters.tsx',
  'src/components/IncrementalLoadFooter.tsx',
  'src/components/Navbar.tsx',
  'src/components/Navbar/AuthModal.tsx',
  'src/components/Navbar/MobileMenu.tsx',
  'src/components/Navbar/NotificationPanel.tsx',
  'src/components/Pagination.tsx',
  'src/components/ThemeToggle.tsx',
  'src/components/ViewModeSelector.tsx',
  'src/components/admin/AdminLayout.tsx',
  'src/components/search/SearchBox.tsx',
  'src/components/search/SearchFilters.tsx',
  'src/components/search/SearchResults.tsx',
  'src/components/wiki/WikiEditor.tsx',
  'src/components/wiki/WikiEditorMetaSidebar.tsx',
  'src/components/wiki/WikiEditorRelationPanel.tsx',
  'src/pages/EventDetail.tsx',
  'src/pages/Gallery.tsx',
  'src/pages/Notifications.tsx',
  'src/pages/Setup.tsx',
  'src/pages/ResetPassword.tsx',
  'src/pages/Settings.tsx',
  'src/pages/VerifyEmail.tsx',
  'src/pages/Admin/AdminDashboard.tsx',
  'src/pages/Admin/AdminLocks.tsx',
  'src/pages/Admin/AdminLogs.tsx',
  'src/pages/Admin/AdminReviewContentPreview.tsx',
  'src/pages/Admin/AdminReviews.tsx',
  'src/pages/Admin/AdminToolPage.tsx',
  'src/pages/wiki/WikiPullRequestList.tsx',
  'src/pages/wiki/WikiPullRequestDetail.tsx',
  'src/pages/home/DefaultHome.tsx',
]

for (const relativeFile of migratedFiles) {
  const file = path.join(root, relativeFile)
  const source = readSource(file)
  const match = source.match(/<(?:button|input|select|textarea)\b/)
  if (match) report(file, `已迁移区域不得使用原生 ${match[0].slice(1)} 控件`)
}

if (failures.length > 0) {
  console.error(
    `UI 规范检查失败（${failures.length} 项）：\n${failures.map((item) => `- ${item}`).join('\n')}`
  )
  process.exit(1)
}

console.log('UI 规范检查通过')
