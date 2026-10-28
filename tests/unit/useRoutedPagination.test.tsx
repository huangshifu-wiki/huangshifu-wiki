// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useRoutedPagination } from '../../src/hooks/useRoutedPagination'

const Harness = ({
  totalCount,
  entry = '/',
  pageSizeParam = null,
  enabled = true,
}: {
  totalCount?: number
  entry?: string
  pageSizeParam?: string | null
  enabled?: boolean
}) => {
  const pagination = useRoutedPagination({
    totalCount,
    defaultPageSize: 20,
    pageSizeParam,
    pageSizeOptions: [10, 20, 50],
    enabled,
  })
  const [searchParams] = useSearchParams()
  return (
    <div>
      <span data-testid="page">{pagination.page}</span>
      <span data-testid="page-size">{pagination.pageSize}</span>
      <span data-testid="total-pages">{pagination.totalPages}</span>
      <span data-testid="has-multiple">{String(pagination.hasMultiplePages)}</span>
      <span data-testid="url">{searchParams.toString()}</span>
    </div>
  )
}

describe('useRoutedPagination 页码钳制', () => {
  it('深链接入页码在总数未知时不被钳回第 1 页，总数到达后仍保留', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/?page=2']}>
        <Harness />
      </MemoryRouter>
    )
    expect(screen.getByTestId('page')).toHaveTextContent('2')
    expect(screen.getByTestId('url')).toHaveTextContent('page=2')

    rerender(
      <MemoryRouter initialEntries={['/?page=2']}>
        <Harness totalCount={250} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('page')).toHaveTextContent('2')
    expect(screen.getByTestId('url')).toHaveTextContent('page=2')
  })

  it('总数加载后，超范围页码才被钳制到最后一页', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/?page=5']}>
        <Harness />
      </MemoryRouter>
    )
    expect(screen.getByTestId('page')).toHaveTextContent('5')

    rerender(
      <MemoryRouter initialEntries={['/?page=5']}>
        <Harness totalCount={20} />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('1'))
  })

  it('在范围内的页码即使总数已知也不会被改写', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/?page=3']}>
        <Harness totalCount={100} />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('total-pages')).toHaveTextContent('5'))
    expect(screen.getByTestId('page')).toHaveTextContent('3')
    expect(screen.getByTestId('url')).toHaveTextContent('page=3')

    rerender(
      <MemoryRouter initialEntries={['/?page=3']}>
        <Harness totalCount={50} />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('total-pages')).toHaveTextContent('3'))
    expect(screen.getByTestId('page')).toHaveTextContent('3')
  })

  it('只有已知总数超过一页时标记为多页', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    )
    expect(screen.getByTestId('has-multiple')).toHaveTextContent('false')

    rerender(
      <MemoryRouter>
        <Harness totalCount={0} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('has-multiple')).toHaveTextContent('false')

    rerender(
      <MemoryRouter>
        <Harness totalCount={20} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('has-multiple')).toHaveTextContent('false')

    rerender(
      <MemoryRouter>
        <Harness totalCount={21} />
      </MemoryRouter>
    )
    expect(screen.getByTestId('has-multiple')).toHaveTextContent('true')
  })

  it('规范化页码和页大小 URL', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/?page=2&pageSize=50']}>
        <Harness totalCount={100} pageSizeParam="pageSize" />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent('2')
      expect(screen.getByTestId('page-size')).toHaveTextContent('50')
    })

    rerender(
      <MemoryRouter key="invalid-page-size" initialEntries={['/?page=4&pageSize=999']}>
        <Harness totalCount={100} pageSizeParam="pageSize" />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByTestId('page-size')).toHaveTextContent('20')
      expect(screen.getByTestId('url')).not.toHaveTextContent('pageSize=999')
    })
  })

  it('禁用时不改写分页 URL', async () => {
    render(
      <MemoryRouter initialEntries={['/?page=3&pageSize=50']}>
        <Harness totalCount={100} pageSizeParam="pageSize" enabled={false} />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByTestId('url')).toHaveTextContent('page=3&pageSize=50')
    })
  })
})
