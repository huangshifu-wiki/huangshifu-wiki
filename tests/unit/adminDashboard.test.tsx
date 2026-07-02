// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminDashboard from '../../src/pages/Admin/AdminDashboard'

const mockApiGet = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'admin-1', role: 'superadmin' },
  }),
}))

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses paginated admin music total instead of current page length', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/api/admin/music') {
        return Promise.resolve({
          data: Array.from({ length: 20 }, (_, index) => ({ docId: `song-${index}` })),
          total: 123,
        })
      }
      return Promise.resolve({ data: [] })
    })

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    )

    expect(await screen.findByText('123')).toBeInTheDocument()
  })
})
