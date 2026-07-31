// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminLayout from '../../../src/components/admin/AdminLayout'

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'admin', username: 'admin' },
    isAdmin: true,
  }),
}))

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('../../../src/hooks/usePendingReviewCount', () => ({
  usePendingReviewCount: () => 0,
}))

vi.mock('../../../src/hooks/usePublicFeatures', () => ({
  usePublicFeatures: () => ({ features: { semanticSearch: true } }),
}))

vi.mock('../../../src/components/HeaderUserControls', () => ({
  HeaderUserControls: () => null,
}))

vi.mock('../../../src/lib/auth', () => ({
  logoutRequest: vi.fn(),
}))

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div>仪表盘内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )

describe('AdminLayout 导航分组', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('渲染四个分组标题与全部条目', () => {
    renderLayout()

    expect(screen.getByRole('button', { name: /内容管理/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /运营管理/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /系统工具/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /审核队列/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /向量管理/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /封面缩略图/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /站点设置/ })).not.toBeInTheDocument()
  })

  it('点击分组标题折叠该组条目，其他组不受影响', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: /系统工具/ }))

    expect(screen.queryByRole('link', { name: /封面缩略图/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /向量管理/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /审核队列/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /百科管理/ })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('hsf:admin:nav-groups') ?? '[]')).toEqual(['tools'])
  })

  it('折叠状态持久化，重新渲染后仍折叠', async () => {
    const user = userEvent.setup()
    const first = renderLayout()

    await user.click(screen.getByRole('button', { name: /系统工具/ }))
    first.unmount()

    renderLayout()
    expect(screen.queryByRole('link', { name: /封面缩略图/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /系统工具/ }))
    expect(screen.getByRole('link', { name: /封面缩略图/ })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('hsf:admin:nav-groups') ?? '[]')).toEqual([])
  })
})
