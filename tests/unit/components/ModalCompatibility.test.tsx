import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmModal, FormModal } from '@/src/components/Modal'

describe('Modal 兼容层', () => {
  it('ConfirmModal 保持确认与取消回调', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmModal open onClose={onClose} onConfirm={onConfirm} title="删除" message="不可恢复" />
    )
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('ConfirmModal 点击背景关闭', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ConfirmModal open onClose={onClose} onConfirm={vi.fn()} title="删除" message="不可恢复" />
    )

    const overlay = Array.from(document.querySelectorAll<HTMLElement>('[data-state="open"]')).find(
      (element) => element.getAttribute('role') !== 'alertdialog'
    )
    expect(overlay).toBeInTheDocument()
    await user.click(overlay as HTMLElement)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ConfirmModal 传 cancelText null 时只渲染确认按钮', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="提醒"
        message="已保存"
        confirmText="知道了"
        cancelText={null}
      />
    )
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('FormModal 提交且保留可访问标题', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <FormModal open onClose={vi.fn()} onSubmit={onSubmit} title="编辑资料" submitText="保存">
        <label htmlFor="compat-name">名称</label>
        <input id="compat-name" />
      </FormModal>
    )
    expect(screen.getByRole('dialog', { name: '编辑资料' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
