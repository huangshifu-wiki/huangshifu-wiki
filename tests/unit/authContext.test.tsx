// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { apiGet, clearApiCache } from '../../src/lib/apiClient'
import { AuthProvider, useAuth } from '../../src/context/AuthContext'
import { resetAuthStateForTests } from '../../src/lib/auth'

type User = import('../../src/lib/auth').User

function createMockUser(overrides?: Partial<User>): User {
  return {
    uid: 'admin-1',
    publicId: '1',
    email: 'admin@example.com',
    displayName: '管理员',
    photoURL: null,
    role: 'admin',
    status: 'active',
    banReason: null,
    bannedAt: null,
    level: 1,
    signature: '',
    bio: '',
    emailVerified: true,
    isAnonymous: false,
    tenantId: null,
    providerData: [],
    ...overrides,
  }
}

function AuthProbe() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>loading</div>
  }

  return <div data-testid="auth-uid">{user?.uid ?? 'guest'}</div>
}

describe('AuthProvider', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.resetModules()
    resetAuthStateForTests()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )
  })

  afterEach(() => {
    cleanup()
    clearApiCache()
    vi.unstubAllGlobals()
  })

  it.each([
    {
      name: '401',
      response: { error: '请先登录' },
      status: 401,
      expectedMessage: '请先登录',
    },
    {
      name: 'ban-related 403',
      response: { error: '账号已被封禁，无法执行管理操作' },
      status: 403,
      expectedMessage: '账号已被封禁，无法执行管理操作',
    },
  ])(
    'refreshes auth state on $name without logging out through admin layout',
    async ({ response, status, expectedMessage }) => {
      let authMeCalls = 0
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)

        if (url === '/api/auth/me') {
          authMeCalls += 1
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: authMeCalls === 1 ? createMockUser() : null,
              }),
              { status: 200 }
            )
          )
        }

        if (url === '/api/users/me') {
          return Promise.resolve(
            new Response(JSON.stringify({ user: { preferences: {} } }), {
              status: 200,
            })
          )
        }

        if (url === '/api/admin/restricted') {
          return Promise.resolve(
            new Response(JSON.stringify(response), {
              status,
            })
          )
        }

        return Promise.resolve(
          new Response(JSON.stringify({ error: '请先登录' }), {
            status: 401,
          })
        )
      })

      render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('auth-uid')).toHaveTextContent('admin-1')
      })

      await expect(
        apiGet('/api/admin/restricted', undefined, undefined, undefined)
      ).rejects.toThrow(expectedMessage)

      await waitFor(() => {
        expect(screen.getByTestId('auth-uid')).toHaveTextContent('guest')
      })

      const authMeRequests = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')
      expect(authMeRequests).toHaveLength(2)
      expect(authMeRequests[0][1]).toEqual(expect.objectContaining({ credentials: 'include' }))
      expect(authMeRequests[1][1]).toEqual(expect.objectContaining({ credentials: 'include' }))
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      )
    }
  )

  it('does not repeatedly refresh auth when the current user is already banned', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: createMockUser({
                status: 'banned',
                banReason: '测试封禁',
                bannedAt: '2026-05-28T00:00:00.000Z',
              }),
            }),
            { status: 200 }
          )
        )
      }

      if (url === '/api/users/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: '账号已被封禁：测试封禁',
              code: 'USER_BANNED',
            }),
            { status: 403 }
          )
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: 'unexpected request' }), {
          status: 500,
        })
      )
    })

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('auth-uid')).toHaveTextContent('admin-1')
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const authMeRequests = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')
    expect(authMeRequests).toHaveLength(1)
  })
})
