import { useState } from 'react'
import { MoreVertical, Settings, Trash2 } from '@/src/components/icons'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Select,
  Separator,
  SettingRow,
  SettingsSection,
  Skeleton,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@/src/components/ui'

const variants = ['primary', 'secondary', 'ghost', 'danger', 'warning', 'success'] as const

const UiShowcase = () => {
  const [dark, setDark] = useState(false)
  const [loadMode, setLoadMode] = useState('pagination')
  const { show } = useToast()

  return (
    <div data-theme={dark ? 'dark' : 'default'} className="mobile-page-shell min-h-screen">
      <main className="mobile-page-container space-y-10 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--book-ink-line)] pb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-gold">Internal UI</p>
            <h1 className="mobile-page-title mt-2">黄诗扶 Wiki 组件展厅</h1>
            <p className="mt-2 text-sm text-text-muted">
              仅开发环境注册，使用页面右侧开关核对主题。
            </p>
          </div>
          <Switch label="深色主题" checked={dark} onCheckedChange={setDark} />
        </header>

        <ShowcaseSection title="操作">
          <div className="flex flex-wrap gap-3">
            {variants.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">小按钮</Button>
            <Button size="md" loading loadingText="正在保存">
              保存
            </Button>
            <Button size="lg" disabled>
              禁用按钮
            </Button>
            <IconButton variant="secondary" aria-label="设置">
              <Settings className="h-4 w-4" />
            </IconButton>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="表单">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="条目标题" description="用于 Wiki 列表与搜索结果。" required>
              <Input placeholder="输入标题" />
            </Field>
            <Field label="别名" error="该别名已被占用">
              <Input defaultValue="旧时光" />
            </Field>
            <Field label="分类">
              <Select defaultValue="music">
                <option value="music">音乐</option>
                <option value="event">事件</option>
              </Select>
            </Field>
            <Field label="简介">
              <Textarea placeholder="输入简介" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Checkbox label="允许评论" defaultChecked />
            <Switch label="公开展示" defaultChecked />
            <RadioGroup defaultValue="all" className="flex gap-4" aria-label="可见范围">
              <RadioGroupItem value="all" label="所有人" />
              <RadioGroupItem value="member" label="成员" />
            </RadioGroup>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="展示与状态">
          <div className="flex flex-wrap gap-2">
            <Badge>默认</Badge>
            <Badge variant="primary">主题</Badge>
            <Badge variant="success">正常</Badge>
            <Badge variant="warning">注意</Badge>
            <Badge variant="danger">错误</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel>无业务语义的纸面容器</Panel>
            <Panel className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-12" />
            </Panel>
            <Panel className="flex items-center justify-center">
              <Spinner />
            </Panel>
          </div>
          <EmptyState title="暂无修订" description="完成第一次编辑后，修订记录会出现在这里。" />
        </ShowcaseSection>

        <ShowcaseSection title="响应式设置布局">
          <div className="min-w-0 max-w-3xl">
            <SettingsSection title="阅读偏好" icon={<Settings className="h-4 w-4" />}>
              <SettingRow
                label="列表加载方式"
                description="窄屏时说明和操作区自动纵向排列，不会撑宽页面。"
                stackOnMobile
                control={
                  <SegmentedControl
                    value={loadMode}
                    options={[
                      { value: 'pagination', label: '分页模式' },
                      { value: 'incremental', label: '分段加载' },
                    ]}
                    onValueChange={setLoadMode}
                    aria-label="示例列表加载方式"
                  />
                }
              />
              <SettingRow
                label="包含连续超长内容的设置项ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
                labelFor="show-sequence-example"
                control={<Switch id="show-sequence-example" />}
              />
            </SettingsSection>
          </div>
        </ShowcaseSection>

        <ShowcaseSection title="浮层与导航">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">打开弹窗</Button>
              </DialogTrigger>
              <DialogContent title="编辑条目" description="焦点、Escape 和恢复行为由 Radix 管理。">
                <div className="space-y-4 p-5">
                  <Field label="标题">
                    <Input autoFocus />
                  </Field>
                  <Button>保存</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>适合少量辅助操作和说明，不承载复杂表单。</PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="secondary" aria-label="更多操作">
                  <MoreVertical className="h-4 w-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>编辑资料</DropdownMenuItem>
                <DropdownMenuItem danger>
                  <Trash2 className="h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost">悬停或聚焦</Button>
                </TooltipTrigger>
                <TooltipContent>键盘用户同样可见</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button onClick={() => show('组件展厅通知', { duration: 3000 })}>Toast</Button>
          </div>
          <Tabs defaultValue="one">
            <TabsList aria-label="示例标签页">
              <TabsTrigger value="one">条目</TabsTrigger>
              <TabsTrigger value="two">修订</TabsTrigger>
            </TabsList>
            <TabsContent value="one">条目内容</TabsContent>
            <TabsContent value="two">修订内容</TabsContent>
          </Tabs>
        </ShowcaseSection>

        <ShowcaseSection title="数据表格">
          <Panel className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>山鬼</TableCell>
                  <TableCell>
                    <Badge variant="success">已发布</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Panel>
        </ShowcaseSection>
      </main>
    </div>
  )
}

const ShowcaseSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-5">
    <div className="flex items-center gap-4">
      <h2 className="font-[var(--book-title-font)] text-2xl tracking-[0.08em] text-text-primary">
        {title}
      </h2>
      <Separator className="flex-1" />
    </div>
    {children}
  </section>
)

export default UiShowcase
