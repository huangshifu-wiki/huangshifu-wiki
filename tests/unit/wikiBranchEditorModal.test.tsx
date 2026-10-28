// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogProvider } from '../../src/components/Dialog'
import { ToastProvider } from '../../src/components/Toast'
import { useAuth } from '../../src/context/AuthContext'
import { apiGet, apiPost } from '../../src/lib/apiClient'
import WikiBranchWorkspace from '../../src/pages/wiki/WikiBranchWorkspace'
import { resetUnsavedChangesGuardForTests } from '../../src/hooks/useUnsavedChangesGuard'

const workspaceState = vi.hoisted(() => ({
  hasBranch: true,
  branchStatus: 'draft',
  detailAvailable: true,
  detailGate: null as Promise<unknown> | null,
  latestRevision: null as unknown,
  revisions: [] as unknown[],
  openPr: null as unknown,
  revisionFailure: false,
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedApiPost = vi.mocked(apiPost)
const mockedUseAuth = vi.mocked(useAuth)

const pageFixture = {
  slug: 'test-wiki',
  title: '测试百科',
  category: 'history',
  eventDate: null,
  tags: ['页面标签'],
  content: '百科页面正文',
}

const makeBranch = () => ({
  id: 'branch-1',
  pageSlug: 'test-wiki',
  editorUid: 'user-1',
  editorName: '分支编辑者',
  status: workspaceState.branchStatus,
  latestRevisionId: 'revision-1',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  page: { slug: 'test-wiki', title: '测试百科', category: 'history' },
})

const makeRevision = (overrides: Record<string, unknown> = {}) => ({
  id: 'revision-1',
  pageSlug: 'test-wiki',
  branchId: 'branch-1',
  title: '服务器已保存标题',
  content: '服务器已保存正文',
  category: 'history',
  tags: ['服务器标签'],
  eventDate: '2025-03-04',
  editorUid: 'user-1',
  editorName: '分支编辑者',
  isAutoSave: false,
  createdAt: '2025-01-02T00:00:00.000Z',
  ...overrides,
})

const makeOpenPr = () => ({
  id: 'pr-1',
  branchId: 'branch-1',
  pageSlug: 'test-wiki',
  title: '正在审核的 PR',
  description: 'PR 说明',
  status: 'open',
  createdByUid: 'user-1',
  createdByName: '分支编辑者',
  reviewedBy: null,
  reviewedAt: null,
  mergedAt: null,
  baseRevisionId: null,
  conflictData: null,
  createdAt: '2025-01-03T00:00:00.000Z',
  updatedAt: '2025-01-03T00:00:00.000Z',
  branch: null,
  page: null,
  comments: [],
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const renderWorkspace = () => {
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={['/wiki/test-wiki/branches']}>
      <ToastProvider>
        <DialogProvider>
          <Routes>
            <Route path="/wiki/:slug/branches" element={<WikiBranchWorkspace />} />
          </Routes>
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  return { user, ...view }
}

const openEditor = async (user: UserEvent) => {
  const button = await screen.findByRole('button', { name: '编辑分支' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  return screen.getByRole('dialog')
}

beforeEach(() => {
  resetUnsavedChangesGuardForTests()
  vi.clearAllMocks()
  Object.assign(workspaceState, {
    hasBranch: true,
    branchStatus: 'draft',
    detailAvailable: true,
    detailGate: null,
    latestRevision: makeRevision(),
    revisions: [makeRevision()],
    openPr: null,
    revisionFailure: false,
  })
  mockedUseAuth.mockReturnValue({
    user: { uid: 'user-1', displayName: '分支编辑者' },
    isAdmin: false,
    isBanned: false,
  } as never)

  mockedApiGet.mockImplementation(async (path: string) => {
    if (path === '/api/wiki/test-wiki') return { page: pageFixture } as never
    if (path === '/api/wiki/test-wiki/branches') {
      return { branches: workspaceState.hasBranch ? [makeBranch()] : [] } as never
    }
    if (path === '/api/wiki/branches/branch-1') {
      if (workspaceState.detailGate) return workspaceState.detailGate as never
      if (!workspaceState.detailAvailable) throw new Error('分支详情不可用')
      return { branch: makeBranch(), latestRevision: workspaceState.latestRevision } as never
    }
    if (path === '/api/wiki/branches/branch-1/revisions') {
      return { revisions: workspaceState.revisions } as never
    }
    if (path === '/api/wiki/pull-requests/list') {
      return { pullRequests: workspaceState.openPr ? [workspaceState.openPr] : [] } as never
    }
    if (path === '/api/wiki/categories') {
      return {
        categories: [{ id: 'history', name: '历史', requiresAdminEdit: false }],
      } as never
    }
    if (path === '/api/wiki/tags') return { tags: [] } as never
    throw new Error(`unexpected apiGet path: ${path}`)
  })

  mockedApiPost.mockImplementation(async (path: string, payload?: unknown) => {
    if (path === '/api/wiki/test-wiki/branches') {
      workspaceState.hasBranch = true
      return { branch: makeBranch() } as never
    }
    if (path === '/api/wiki/branches/branch-1/revisions') {
      if (workspaceState.revisionFailure) throw new Error('保存分支版本失败')
      const revision = makeRevision({
        ...(payload as Record<string, unknown>),
        id: `revision-${(workspaceState.revisions as unknown[]).length + 1}`,
      })
      workspaceState.latestRevision = revision
      workspaceState.revisions = [revision, ...(workspaceState.revisions as unknown[])]
      return { revision } as never
    }
    if (path === '/api/wiki/branches/branch-1/pull-request') {
      workspaceState.openPr = makeOpenPr()
      return { pullRequest: workspaceState.openPr } as never
    }
    if (path === '/api/wiki/branches/branch-1/resolve-conflict') {
      workspaceState.branchStatus = 'draft'
      return { branch: makeBranch() } as never
    }
    throw new Error(`unexpected apiPost path: ${path}`)
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  resetUnsavedChangesGuardForTests()
})

describe('WikiBranchWorkspace branch editor modal', () => {
  it('保留工作区概要，编辑表单只在弹窗中出现；取消放弃后重开恢复服务器版本', async () => {
    const { user } = renderWorkspace()

    expect(await screen.findByRole('heading', { name: '协作分支：测试百科' })).toBeInTheDocument()
    expect(await screen.findByText('服务器已保存标题')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^标题/)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    let modal = await openEditor(user)
    let title = within(modal).getByLabelText(/^标题/)
    expect(title).toHaveValue('服务器已保存标题')
    const content = within(modal).getByLabelText(/^内容/)
    expect(content).toHaveValue('服务器已保存正文')

    await user.clear(title)
    await user.type(title, '本地未保存草稿')
    await user.click(within(modal).getByRole('button', { name: '取消' }))

    const discardDialog = screen.getByRole('alertdialog', { name: '放弃修改？' })
    expect(discardDialog).toHaveTextContent('当前修改尚未保存，关闭后将丢失这些更改。')
    await user.click(within(discardDialog).getByRole('button', { name: '取消' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByLabelText(/^标题/)).toHaveValue('本地未保存草稿')

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    const confirmDiscard = screen.getByRole('alertdialog', { name: '放弃修改？' })
    await user.click(within(confirmDiscard).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    modal = await openEditor(user)
    expect(within(modal).getByLabelText(/^标题/)).toHaveValue('服务器已保存标题')
    expect(within(modal).getByLabelText(/^内容/)).toHaveValue('服务器已保存正文')
  })

  it('保存版本请求带上实际修改，回填历史和字段后仍留在编辑弹窗', async () => {
    const { user } = renderWorkspace()
    const modal = await openEditor(user)
    const title = within(modal).getByLabelText(/^标题/)
    const content = within(modal).getByLabelText(/^内容/)
    await user.clear(title)
    await user.type(title, '保存后的标题')
    await user.clear(content)
    await user.type(content, '保存后的正文')

    await user.click(within(modal).getByRole('button', { name: '保存分支版本' }))

    await waitFor(() => {
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/wiki/branches/branch-1/revisions',
        expect.objectContaining({
          title: '保存后的标题',
          content: '保存后的正文',
          category: 'history',
        })
      )
    })
    expect(await within(screen.getByRole('dialog')).findByLabelText(/^标题/)).toHaveValue(
      '保存后的标题'
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' })).toBeEnabled()
    })
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('保存后的标题')).toBeInTheDocument()
  })

  it('提交失败时保留当前输入与弹窗', async () => {
    workspaceState.revisionFailure = true
    const { user } = renderWorkspace()
    const modal = await openEditor(user)
    const title = within(modal).getByLabelText(/^标题/)
    await user.clear(title)
    await user.type(title, '失败后仍要保留的输入')

    await user.click(within(modal).getByRole('button', { name: '保存分支版本' }))

    await screen.findByText('保存分支版本失败')
    expect(within(screen.getByRole('dialog')).getByLabelText(/^标题/)).toHaveValue(
      '失败后仍要保留的输入'
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('创建 PR 后只显示一个进行中的 PR 链接，且不再提供重复创建按钮', async () => {
    const { user } = renderWorkspace()
    const modal = await openEditor(user)
    await user.click(within(modal).getByRole('button', { name: '创建 PR' }))

    const refreshedModal = await screen.findByRole('dialog')
    expect(refreshedModal).toBeInTheDocument()
    await waitFor(() => {
      expect(within(refreshedModal).getByRole('button', { name: '取消' })).toBeEnabled()
    })
    await within(refreshedModal).findByText('当前已有一个进行中的 PR，请从工作区概要查看进度。')
    await user.click(within(refreshedModal).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.getByRole('link', { name: '查看 PR：正在审核的 PR' })).toHaveAttribute(
      'href',
      '/wiki/test-wiki/prs/pr-1'
    )
    expect(screen.getAllByRole('link', { name: /查看 PR：/ })).toHaveLength(1)
    const reopenedModal = await openEditor(user)
    expect(within(reopenedModal).queryByRole('link', { name: /查看 PR：/ })).not.toBeInTheDocument()
    expect(within(reopenedModal).queryByRole('button', { name: '创建 PR' })).not.toBeInTheDocument()
  })

  it('解决冲突后回填最新分支状态并保持弹窗打开', async () => {
    workspaceState.branchStatus = 'conflict'
    const { user } = renderWorkspace()
    const modal = await openEditor(user)

    await user.click(within(modal).getByRole('button', { name: '解决冲突并重开 PR' }))

    await waitFor(() => {
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/wiki/branches/branch-1/resolve-conflict',
        expect.objectContaining({ title: '服务器已保存标题', content: '服务器已保存正文' })
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(
        within(screen.getByRole('dialog')).queryByRole('button', {
          name: '解决冲突并重开 PR',
        })
      ).not.toBeInTheDocument()
    })
  })

  it('创建分支只在详情回填完成后打开编辑器', async () => {
    workspaceState.hasBranch = false
    workspaceState.revisions = []
    workspaceState.latestRevision = null
    const detail = deferred<unknown>()
    workspaceState.detailGate = detail.promise
    const { user } = renderWorkspace()

    const createButton = await screen.findByRole('button', { name: '创建我的分支' })
    await waitFor(() => expect(createButton).toBeEnabled())
    await user.click(createButton)
    expect(mockedApiPost).toHaveBeenCalledWith('/api/wiki/test-wiki/branches')
    await waitFor(() => {
      expect(mockedApiGet).toHaveBeenCalledWith('/api/wiki/branches/branch-1')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      detail.resolve({ branch: makeBranch(), latestRevision: makeRevision() })
      await detail.promise
    })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByLabelText(/^标题/)).toHaveValue(
      '服务器已保存标题'
    )
  })

  it('创建分支后详情失败时不自动打开空编辑器', async () => {
    workspaceState.hasBranch = false
    workspaceState.detailAvailable = false
    workspaceState.revisions = []
    workspaceState.latestRevision = null
    const { user } = renderWorkspace()

    const createButton = await screen.findByRole('button', { name: '创建我的分支' })
    await waitFor(() => expect(createButton).toBeEnabled())
    await user.click(createButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('分支详情不可用')
    expect(mockedApiPost).toHaveBeenCalledWith('/api/wiki/test-wiki/branches')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('刷新处理器不得在放弃确认前覆盖未保存分支', async () => {
    mockedUseAuth.mockReturnValue({
      user: { uid: 'user-1', displayName: '分支编辑者' },
      isAdmin: true,
      isBanned: false,
    } as never)
    const { user } = renderWorkspace()
    const modal = await openEditor(user)
    const title = within(modal).getByLabelText(/^标题/)
    await user.clear(title)
    await user.type(title, '正在修改')
    const apiCallsBeforeRefresh = mockedApiGet.mock.calls.length
    const refreshButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '刷新'
    )
    expect(refreshButton).toBeInTheDocument()

    fireEvent.click(refreshButton!)
    const discardDialog = screen.getByRole('alertdialog', { name: '放弃修改？' })
    await user.click(within(discardDialog).getByRole('button', { name: '取消' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByLabelText(/^标题/)).toHaveValue('正在修改')
    expect(mockedApiGet).toHaveBeenCalledTimes(apiCallsBeforeRefresh)

    fireEvent.click(refreshButton!)
    const confirmDiscard = screen.getByRole('alertdialog', { name: '放弃修改？' })
    await user.click(within(confirmDiscard).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(mockedApiGet.mock.calls.length).toBeGreaterThan(apiCallsBeforeRefresh)
    )
  })
})
