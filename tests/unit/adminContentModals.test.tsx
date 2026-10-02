// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { apiGet, apiPatch, apiPost } from '../../src/lib/apiClient'
import AdminListPage from '../../src/pages/Admin/AdminListPage'
class JSDOMResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe(_target: Element, _options?: ResizeObserverOptions) {}

  unobserve(_target: Element) {}

  disconnect() {}
}

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/components/SmartImage', () => ({ SmartImage: () => null }))

const categories = [
  { id: 'music', name: '音乐', description: '分类描述', order: 1, requiresAdminEdit: false },
]

const RoutePage = () => {
  const { type } = useParams<{ type: 'sections' | 'wiki-categories' | 'announcements' }>()
  if (type !== 'sections' && type !== 'wiki-categories' && type !== 'announcements') return null
  return <AdminListPage key={type} type={type} />
}

const renderAdmin = (initialPath = '/admin/sections') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <DialogProvider>
          <nav>
            <Link to="/admin/sections">版块路由</Link>
            <Link to="/admin/wiki-categories">分类路由</Link>
            <Link to="/admin/announcements">公告路由</Link>
          </nav>
          <Routes>
            <Route path="/admin/:type" element={<RoutePage />} />
          </Routes>
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  )

globalThis.ResizeObserver = JSDOMResizeObserver
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/admin/wiki-categories') return { data: categories, total: 1 } as never
    return { data: [], total: 0 } as never
  })
  vi.mocked(apiPost).mockResolvedValue({} as never)
  vi.mocked(apiPatch).mockResolvedValue({} as never)
})

describe('后台内容列表表单弹窗', () => {
  it('三种新增入口分别打开对应表单，干净取消不写接口', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await user.click(await screen.findByRole('button', { name: '新增' }))
    let modal = await screen.findByRole('dialog', { name: '新增版块' })
    expect(within(modal).getByLabelText('名称')).toBeInTheDocument()
    expect(within(modal).getByLabelText('描述')).toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('link', { name: '分类路由' }))
    await user.click(await screen.findByRole('button', { name: '新增' }))
    modal = await screen.findByRole('dialog', { name: '新增百科分类' })
    expect(within(modal).getByLabelText('分类 ID')).toBeInTheDocument()
    expect(within(modal).getByLabelText('名称')).toBeInTheDocument()
    expect(within(modal).getByText('仅管理员编辑')).toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('link', { name: '公告路由' }))
    await user.click(await screen.findByRole('button', { name: '新增' }))
    modal = await screen.findByRole('dialog', { name: '新增公告' })
    expect(within(modal).getByLabelText('公告内容')).toBeInTheDocument()
    expect(within(modal).getByLabelText('跳转链接（可选）')).toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('dirty 关闭确认可取消或放弃，重开初始化为空白；提交失败保留输入，成功关闭并刷新列表', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: '新增' }))
    let modal = await screen.findByRole('dialog', { name: '新增版块' })
    const nameField = within(modal).getByLabelText('名称')
    await user.type(nameField, '新板块')
    await user.click(within(modal).getByRole('button', { name: '取消' }))

    const abandonPrompt = await screen.findByRole('alertdialog', { name: '放弃修改？' })
    await user.click(within(abandonPrompt).getByRole('button', { name: '取消' }))
    expect(await screen.findByRole('dialog', { name: '新增版块' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog', { name: '新增版块' })).getByLabelText('名称')
    ).toHaveValue('新板块')

    await user.click(
      within(screen.getByRole('dialog', { name: '新增版块' })).getByRole('button', { name: '取消' })
    )
    const secondPrompt = await screen.findByRole('alertdialog', { name: '放弃修改？' })
    await user.click(within(secondPrompt).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增版块' })).toBeNull())
    await user.click(await screen.findByRole('button', { name: '新增' }))
    modal = await screen.findByRole('dialog', { name: '新增版块' })
    expect(within(modal).getByLabelText('名称')).toHaveValue('')

    await user.type(within(modal).getByLabelText('名称'), '保留失败输入')
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('network failed'))
    await user.click(within(modal).getByRole('button', { name: '创建' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('dialog', { name: '新增版块' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog', { name: '新增版块' })).getByLabelText('名称')
    ).toHaveValue('保留失败输入')

    vi.mocked(apiPost).mockResolvedValueOnce({} as never)
    await user.click(
      within(screen.getByRole('dialog', { name: '新增版块' })).getByRole('button', { name: '创建' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增版块' })).toBeNull())
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it('分类编辑保存后反映新名称，失败时输入仍可修改', async () => {
    const user = userEvent.setup()
    let categoryName = '音乐'
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/admin/wiki-categories') {
        return {
          data: [{ ...categories[0], name: categoryName }],
          total: 1,
        } as never
      }
      return { data: [], total: 0 } as never
    })
    renderAdmin('/admin/wiki-categories')
    const row = (await screen.findByText('音乐')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: '编辑' }))
    let modal = await screen.findByRole('dialog', { name: '编辑百科分类' })
    const name = within(modal).getByLabelText('名称')
    await user.clear(name)
    await user.type(name, '新分类')
    vi.mocked(apiPatch).mockRejectedValueOnce(new Error('network failed'))
    await user.click(within(modal).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('dialog', { name: '编辑百科分类' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog', { name: '编辑百科分类' })).getByLabelText('名称')
    ).toHaveValue('新分类')

    vi.mocked(apiPatch).mockImplementationOnce(async (_path, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'name' in payload &&
        typeof payload.name === 'string'
      ) {
        categoryName = payload.name
      }
      return {} as never
    })
    await user.click(
      within(screen.getByRole('dialog', { name: '编辑百科分类' })).getByRole('button', {
        name: '保存',
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑百科分类' })).toBeNull())
    expect(await screen.findByText('新分类')).toBeInTheDocument()
    expect(apiPatch).toHaveBeenCalledWith(
      '/api/admin/wiki-categories/music',
      expect.objectContaining({ name: '新分类' })
    )
  })

  it('dirty 时路由切换先确认，确认后新 type 不继承旧草稿', async () => {
    const user = userEvent.setup()
    renderAdmin('/admin/wiki-categories')
    await user.click(await screen.findByRole('button', { name: '新增' }))
    let modal = await screen.findByRole('dialog', { name: '新增百科分类' })
    await user.type(within(modal).getByLabelText('分类 ID'), 'draft-id')
    fireEvent.click(document.querySelector<HTMLAnchorElement>('a[href="/admin/announcements"]')!)

    const prompt = await screen.findByRole('alertdialog', { name: '离开此页面？' })
    await user.click(within(prompt).getByRole('button', { name: '留在本页' }))
    expect(screen.getByRole('dialog', { name: '新增百科分类' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog', { name: '新增百科分类' })).getByLabelText('分类 ID')
    ).toHaveValue('draft-id')

    fireEvent.click(document.querySelector<HTMLAnchorElement>('a[href="/admin/announcements"]')!)
    const confirmPrompt = await screen.findByRole('alertdialog', { name: '离开此页面？' })
    await user.click(within(confirmPrompt).getByRole('button', { name: '离开' }))
    await screen.findByRole('heading', { name: '公告管理' })
    await user.click(screen.getByRole('button', { name: '新增' }))
    modal = await screen.findByRole('dialog', { name: '新增公告' })
    expect(within(modal).getByLabelText('公告内容')).toHaveValue('')
    expect(within(modal).queryByLabelText('分类 ID')).toBeNull()
  })
})
