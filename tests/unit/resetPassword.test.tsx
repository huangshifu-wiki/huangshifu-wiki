// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ResetPassword from '../../src/pages/ResetPassword'

const mockConfirmPasswordReset = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/auth', () => ({
  confirmPasswordReset: mockConfirmPasswordReset,
}))

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({
    show: mockShow,
  }),
}))

function renderResetPassword(path = '/reset-password?token=reset-token') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-password" element={<div>找回密码页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('rejects mismatched passwords before calling the API', () => {
    renderResetPassword()

    fireEvent.change(screen.getByLabelText(/^新密码\s*\*$/), {
      target: { value: 'NewPassword123!' },
    })
    fireEvent.change(screen.getByLabelText(/确认新密码\s*\*/), {
      target: { value: 'DifferentPassword123!' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '重置密码' }).closest('form')!)

    expect(mockConfirmPasswordReset).not.toHaveBeenCalled()
    expect(mockShow).toHaveBeenCalledWith('两次输入的密码不一致', { variant: 'error' })
  })

  it('rejects short passwords before calling the API', () => {
    renderResetPassword()

    fireEvent.change(screen.getByLabelText(/^新密码\s*\*$/), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByLabelText(/确认新密码\s*\*/), {
      target: { value: 'short' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '重置密码' }).closest('form')!)

    expect(mockConfirmPasswordReset).not.toHaveBeenCalled()
    expect(mockShow).toHaveBeenCalledWith('密码至少8个字符', { variant: 'error' })
  })

  it('confirms password reset and returns to login page', async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({ success: true })
    renderResetPassword()

    fireEvent.change(screen.getByLabelText(/^新密码\s*\*$/), {
      target: { value: 'NewPassword123!' },
    })
    fireEvent.change(screen.getByLabelText(/确认新密码\s*\*/), {
      target: { value: 'NewPassword123!' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '重置密码' }).closest('form')!)

    await waitFor(() => {
      expect(mockConfirmPasswordReset).toHaveBeenCalledWith('reset-token', 'NewPassword123!')
    })
    expect(mockShow).toHaveBeenCalledWith('密码已重置，请使用新密码登录', { duration: 4000 })
    expect(await screen.findByText('登录页')).toBeInTheDocument()
  })
})
