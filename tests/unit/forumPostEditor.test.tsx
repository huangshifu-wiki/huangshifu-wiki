// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet, apiPost } from '../../src/lib/apiClient'
import Forum from '../../src/pages/Forum'

const toastShow = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
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

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/forum/new']}>
      <Routes>
        <Route path="/forum/*" element={<Forum />} />
      </Routes>
    </MemoryRouter>
  )

describe('论坛保存草稿错误原因', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApiGet.mockResolvedValue({ sections: [{ id: 'section-1', name: '综合讨论' }] } as never)
  })

  it('显示 API 返回的保存原因而不是固定失败文案', async () => {
    mockedApiPost.mockRejectedValueOnce(new Error('版块不存在'))
    renderEditor()

    await screen.findByRole('button', { name: '保存草稿' })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('版块不存在', { variant: 'error' })
    })
  })

  it('未知异常使用保存草稿兜底文案', async () => {
    mockedApiPost.mockRejectedValueOnce(null)
    renderEditor()

    await screen.findByRole('button', { name: '保存草稿' })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('forum.saveDraftFailed', { variant: 'error' })
    })
  })
})
