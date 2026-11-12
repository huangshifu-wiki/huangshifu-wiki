// @vitest-environment jsdom
import React, { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
} from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { RouteRetentionProvider } from '../../src/context/RouteRetentionContext'
import { useRouteActive } from '../../src/lib/routeActivity'
import { RetainedRoutes } from '../../src/components/RetainedRoutes'
import { useIncrementalListLoader } from '../../src/hooks/useIncrementalListLoader'
import { RouteScrollBoundary } from '../../src/components/RouteScrollBoundary'
import { Dialog, DialogContent, Input, Button } from '../../src/components/ui'
import { useSeo } from '../../src/lib/seo'
import { useRoutedPagination } from '../../src/hooks/useRoutedPagination'
import { deferred } from '../setup/deferred'

let go: NavigateFunction
let actualLocation: Location
function Navigation() {
  go = useNavigate()
  actualLocation = useLocation()
  return (
    <output data-testid="url">
      {useLocation().pathname}
      {useLocation().search}
    </output>
  )
}
function List() {
  const [value, setValue] = useState('初始')
  const [expanded, setExpanded] = useState(false)
  const list = useIncrementalListLoader<string>({
    enabled: true,
    pageSize: 1,
    resetKey: 'list',
    fetchPage: async (page) => ({ items: [`第${page}批`], total: 2 }),
    getItemKey: (item) => item,
  })
  return (
    <div className="mobile-page-container">
      <input aria-label="字段" value={value} onChange={(event) => setValue(event.target.value)} />
      <button onClick={() => setExpanded(!expanded)}>展开</button>
      {expanded && <p>展开内容</p>}
      {list.items.map((item) => (
        <p key={item}>{item}</p>
      ))}
      {list.loadingInitial && <p>首屏加载</p>}
      <button onClick={list.loadMore}>更多</button>
    </div>
  )
}
function Fixture({
  scopeKey = 'user',
  page = <List />,
}: {
  scopeKey?: string
  page?: React.ReactNode
}) {
  return (
    <RouteRetentionProvider scopeKey={scopeKey}>
      <RouteScrollBoundary>
        <Navigation />
        <RetainedRoutes scope="public">
          <Route path="/*" element={page} />
        </RetainedRoutes>
        <div data-route-shell="admin" data-route-active="true">
          <div data-admin-scroll-container>
            <RetainedRoutes scope="admin">
              <Route path="/admin/*" element={page} />
            </RetainedRoutes>
          </div>
        </div>
      </RouteScrollBoundary>
    </RouteRetentionProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
it.each(['/list', '/admin/list'])('保留 %s 的字段、增量列表和 DOM', async (path) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Fixture />
    </MemoryRouter>
  )
  await screen.findByText('第1批')
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '保留字段' } })
  fireEvent.click(screen.getByText('展开'))
  fireEvent.click(screen.getByText('更多'))
  await screen.findByText('第2批')
  input.focus()
  await act(() => go(`${path}/detail`))
  await act(() => go(-1))
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveValue('保留字段')
  expect(document.activeElement).toBe(input)
  const active = within(
    document.querySelector('[data-route-active="true"][data-retained-page]')! as HTMLElement
  )
  expect(active.getByText('第2批')).toBeVisible()
  expect(active.getByText('展开内容')).toBeVisible()
  expect(active.queryByText('首屏加载')).not.toBeInTheDocument()
})
it.each(['/list', '/admin/list'])(
  '保持 %s 的独立历史字段、查询条目和共享 LRU',
  async (listPath) => {
    render(
      <MemoryRouter initialEntries={[listPath]}>
        <Fixture />
      </MemoryRouter>
    )
    await screen.findByText('第1批')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '最早' } })
    await act(() => go('/login'))
    await act(() => go(-1))
    expect(screen.getByRole('textbox')).toHaveValue('最早')
    await act(() => go(`${listPath}?q=2`))
    await act(() => go(`${listPath}?q=canonical`, { replace: true }))
    expect(screen.getByTestId('url')).toHaveTextContent(`${listPath}?q=canonical`)
    expect(screen.getByRole('textbox')).toHaveValue('最早')
    await act(() => go('/detail/a'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '详情A' } })
    await act(() => go('/detail/b'))
    await act(() => go(-1))
    expect(screen.getByRole('textbox')).toHaveValue('详情A')
    await act(() => go('/branch'))
    await act(() => go(1))
    expect(screen.getByTestId('url')).toHaveTextContent('/branch')
    await act(() => go(listPath))
    expect(screen.getByRole('textbox')).toHaveValue('初始')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '独立列表' } })
    await act(() => go(-1))
    await act(() => go(1))
    expect(screen.getByRole('textbox')).toHaveValue('独立列表')
    for (let index = 0; index < 10; index++) {
      await act(() => go(`${index % 2 ? '' : '/admin'}/page/${index}`))
    }
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '最近' } })
    await act(() => go(-1))
    await act(() => go(1))
    expect(screen.getByRole('textbox')).toHaveValue('最近')
    await act(() => go(-100))
    expect(screen.getByRole('textbox')).toHaveValue('初始')
  }
)

it('按历史条目恢复后台坐标，旧入场节点保留而新节点不被标记', async () => {
  const app = render(
    <MemoryRouter initialEntries={['/admin/list']}>
      <Fixture />
    </MemoryRouter>
  )
  await screen.findByText('第1批')
  const container = document.querySelector<HTMLElement>('[data-admin-scroll-container]')!
  const original = screen.getByRole('textbox').closest('.mobile-page-container')!
  container.scrollTop = 420
  await act(() => go('/admin/detail'))
  expect(container.scrollTop).toBe(0)
  container.scrollTop = 75
  await act(() => go(-1))
  expect(container.scrollTop).toBe(420)
  expect(original).toHaveAttribute('data-route-entered')
  fireEvent.click(screen.getByRole('button', { name: '更多' }))
  const added = await within(original as HTMLElement).findByText('第2批')
  expect(added).not.toHaveAttribute('data-route-entered')
  await act(() => go('/admin/list?q=2'))
  container.scrollTop = 900
  await act(() => go(-1))
  expect(container.scrollTop).toBe(420)
  await act(() => go(1))
  expect(container.scrollTop).toBe(900)
  await act(() => go('/admin/detail'))
  await act(() => go('/admin/list'))
  expect(container.scrollTop).toBe(0)
  container.scrollTop = 180
  const background = actualLocation
  await act(() => go('/admin/events/new', { state: { editorBackground: background } }))
  expect(container.scrollTop).toBe(180)
  await act(() => go(-1))
  expect(container.scrollTop).toBe(180)
  await act(() => go(-2))
  expect(container.scrollTop).toBe(900)
  await act(() => go(2))
  expect(container.scrollTop).toBe(180)
  const reloadLocation = actualLocation
  window.dispatchEvent(new Event('pagehide'))
  app.unmount()
  vi.stubGlobal('ResizeObserver', undefined)
  const module = deferred<{ default: React.ComponentType }>()
  const ColdPage = React.lazy(() => module.promise)
  render(
    <MemoryRouter initialEntries={[reloadLocation]}>
      <Fixture page={<ColdPage />} />
    </MemoryRouter>
  )
  const coldContainer = document.querySelector<HTMLElement>('[data-admin-scroll-container]')!
  expect(coldContainer.scrollTop).toBe(0)
  await act(async () => {
    module.resolve({ default: List })
    await module.promise
  })
  expect(coldContainer.scrollTop).toBe(180)
})

function SideEffectPage({ pending }: { pending: Promise<string> }) {
  const active = useRouteActive()
  const [data, setData] = useState('')
  const [count, setCount] = useState(0)
  const [draft, setDraft] = useState('草稿')
  const [open, setOpen] = useState(true)
  useSeo({
    title: `A:${data || '加载'}`,
    description: 'A',
    canonicalPath: '/a',
    robots: 'index,follow',
    ogType: 'website',
  })
  useRoutedPagination({ totalCount: data ? 1 : undefined, totalKnown: Boolean(data) })
  useEffect(() => {
    void pending.then(setData)
  }, [pending])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setCount((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return (
    <>
      <p>数据:{data || '加载中'}</p>
      <output data-testid="periodic">{count}</output>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="保留草稿弹窗" description="测试页面保留">
          <Input
            aria-label="浮层字段"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
function OtherPage() {
  const [clicked, setClicked] = useState(false)
  useSeo({
    title: 'B',
    description: 'B',
    canonicalPath: '/b',
    robots: 'index,follow',
    ogType: 'website',
  })
  return <Button onClick={() => setClicked(true)}>{clicked ? 'B已操作' : '操作B'}</Button>
}
it('隐藏页保留延迟结果，但不改写 SEO、URL、Portal 或继续周期工作', async () => {
  vi.useFakeTimers()
  const { promise: pending, resolve } = deferred<string>()
  render(
    <MemoryRouter initialEntries={['/a?page=2']}>
      <RouteRetentionProvider scopeKey="user">
        <Navigation />
        <RetainedRoutes scope="public">
          <Route path="/a" element={<SideEffectPage pending={pending} />} />
          <Route path="/b" element={<OtherPage />} />
        </RetainedRoutes>
      </RouteRetentionProvider>
    </MemoryRouter>
  )
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '原草稿' } })
  await act(() => go('/b'))
  await act(async () => {
    resolve('完成')
    await pending
    vi.advanceTimersByTime(3000)
  })
  expect(document.title).toBe('B')
  expect(screen.getByTestId('url')).toHaveTextContent('/b')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.body).not.toHaveAttribute('data-scroll-locked')
  expect(document.body.style.pointerEvents).not.toBe('none')
  fireEvent.click(screen.getByRole('button', { name: '操作B' }))
  expect(screen.getByRole('button', { name: 'B已操作' })).toBeVisible()
  await act(() => go(-1))
  expect(screen.getByRole('textbox')).toHaveValue('原草稿')
  expect(screen.getByText('数据:完成')).toBeVisible()
  expect(screen.getByTestId('periodic')).toHaveTextContent('0')
  await act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByTestId('periodic')).toHaveTextContent('1')
  expect(document.title).toBe('A:完成')
})

let savedContent = '保存前'
function SavedPage() {
  const [content] = useState(savedContent)
  const [draft, setDraft] = useState('原字段')
  return (
    <>
      <p>{content}</p>
      <Input
        aria-label="编辑来源字段"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  )
}
function EditorFixture({ scopeKey }: { scopeKey: string }) {
  return (
    <RouteRetentionProvider scopeKey={scopeKey}>
      <RouteScrollBoundary>
        <Navigation />
        <RetainedRoutes scope="public">
          <Route path="/gallery/:id" element={<SavedPage />} />
        </RetainedRoutes>
      </RouteScrollBoundary>
    </RouteRetentionProvider>
  )
}
it.each(['用户B:user:false', '用户A:user:false'])(
  '编辑取消、一次保存和身份切换到 %s 保持历史与权限边界',
  async (nextScope) => {
    savedContent = '保存前'
    const app = render(
      <MemoryRouter initialEntries={['/gallery/one']}>
        <EditorFixture scopeKey="用户A:admin:false" />
      </MemoryRouter>
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '来源草稿' } })
    const background = actualLocation
    await act(() => go('/gallery/one/edit', { state: { editorBackground: background } }))
    expect(screen.getByRole('textbox')).toBe(input)
    await act(() => go(-1))
    expect(screen.getByRole('textbox')).toBe(input)
    expect(input).toHaveValue('来源草稿')
    await act(() => go('/gallery/one/edit', { state: { editorBackground: background } }))
    savedContent = '已保存新内容'
    await act(() => go('/gallery/one', { replace: true, state: { editorSaved: true } }))
    expect(screen.getByText('已保存新内容')).toBeVisible()
    const savedInput = screen.getByRole('textbox')
    fireEvent.change(savedInput, { target: { value: '保存后草稿' } })
    savedContent = '之后的数据'
    await act(() => go(-1))
    expect(screen.getByRole('textbox')).toBe(savedInput)
    await act(() => go(1))
    expect(screen.getByRole('textbox')).toBe(savedInput)
    expect(savedInput).toHaveValue('保存后草稿')
    expect(screen.getByText('已保存新内容')).toBeVisible()
    app.rerender(
      <MemoryRouter initialEntries={['/gallery/one']}>
        <EditorFixture scopeKey={nextScope} />
      </MemoryRouter>
    )
    expect(savedInput).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('原字段')
    expect(screen.getByTestId('url')).toHaveTextContent('/gallery/one')
  }
)
