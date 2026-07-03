// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DialogProvider, useDialog } from '../../../src/components/Dialog'

const PasswordPromptTrigger = () => {
  const dialog = useDialog()

  return (
    <button
      type="button"
      onClick={() =>
        void dialog.prompt({
          title: '验证账户密码',
          message: '请输入当前账户密码',
          inputType: 'password',
        })
      }
    >
      打开密码验证
    </button>
  )
}

describe('DialogProvider', () => {
  it('renders password prompts as current-password inputs', async () => {
    render(
      <DialogProvider>
        <PasswordPromptTrigger />
      </DialogProvider>
    )

    fireEvent.click(screen.getByText('打开密码验证'))

    await waitFor(() => {
      expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
    })
    const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]')

    expect(passwordInput).toBeInstanceOf(HTMLInputElement)
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
  })
})
