// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from '../../src/pages/Settings'
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../../src/lib/contentLimits'
import { PASSWORD_MAX_LENGTH } from '../../src/lib/passwordRules'

const {
  mockApiGet,
  mockApiPatch,
  mockApiPost,
  mockApiPut,
  mockRefreshAuth,
  mockSetTheme,
  mockUpdatePreferences,
  mockShow,
  mockAuthRole,
  mockAuthEmail,
  mockAuthEmailVerified,
} = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPatch: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
  mockRefreshAuth: vi.fn(),
  mockSetTheme: vi.fn(),
  mockUpdatePreferences: vi.fn(),
  mockShow: vi.fn(),
  mockAuthRole: vi.fn(() => 'user'),
  mockAuthEmail: vi.fn(() => 'old@example.com'),
  mockAuthEmailVerified: vi.fn(() => false),
}))

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      publicId: '1',
      email: mockAuthEmail(),
      displayName: '测试用户',
      photoURL: '',
      role: mockAuthRole(),
      emailVerified: mockAuthEmailVerified(),
    },
    profile: {
      displayName: '测试用户',
      signature: '旧签名',
      bio: '旧简介',
      photoURL: '',
      level: 1,
      role: mockAuthRole(),
      status: 'active',
    },
    refreshAuth: mockRefreshAuth,
  }),
}))

vi.mock('../../src/context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    preferences: {
      theme: 'system',
      listLoadMode: 'pagination',
      showCharacterCount: false,
      publicFavorites: false,
      publicHistory: false,
    },
    updatePreferences: mockUpdatePreferences,
    setTheme: mockSetTheme,
    resolvedTheme: 'default',
    loading: false,
  }),
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

vi.mock('../../src/components/AvatarCropModal', () => ({
  AvatarCropModal: () => null,
}))

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthRole.mockReturnValue('user')
    mockAuthEmail.mockReturnValue('old@example.com')
    mockAuthEmailVerified.mockReturnValue(false)
    mockApiGet.mockResolvedValue({ posts: [], pages: [], galleries: [], comments: [] })
    mockApiPatch.mockResolvedValue({})
    mockApiPost.mockResolvedValue({})
    mockApiPut.mockResolvedValue({})
    mockRefreshAuth.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  const renderSettings = (initialPath = '/settings/profile') => {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/settings/:section?" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('saves public profile updates', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/profile')

    const displayNameInput = await screen.findByLabelText('昵称')
    expect(displayNameInput).toHaveAttribute('maxlength', String(PROFILE_DISPLAY_NAME_MAX_LENGTH))
    expect(
      screen.queryByText(`4 / ${PROFILE_DISPLAY_NAME_MAX_LENGTH} 字符`)
    ).not.toBeInTheDocument()
    await user.clear(displayNameInput)
    await user.type(displayNameInput, '新昵称')

    const bioInput = screen.getByLabelText('个人简介（支持 Markdown）')
    expect(bioInput).toHaveAttribute('maxlength', String(WIKI_MAX_CONTENT_SIZE))
    expect(screen.queryByText(`3 / ${WIKI_MAX_CONTENT_SIZE} 字符`)).not.toBeInTheDocument()
    await user.clear(bioInput)
    await user.type(bioInput, '新简介')

    const signatureInput = screen.getByLabelText('签名')
    expect(signatureInput).toHaveAttribute('maxlength', String(PROFILE_SIGNATURE_MAX_LENGTH))
    expect(screen.queryByText(`3 / ${PROFILE_SIGNATURE_MAX_LENGTH} 字符`)).not.toBeInTheDocument()
    await user.clear(signatureInput)
    await user.type(signatureInput, '新签名')

    expect(
      screen.queryByText(`3 / ${PROFILE_DISPLAY_NAME_MAX_LENGTH} 字符`)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(`3 / ${WIKI_MAX_CONTENT_SIZE} 字符`)).not.toBeInTheDocument()
    expect(screen.queryByText(`3 / ${PROFILE_SIGNATURE_MAX_LENGTH} 字符`)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /保存公开资料/ }))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/users/me', {
        displayName: '新昵称',
        signature: '新签名',
        bio: '新简介',
        photoURL: '',
      })
    })
    expect(mockRefreshAuth).toHaveBeenCalled()
    expect(mockShow).toHaveBeenCalledWith('公开资料已保存')
  })

  it('submits email and password changes', async () => {
    renderSettings('/settings/account')

    expect(screen.getByText('old@example.com')).toBeInTheDocument()
    expect(screen.queryByLabelText('新邮箱')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /修改邮箱/ }))

    fireEvent.change(await screen.findByLabelText('新邮箱'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.change(screen.getAllByLabelText('当前密码')[0], {
      target: { value: 'CurrentPassword123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保存邮箱/ }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/email', {
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPassword123!',
      })
    })
    expect(mockShow).toHaveBeenCalledWith('邮箱已更新，可按需发送验证邮件', { duration: 4000 })

    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /修改密码/ }))
    expect(screen.queryAllByText(`0 / ${PASSWORD_MAX_LENGTH} 字符`)).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('当前密码'), {
      target: { value: 'CurrentPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'UpdatedPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'UpdatedPassword123!' },
    })
    expect(screen.queryAllByText(`19 / ${PASSWORD_MAX_LENGTH} 字符`)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /保存密码/ }))

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/users/password', {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'UpdatedPassword123!',
      })
    })
  })

  it('does not offer email verification for wechat placeholder emails', async () => {
    mockAuthEmail.mockReturnValue('mock-openid@wechat.local')
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/config/email-verification') {
        return { enabled: true }
      }

      return { posts: [], pages: [], galleries: [], comments: [] }
    })

    renderSettings('/settings/account')

    expect(await screen.findByText('mock-openid@wechat.local')).toBeInTheDocument()
    expect(await screen.findByText('请先修改为真实邮箱后再验证')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /发送验证邮件/ })).not.toBeInTheDocument()
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('shows a chinese validation message when current password is empty', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/account')

    await user.click(screen.getByRole('button', { name: /修改邮箱/ }))
    await user.click(screen.getByRole('button', { name: /保存邮箱/ }))
    expect(mockShow).toHaveBeenCalledWith('当前密码不能为空', { variant: 'error' })

    await user.click(screen.getByRole('button', { name: /修改密码/ }))
    await user.click(screen.getByRole('button', { name: /保存密码/ }))
    expect(mockShow).toHaveBeenCalledWith('当前密码不能为空', { variant: 'error' })
  })

  it('shows a chinese validation message when new email is empty', async () => {
    const user = userEvent.setup()
    renderSettings('/settings/account')

    await user.click(screen.getByRole('button', { name: /修改邮箱/ }))
    fireEvent.change(await screen.findByLabelText('当前密码'), {
      target: { value: 'CurrentPassword123!' },
    })
    await user.click(screen.getByRole('button', { name: /保存邮箱/ }))

    expect(mockShow).toHaveBeenCalledWith('新邮箱不能为空', { variant: 'error' })
  })

  it('shows theme controls in appearance section', async () => {
    renderSettings('/settings/appearance')

    expect(screen.getByRole('button', { name: '浅色模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '深色模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跟随系统（当前浅色）' })).toBeInTheDocument()
  })

  it('can enable character count display from appearance section', async () => {
    renderSettings('/settings/appearance')

    const toggle = screen.getByRole('switch', { name: '展示字数限制' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)

    expect(mockUpdatePreferences).toHaveBeenCalledWith({ showCharacterCount: true })
  })

  it('can switch list load mode from appearance section', async () => {
    renderSettings('/settings/appearance')

    await userEvent.click(screen.getByRole('button', { name: '分段加载' }))

    expect(mockUpdatePreferences).toHaveBeenCalledWith({ listLoadMode: 'incremental' })
  })

  it('renders section navigation as routes', () => {
    renderSettings('/settings/profile')

    expect(screen.getByRole('link', { name: '公开资料' })).toHaveAttribute(
      'href',
      '/settings/profile'
    )
    expect(screen.getByRole('link', { name: '内容管理' })).toHaveAttribute(
      'href',
      '/settings/content'
    )
    expect(screen.getByRole('link', { name: '隐私设置' })).toHaveAttribute(
      'href',
      '/settings/privacy'
    )
    expect(screen.getByRole('link', { name: '账户' })).toHaveAttribute('href', '/settings/account')
    expect(screen.getByRole('link', { name: '外观' })).toHaveAttribute(
      'href',
      '/settings/appearance'
    )
  })

  it('can update privacy settings', async () => {
    renderSettings('/settings/privacy')

    const favoritesToggle = screen.getByRole('switch', { name: '公开我的收藏' })
    expect(favoritesToggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(favoritesToggle)

    expect(mockUpdatePreferences).toHaveBeenCalledWith({ publicFavorites: true })
  })

  it('loads content management comments tab', async () => {
    mockApiGet.mockResolvedValue({
      comments: [
        {
          id: 'comment-1',
          postId: null,
          galleryId: 'gallery-1',
          authorUid: 'user-1',
          authorName: '测试用户',
          authorPhoto: null,
          content: '图集评论',
          parentId: null,
          isDeleted: false,
          createdAt: '2026-05-25T10:00:00.000Z',
          targetType: 'gallery',
          target: { id: 'gallery-1', title: '图集标题', published: true },
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=comments')

    expect(await screen.findByText('图集评论')).toBeInTheDocument()
    const targetLink = screen.getByRole('link', { name: '图集标题' })
    expect(targetLink).toHaveAttribute('href', '/gallery/gallery-1')
    expect(targetLink).toHaveAttribute('target', '_blank')
    expect(targetLink).toHaveAttribute('rel', 'noopener noreferrer')
    const commentLink = screen.getByRole('link', { name: '查看评论：图集评论' })
    expect(commentLink).toHaveAttribute('href', '/gallery/gallery-1#comment-comment-1')
    expect(commentLink).toHaveAttribute('target', '_blank')
    expect(commentLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(mockApiGet).toHaveBeenCalledWith('/api/users/1/comments', { limit: 50 })
  })

  it('loads content management wiki tab', async () => {
    mockApiGet.mockResolvedValue({
      pages: [
        {
          id: 'wiki-1',
          slug: 'test-wiki',
          title: '测试百科条目',
          category: '人物',
          content: '',
          tags: [],
          status: 'pending',
          reviewNote: null,
          favoritesCount: 0,
          likesCount: 0,
          dislikesCount: 0,
          lastEditorUid: 'user-1',
          lastEditorName: '测试用户',
          editedAt: '2026-05-26T10:00:00.000Z',
          createdAt: '2026-05-25T10:00:00.000Z',
          updatedAt: '2026-05-26T10:00:00.000Z',
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=wiki')

    const wikiLink = await screen.findByRole('link', { name: /测试百科条目/ })
    expect(wikiLink).toHaveAttribute('href', '/wiki/test-wiki')
    expect(wikiLink).toHaveAttribute('target', '_blank')
    expect(wikiLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('人物')).toBeInTheDocument()
    expect(screen.getByText('待审核')).toBeInTheDocument()
    expect(mockApiGet).toHaveBeenCalledWith('/api/users/1/wiki', { limit: 50 })
  })

  it('labels replies separately in content management comments tab', async () => {
    mockApiGet.mockResolvedValue({
      comments: [
        {
          id: 'reply-1',
          postId: 'post-1',
          galleryId: null,
          authorUid: 'user-1',
          authorName: '测试用户',
          authorPhoto: null,
          content: '回复内容',
          parentId: 'root-comment',
          replyToId: 'root-comment',
          replyToAuthorName: '被回复的人',
          isDeleted: false,
          createdAt: '2026-05-25T10:00:00.000Z',
          targetType: 'post',
          target: { id: 'post-1', title: '帖子标题', status: 'published' },
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=comments')

    expect(await screen.findByText('回复了被回复的人在')).toBeInTheDocument()
    expect(screen.getByText('下的评论')).toBeInTheDocument()
    expect(screen.queryByText('评论了帖子')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '帖子标题' })).toHaveAttribute('href', '/forum/post-1')
  })

  it('marks deleted comments and hides deep links from regular users', async () => {
    mockApiGet.mockResolvedValue({
      comments: [
        {
          id: 'comment-deleted',
          postId: 'post-1',
          galleryId: null,
          authorUid: 'user-1',
          authorName: '测试用户',
          authorPhoto: null,
          content: '评论已删除',
          parentId: null,
          isDeleted: true,
          deletedAt: '2026-05-25T10:00:00.000Z',
          deletionReason: '违规内容',
          createdAt: '2026-05-25T10:00:00.000Z',
          targetType: 'post',
          target: { id: 'post-1', title: '帖子标题', status: 'published' },
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=comments')

    expect(await screen.findByText('评论已删除（原因：违规内容）')).toBeInTheDocument()
    expect(screen.getByText('评论已删除')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '帖子标题' })).toHaveAttribute('href', '/forum/post-1')
    expect(screen.queryByRole('link', { name: '查看评论：评论已删除' })).not.toBeInTheDocument()
  })

  it('keeps deleted comment deep links for admins', async () => {
    mockAuthRole.mockReturnValue('admin')
    mockApiGet.mockResolvedValue({
      comments: [
        {
          id: 'comment-deleted',
          postId: 'post-1',
          galleryId: null,
          authorUid: 'user-1',
          authorName: '测试用户',
          authorPhoto: null,
          content: '被删评论原文',
          parentId: null,
          isDeleted: true,
          deletedAt: '2026-05-25T10:00:00.000Z',
          deletionReason: '违规内容',
          createdAt: '2026-05-25T10:00:00.000Z',
          targetType: 'post',
          target: { id: 'post-1', title: '帖子标题', status: 'published' },
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=comments')

    expect(await screen.findByText('被删评论原文')).toBeInTheDocument()
    const commentLink = screen.getByRole('link', { name: '查看评论：被删评论原文' })
    expect(commentLink).toHaveAttribute('href', '/forum/post-1#comment-comment-deleted')
    expect(commentLink).toHaveAttribute('target', '_blank')
    expect(screen.getByText('评论已删除（原因：违规内容）')).toBeInTheDocument()
  })

  it('labels comments whose source is not visible', async () => {
    mockApiGet.mockResolvedValue({
      comments: [
        {
          id: 'comment-hidden-source',
          postId: 'post-1',
          galleryId: null,
          authorUid: 'user-1',
          authorName: '测试用户',
          authorPhoto: null,
          content: '来源不可见评论',
          parentId: null,
          isDeleted: false,
          createdAt: '2026-05-25T10:00:00.000Z',
          targetType: 'post',
          target: null,
          post: null,
        },
      ],
      total: 1,
    })

    renderSettings('/settings/content?tab=comments')

    expect(await screen.findByText('来源不可见评论')).toBeInTheDocument()
    expect(screen.getByText('原内容不可见')).toBeInTheDocument()
    expect(screen.queryByText('原内容已删除或不可见')).not.toBeInTheDocument()
  })

  it('opens content management post and gallery links in new tabs', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/1/posts') {
        return {
          posts: [
            {
              id: 'post-1',
              title: '帖子标题',
              section: '闲聊',
              content: '',
              authorUid: 'user-1',
              status: 'published',
              likesCount: 0,
              dislikesCount: 0,
              commentsCount: 0,
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
            },
          ],
        }
      }

      if (path === '/api/users/1/galleries') {
        return {
          galleries: [
            {
              id: 'gallery-1',
              title: '图集标题',
              description: '',
              authorUid: 'user-1',
              authorName: '测试用户',
              tags: [],
              locationCode: null,
              locationName: null,
              locationDetail: null,
              copyright: null,
              published: true,
              publishedAt: '2026-05-25T10:00:00.000Z',
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
              images: [],
            },
          ],
        }
      }

      return { posts: [], pages: [], galleries: [], comments: [] }
    })

    renderSettings('/settings/content?tab=posts')

    const postLink = await screen.findByRole('link', { name: /帖子标题/ })
    expect(postLink).toHaveAttribute('href', '/forum/post-1')
    expect(postLink).toHaveAttribute('target', '_blank')
    expect(postLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText('已发布')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: '图集' }))

    const galleryLink = await screen.findByRole('link', { name: /图集标题/ })
    expect(galleryLink).toHaveAttribute('href', '/gallery/gallery-1')
    expect(galleryLink).toHaveAttribute('target', '_blank')
    expect(galleryLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText('已发布')).not.toBeInTheDocument()
  })

  it('only shows content status badges for unpublished content', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/users/1/posts') {
        return {
          posts: [
            {
              id: 'post-draft',
              title: '草稿帖子',
              section: '闲聊',
              content: '',
              authorUid: 'user-1',
              status: 'rejected',
              reviewNote: '内容不符合要求',
              likesCount: 0,
              dislikesCount: 0,
              commentsCount: 0,
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
            },
          ],
        }
      }

      if (path === '/api/users/1/galleries') {
        return {
          galleries: [
            {
              id: 'gallery-draft',
              title: '未发布图集',
              description: '',
              authorUid: 'user-1',
              authorName: '测试用户',
              tags: [],
              locationCode: null,
              locationName: null,
              locationDetail: null,
              copyright: null,
              published: false,
              publishedAt: null,
              createdAt: '2026-05-25T10:00:00.000Z',
              updatedAt: '2026-05-25T10:00:00.000Z',
              images: [],
            },
          ],
        }
      }

      return { posts: [], pages: [], galleries: [], comments: [] }
    })

    renderSettings('/settings/content?tab=posts')

    expect(await screen.findByText('已驳回（原因：内容不符合要求）')).toBeInTheDocument()
    expect(screen.queryByText('已发布')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: '图集' }))

    expect(await screen.findByText('未发布')).toBeInTheDocument()
  })
})
