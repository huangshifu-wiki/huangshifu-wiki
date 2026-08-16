// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ListPageContentState,
  ListPageLoadingBoundary,
} from '../../../src/components/ListPageState'

describe('ListPageLoadingBoundary', () => {
  it('初始加载时显示页面骨架而不显示页面内容', () => {
    render(
      <ListPageLoadingBoundary variant="events" isInitialLoading>
        <div>页面内容</div>
      </ListPageLoadingBoundary>
    )

    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument()
    expect(screen.queryByText('页面内容')).not.toBeInTheDocument()
  })
})

describe('ListPageContentState', () => {
  it('空数据错误时显示错误态而不显示空态', () => {
    render(
      <ListPageContentState
        hasItems={false}
        error={new Error('failed')}
        onRetry={vi.fn()}
        empty={<div>空数据</div>}
      >
        <div>列表内容</div>
      </ListPageContentState>
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    expect(screen.queryByText('空数据')).not.toBeInTheDocument()
  })

  it('已有数据错误时保留列表并显示局部错误', () => {
    render(
      <ListPageContentState
        hasItems
        error={new Error('stale')}
        onRetry={vi.fn()}
        staleDescription="数据可能已过期"
        empty={<div>空数据</div>}
      >
        <div>列表内容</div>
      </ListPageContentState>
    )

    expect(screen.getByText('数据可能已过期')).toBeInTheDocument()
    expect(screen.getByText('列表内容')).toBeInTheDocument()
    expect(screen.queryByText('空数据')).not.toBeInTheDocument()
  })

  it('无错误有数据时只显示列表内容', () => {
    render(
      <ListPageContentState hasItems error={null} onRetry={vi.fn()} empty={<div>空数据</div>}>
        <div>列表内容</div>
      </ListPageContentState>
    )

    expect(screen.getByText('列表内容')).toBeInTheDocument()
    expect(screen.queryByText('空数据')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('无错误无数据时显示传入空态', () => {
    render(
      <ListPageContentState
        hasItems={false}
        error={null}
        onRetry={vi.fn()}
        empty={<div>空数据</div>}
      >
        <div>列表内容</div>
      </ListPageContentState>
    )

    expect(screen.getByText('空数据')).toBeInTheDocument()
    expect(screen.queryByText('列表内容')).not.toBeInTheDocument()
  })
})
