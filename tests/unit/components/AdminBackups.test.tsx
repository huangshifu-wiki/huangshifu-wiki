// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminBackups from '../../../src/pages/Admin/AdminBackups'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())
const mockApiUpload = vi.hoisted(() => vi.fn())
const mockGetXsrfToken = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiUpload: mockApiUpload,
  getXsrfToken: mockGetXsrfToken,
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

const initialBackup = {
  filename: 'backup_2026-06-28_10-00-00-000.zip',
  size: 1024,
  sizeFormatted: '1 KB',
  createdAt: '2026-06-28T10:00:00.000Z',
  note: '发布前备份',
}

describe('AdminBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    })
    mockGetXsrfToken.mockReturnValue('token')
    mockApiGet.mockResolvedValue({ backups: [initialBackup] })
    mockApiPost.mockResolvedValue({ backup: initialBackup })
    mockApiUpload.mockResolvedValue({ success: true })
    mockFetch.mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['backup'])),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('downloads a backup without asking for a backup password', async () => {
    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })
    expect(screen.getByText(initialBackup.note)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('下载'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByText('下载备份')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('请输入备份密码')).not.toBeInTheDocument()
    expect(mockFetch.mock.calls[0][0]).toBe(
      `/api/admin/backup/${encodeURIComponent(initialBackup.filename)}/download`
    )
    expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('body')
  })

  it('creates a backup without sending a password and refreshes the list without cache', async () => {
    const createdBackup = {
      filename: 'backup_2026-06-28_10-01-00-000.zip',
      size: 2048,
      sizeFormatted: '2 KB',
      createdAt: '2026-06-28T10:01:00.000Z',
      note: '',
    }
    mockApiPost.mockResolvedValueOnce({ backup: createdBackup })
    mockApiGet
      .mockResolvedValueOnce({ backups: [initialBackup] })
      .mockResolvedValueOnce({ backups: [createdBackup, initialBackup] })

    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('创建备份'))
    fireEvent.click(screen.getAllByText('创建备份').at(-1)!)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/backup/create')
    })
    expect(mockApiPost.mock.calls[0]).toHaveLength(1)

    await waitFor(() => {
      expect(screen.getByText(createdBackup.filename)).toBeInTheDocument()
    })
    expect(mockApiGet).toHaveBeenLastCalledWith('/api/admin/backup/list', undefined, {
      staleTime: 0,
      swr: false,
    })
  })

  it('creates a backup with an optional note', async () => {
    const createdBackup = {
      filename: 'backup_2026-06-28_10-02-00-000.zip',
      size: 2048,
      sizeFormatted: '2 KB',
      createdAt: '2026-06-28T10:02:00.000Z',
      note: '升级前备份',
    }
    mockApiPost.mockResolvedValueOnce({ backup: createdBackup })
    mockApiGet
      .mockResolvedValueOnce({ backups: [initialBackup] })
      .mockResolvedValueOnce({ backups: [createdBackup, initialBackup] })

    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('创建备份'))
    fireEvent.change(screen.getByLabelText('备份备注（可选）'), {
      target: { value: '升级前备份' },
    })
    fireEvent.click(screen.getAllByText('创建备份').at(-1)!)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/backup/create', {
        note: '升级前备份',
      })
    })
  })

  it('updates a backup note from the table', async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, note: '新的备注' })

    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('编辑备注'))
    fireEvent.change(screen.getByLabelText('备份备注'), {
      target: { value: '新的备注' },
    })
    fireEvent.click(screen.getByText('保存备注'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        `/api/admin/backup/${encodeURIComponent(initialBackup.filename)}/note`,
        { note: '新的备注' }
      )
    })

    await waitFor(() => {
      expect(screen.getByText('新的备注')).toBeInTheDocument()
    })
  })

  it('deletes a backup without sending a password and removes it from the table', async () => {
    mockApiGet
      .mockResolvedValueOnce({ backups: [initialBackup] })
      .mockResolvedValueOnce({ backups: [] })
    mockApiPost.mockResolvedValueOnce({ success: true })

    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('删除'))
    fireEvent.click(screen.getByText('确认删除'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        `/api/admin/backup/${encodeURIComponent(initialBackup.filename)}/delete`
      )
    })
    expect(mockApiPost.mock.calls[0]).toHaveLength(1)

    await waitFor(() => {
      expect(screen.queryByText(initialBackup.filename)).not.toBeInTheDocument()
    })
  })

  it('restores from an existing backup and refreshes the backup list', async () => {
    const preRestoreBackup = {
      filename: 'backup_2026-06-28_10-05-00-000.zip',
      size: 4096,
      sizeFormatted: '4 KB',
      createdAt: '2026-06-28T10:05:00.000Z',
      note: '',
    }
    mockApiGet
      .mockResolvedValueOnce({ backups: [initialBackup] })
      .mockResolvedValueOnce({ backups: [preRestoreBackup, initialBackup] })
    mockApiPost.mockResolvedValueOnce({ success: true })

    render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('恢复'))
    fireEvent.click(screen.getByText('恢复数据库'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        `/api/admin/backup/${encodeURIComponent(initialBackup.filename)}/restore`,
        { confirm: true }
      )
    })

    await waitFor(() => {
      expect(screen.getByText(preRestoreBackup.filename)).toBeInTheDocument()
    })
    expect(mockApiGet).toHaveBeenLastCalledWith('/api/admin/backup/list', undefined, {
      staleTime: 0,
      swr: false,
    })
  })

  it('passes legacy restore passwords without trimming them', async () => {
    const { container } = render(<AdminBackups />)

    await waitFor(() => {
      expect(screen.getByText(initialBackup.filename)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('上传恢复'))
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['zip'], 'backup.zip', { type: 'application/zip' })],
      },
    })
    fireEvent.change(screen.getByPlaceholderText('仅旧加密备份需要'), {
      target: { value: ' secret ' },
    })
    fireEvent.click(screen.getByText('恢复数据库'))

    await waitFor(() => {
      expect(mockApiUpload).toHaveBeenCalledTimes(1)
    })

    const formData = mockApiUpload.mock.calls[0][1] as FormData
    expect(formData.get('legacyPassword')).toBe(' secret ')
    expect(formData.get('confirm')).toBe('true')
  })
})
