import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Pagination from '../../../src/components/Pagination'

const initialInnerHeight = window.innerHeight

afterEach(() => {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: initialInnerHeight,
  })
  vi.restoreAllMocks()
})

describe('Pagination', () => {
  it('列表末尾尚未进入视口时固定导航并保留文档流空间', () => {
    let anchorTop = 900
    let scheduledFrame: FrameRequestCallback | null = null
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFrame = callback
      return 1
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-pagination-anchor')) return new DOMRect(24, anchorTop, 600, 86)
      if (this.getAttribute('aria-label') === '分页导航') {
        return new DOMRect(24, anchorTop, 600, 86)
      }
      return new DOMRect()
    })

    render(<Pagination page={3} totalPages={10} onPageChange={vi.fn()} />)

    const navigation = screen.getByRole('navigation', { name: '分页导航' })
    expect(navigation).toHaveClass('pagination-panel', 'fixed')
    expect(navigation).toHaveAttribute('data-state', 'docked')
    expect(navigation).toHaveStyle({ left: '24px', width: '600px' })
    expect(document.querySelector('[data-pagination-anchor]')).toHaveStyle({ height: '86px' })

    anchorTop = 600
    fireEvent.scroll(window)
    act(() => scheduledFrame?.(0))

    const inlineNavigation = screen.getByRole('navigation', { name: '分页导航' })
    expect(inlineNavigation).toHaveClass('pagination-panel', 'static')
    expect(inlineNavigation).toHaveAttribute('data-state', 'inline')
  })
  it('总页数暂不可用后重新显示时重建停靠状态', () => {
    let anchorTop = 900
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-pagination-anchor')) return new DOMRect(24, anchorTop, 600, 86)
      if (this.getAttribute('aria-label') === '分页导航') {
        return new DOMRect(24, anchorTop, 600, 86)
      }
      return new DOMRect()
    })

    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination page={1} totalPages={10} onPageChange={onPageChange} />)
    expect(screen.getByRole('navigation', { name: '分页导航' })).toHaveAttribute(
      'data-state',
      'docked'
    )

    rerender(<Pagination page={1} totalPages={0} onPageChange={onPageChange} />)
    expect(screen.queryByRole('navigation', { name: '分页导航' })).not.toBeInTheDocument()

    anchorTop = 600
    rerender(<Pagination page={1} totalPages={10} onPageChange={onPageChange} />)
    expect(screen.getByRole('navigation', { name: '分页导航' })).toHaveAttribute(
      'data-state',
      'inline'
    )
  })

  it('保持粘滞导航契约并传递翻页目标', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()

    render(<Pagination page={3} totalPages={10} onPageChange={onPageChange} />)

    expect(screen.getByRole('navigation', { name: '分页导航' })).toHaveClass(
      'pagination-panel',
      'static'
    )

    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenLastCalledWith(4)

    await user.click(screen.getByRole('button', { name: '第 2 页' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)

    await user.click(screen.getByRole('button', { name: '末页' }))
    expect(onPageChange).toHaveBeenLastCalledWith(10)
  })

  it('在第一页和末页禁用越界操作', () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination page={1} totalPages={10} onPageChange={onPageChange} />)

    expect(screen.getByRole('button', { name: '首页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '末页' })).toBeEnabled()

    rerender(<Pagination page={10} totalPages={10} onPageChange={onPageChange} />)

    expect(screen.getByRole('button', { name: '首页' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '末页' })).toBeDisabled()
  })

  it('将每页条数作为数值传给回调', async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()

    render(
      <Pagination
        page={1}
        totalPages={10}
        onPageChange={vi.fn()}
        pageSize={20}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={[10, 20, 50]}
        showPageSizeSelector
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: '每页显示条数' }), '50')
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('总页数不为正数时不渲染导航', () => {
    render(<Pagination page={1} totalPages={0} onPageChange={vi.fn()} />)

    expect(screen.queryByRole('navigation', { name: '分页导航' })).not.toBeInTheDocument()
  })
})
