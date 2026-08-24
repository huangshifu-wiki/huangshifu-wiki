// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet, apiPost, apiPut } from '../../src/lib/apiClient'
import Forum from '../../src/pages/Forum'

const toastShow = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  invalidateApiCacheByPrefix: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', name: '测试用户' }, isBanned: false, isAdmin: false }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: { listLoadMode: 'pagination' },
    getScopedViewMode: () => 'list',
    setScopedViewMode: vi.fn(),
  }),
}))

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'forum.saveDraft': '保存草稿',
        'forum.saving': '保存中',
        'forum.publish': '发布帖子',
        'forum.submitReview': '提交审核',
      })[key] ?? key,
  }),
}))

vi.mock('../../src/components/Toast', () => ({ useToast: () => ({ show: toastShow }) }))
vi.mock('../../src/components/Dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../src/components/RouteGuard', () => ({
  RouteGuard: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/hooks/useTagSuggestions', () => ({
  useTagSuggestions: () => ({ suggestions: [] }),
}))
vi.mock('../../src/components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="正文" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('../../src/components/LocationTagInput', () => ({
  LocationTagInput: () => null,
}))
vi.mock('../../src/components/MentionTextarea', () => ({
  default: () => null,
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedApiPost = vi.mocked(apiPost)
const mockedApiPut = vi.mocked(apiPut)

const LocationProbe = () => {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/forum/new']}>
      <Routes>
        <Route
          path="/forum/*"
          element={
            <>
              <Forum />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )

describe('论坛帖子编辑器草稿保存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApiGet.mockResolvedValue({ sections: [{ id: 'section-1', name: '综合讨论' }] } as never)
  })

  const fillValidPost = () => {
    fireEvent.change(screen.getByPlaceholderText('forum.titlePlaceholder'), {
      target: { value: '测试标题' },
    })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'section-1' } })
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '测试正文' } })
  }

  it('显示 API 返回的保存原因而不是固定失败文案', async () => {
    mockedApiPost.mockRejectedValueOnce(new Error('版块不存在'))
    renderEditor()

    await screen.findByRole('button', { name: '保存草稿' })
    fillValidPost()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('版块不存在', { variant: 'error' })
    })
  })

  it('空标题时在请求前显示字段原因', async () => {
    renderEditor()

    await screen.findByRole('button', { name: '保存草稿' })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('标题不能为空', { variant: 'error' })
      expect(mockedApiPost).not.toHaveBeenCalled()
    })
  })

  it('未知异常使用保存草稿兜底文案', async () => {
    mockedApiPost.mockRejectedValueOnce(null)
    renderEditor()

    await screen.findByRole('button', { name: '保存草稿' })
    fillValidPost()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('forum.saveDraftFailed', { variant: 'error' })
    })
  })

  it('第一次保存后进入编辑路由，后续保存更新原草稿', async () => {
    mockedApiGet.mockImplementation((path: string) => {
      if (path === '/api/sections') {
        return Promise.resolve({
          sections: [{ id: 'section-1', name: '综合讨论' }],
        }) as never
      }
      if (path === '/api/posts/101') {
        return Promise.resolve({
          post: {
            id: 'post-1',
            slug: '101',
            title: '已保存草稿',
            section: 'section-1',
            content: '已保存内容',
            tags: [],
            locationCode: null,
            locationDetail: null,
            authorUid: 'user-1',
          },
        }) as never
      }
      return Promise.reject(new Error(`unexpected path: ${path}`)) as never
    })
    mockedApiPost.mockResolvedValueOnce({
      post: {
        id: 'post-1',
        slug: '101',
        title: '新建草稿',
        section: 'section-1',
        content: '草稿内容',
        tags: [],
        locationCode: null,
        locationDetail: null,
        authorUid: 'user-1',
        status: 'draft',
      },
    } as never)
    mockedApiPut.mockResolvedValueOnce({
      post: {
        id: 'post-1',
        slug: '101',
        title: '更新后的草稿',
        section: 'section-1',
        content: '更新后的内容',
        tags: [],
        locationCode: null,
        locationDetail: null,
        authorUid: 'user-1',
        status: 'draft',
      },
    } as never)

    renderEditor()
    await screen.findByRole('option', { name: '综合讨论' })
    fireEvent.change(screen.getByPlaceholderText('forum.titlePlaceholder'), {
      target: { value: '新建草稿' },
    })
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '草稿内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/forum/101/edit'))
    expect(mockedApiPost).toHaveBeenCalledTimes(1)
    expect(mockedApiPut).not.toHaveBeenCalled()

    await screen.findByDisplayValue('已保存草稿')
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(mockedApiPut).toHaveBeenCalledTimes(1))
    expect(mockedApiPut).toHaveBeenCalledWith(
      '/api/posts/post-1',
      expect.objectContaining({ status: 'draft' })
    )
    expect(mockedApiPost).toHaveBeenCalledTimes(1)
  })
})
