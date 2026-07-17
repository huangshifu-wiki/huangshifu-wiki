// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

const ValidatedPromptTrigger = ({
  onConfirm,
}: {
  onConfirm: (value: string) => Promise<boolean>
}) => {
  const dialog = useDialog()

  return (
    <button
      type="button"
      onClick={() =>
        void dialog.prompt({
          title: '输入名称',
          message: '名称需要通过校验',
          onConfirm,
        })
      }
    >
      打开校验输入
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

  it('keeps a prompt open when asynchronous validation rejects the value', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(false)
    render(
      <DialogProvider>
        <ValidatedPromptTrigger onConfirm={onConfirm} />
      </DialogProvider>
    )

    await user.click(screen.getByRole('button', { name: '打开校验输入' }))
    await user.type(screen.getByRole('textbox'), '重复名称')
    await user.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('重复名称'))
    expect(screen.getByRole('alertdialog', { name: '输入名称' })).toBeInTheDocument()
  })
})
