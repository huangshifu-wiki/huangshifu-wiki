import { createRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IncrementalLoadFooter } from '../../../src/components/IncrementalLoadFooter'

const createProps = (overrides: Partial<ComponentProps<typeof IncrementalLoadFooter>> = {}) => ({
  hasMore: true,
  loading: false,
  total: 40,
  loaded: 20,
  pageSize: 20,
  onLoadMore: vi.fn(),
  sentinelRef: createRef<HTMLDivElement>(),
  ...overrides,
})

describe('IncrementalLoadFooter', () => {
  it('初次加载和空列表不渲染', () => {
    const { rerender } = render(<IncrementalLoadFooter {...createProps({ loaded: 0 })} />)
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument()

    rerender(<IncrementalLoadFooter {...createProps({ total: 0, loaded: 0 })} />)
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('单页总量不渲染 footer', () => {
    render(<IncrementalLoadFooter {...createProps({ total: 20, loaded: 20 })} />)
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument()
  })

  it('多页结果显示已加载数量并支持加载更多', () => {
    const props = createProps()
    render(<IncrementalLoadFooter {...props} />)
    expect(screen.getByText('已加载 20 / 40 条')).toBeInTheDocument()
    screen.getByRole('button', { name: '加载更多' }).click()
    expect(props.onLoadMore).toHaveBeenCalledOnce()
  })

  it('加载失败显示重试按钮', () => {
    const onRetry = vi.fn()
    render(<IncrementalLoadFooter {...createProps({ error: 'failed', onRetry })} />)
    screen.getByRole('button', { name: '重新加载' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('多页数据加载完毕后保留到底状态', () => {
    render(<IncrementalLoadFooter {...createProps({ hasMore: false, total: 40, loaded: 40 })} />)
    expect(screen.getByText('已经到底了')).toBeInTheDocument()
  })
})
