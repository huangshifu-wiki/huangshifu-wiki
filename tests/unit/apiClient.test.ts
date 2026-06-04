import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from '../../src/lib/apiClient'
import { setAuthErrorCallback } from '../../src/lib/errorHandler'

describe('apiClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    setAuthErrorCallback(null)
    vi.unstubAllGlobals()
  })

  it('builds query string and uses default request options', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const data = await apiGet<{ ok: boolean }>('/api/posts', {
      section: 'music',
      page: 2,
      includeDraft: false,
      ignoredEmpty: '',
      ignoredNull: null,
      ignoredUndefined: undefined,
    })

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/posts?section=music&page=2&includeDraft=false')
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  it('sends JSON body for write requests', async () => {
    vi.stubGlobal('document', {
      cookie: 'XSRF-TOKEN=test-xsrf-token',
    })

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ removed: true }), { status: 200 }))

    await apiPost('/api/posts', { title: 'post' })
    await apiPut('/api/posts/1', { title: 'updated' })
    await apiPatch('/api/posts/1', { title: 'patched' })
    await apiDelete('/api/posts/1', { reason: 'duplicate' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/posts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'post' }),
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': 'test-xsrf-token',
        },
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/posts/1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ title: 'updated' }),
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': 'test-xsrf-token',
        },
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/posts/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'patched' }),
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': 'test-xsrf-token',
        },
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/posts/1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ reason: 'duplicate' }),
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': 'test-xsrf-token',
        },
      })
    )
  })

  it('throws backend error message when request fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
      })
    )

    await expect(apiGet('/api/secret')).rejects.toThrow('forbidden')
  })

  it('does not invoke auth error callback for business permission errors', async () => {
    const authErrorCallback = vi.fn()
    setAuthErrorCallback(authErrorCallback)

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '无权编辑该页面' }), {
        status: 403,
      })
    )

    await expect(apiPost('/api/wiki/restricted', {})).rejects.toThrow('无权编辑该页面')
    expect(authErrorCallback).not.toHaveBeenCalled()
  })

  it('invokes auth error callback for ban-related permission errors', async () => {
    const authErrorCallback = vi.fn()
    setAuthErrorCallback(authErrorCallback)

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: '账号已被封禁，无法执行管理操作',
        }),
        {
          status: 403,
        }
      )
    )

    await expect(apiPost('/api/admin/restricted', {})).rejects.toThrow(
      '账号已被封禁，无法执行管理操作'
    )
    expect(authErrorCallback).toHaveBeenCalledTimes(1)
  })

  it('invokes auth error callback for admin permission state changes', async () => {
    const authErrorCallback = vi.fn()
    setAuthErrorCallback(authErrorCallback)

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '需要管理员权限' }), {
        status: 403,
      })
    )

    await expect(apiPost('/api/admin/restricted', {})).rejects.toThrow('需要管理员权限')
    expect(authErrorCallback).toHaveBeenCalledTimes(1)
  })

  it('invokes auth error callback for authentication errors', async () => {
    const authErrorCallback = vi.fn()
    setAuthErrorCallback(authErrorCallback)

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '请先登录' }), {
        status: 401,
      })
    )

    await expect(apiPost('/api/admin/restricted', {})).rejects.toThrow('请先登录')
    expect(authErrorCallback).toHaveBeenCalledTimes(1)
  })

  it('uploads multipart form data without JSON headers', async () => {
    vi.stubGlobal('document', {
      cookie: 'XSRF-TOKEN=test-xsrf-token',
    })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ file: { url: '/uploads/demo.png' } }), { status: 200 })
    )

    const formData = new FormData()
    formData.append('file', new Blob(['hello'], { type: 'text/plain' }), 'demo.txt')

    const data = await apiUpload<{ file: { url: string } }>('/api/uploads', formData)
    expect(data.file.url).toBe('/uploads/demo.png')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/uploads',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-XSRF-TOKEN': 'test-xsrf-token',
        },
        body: formData,
      })
    )
  })

  it('supports local markdown upload response shape', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ file: { url: '/uploads/markdown/2026/04/demo.png' } }), {
        status: 200,
      })
    )

    const formData = new FormData()
    formData.append('file', new Blob(['hello'], { type: 'image/png' }), 'demo.png')

    const response = await apiUpload<{ file: { url: string } }>('/api/uploads', formData)
    expect(response.file.url).toMatch(/^\/uploads\/markdown\/\d{4}\/\d{2}\//)
  })
})
