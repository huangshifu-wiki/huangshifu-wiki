// @vitest-environment jsdom
import React, { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useIncrementalListLoader } from '../../src/hooks/useIncrementalListLoader'

type Item = { id: string }
type PageResult = { items: Item[]; total: number }

let resolvePage: ((result: PageResult) => void) | null = null
let batchIndex = 0

const Harness = ({ preserve }: { preserve: boolean }) => {
  const [resetKey, setResetKey] = useState('A')
  const { items, loadingInitial } = useIncrementalListLoader<Item>({
    enabled: true,
    pageSize: 10,
    resetKey,
    preserveItemsOnReset: preserve,
    fetchPage: () => {
      const batch = batchIndex === 0 ? [{ id: 'a' }] : [{ id: 'b' }]
      batchIndex += 1
      return new Promise<PageResult>((resolve) => {
        resolvePage = resolve
      })
    },
    getItemKey: (item) => item.id,
  })
  return (
    <div>
      <button onClick={() => setResetKey((k) => (k === 'A' ? 'B' : 'A'))}>switch</button>
      <span data-testid="items">{items.map((i) => i.id).join(',')}</span>
      <span data-testid="loading">{String(loadingInitial)}</span>
    </div>
  )
}

const settle = (items: Item[]) => {
  resolvePage?.({ items, total: items.length })
  resolvePage = null
}

describe('useIncrementalListLoader preserveItemsOnReset', () => {
  beforeEach(() => {
    resolvePage = null
    batchIndex = 0
  })

  it('preserve=true 时重置不清空旧列表，新数据落地后整体替换', async () => {
    render(<Harness preserve />)
    await act(async () => {
      settle([{ id: 'a' }])
    })
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('a'))

    screen.getByRole('button', { name: 'switch' }).click()
    // 等待 reset effect 生效（新批次尚未落地）
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('true'))
    // 旧列表仍可见
    expect(screen.getByTestId('items')).toHaveTextContent('a')

    await act(async () => {
      settle([{ id: 'b' }])
    })
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('b'))
  })

  it('preserve=false（默认）时重置立即清空列表', async () => {
    render(<Harness preserve={false} />)
    await act(async () => {
      settle([{ id: 'a' }])
    })
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('a'))

    screen.getByRole('button', { name: 'switch' }).click()
    // 等待 reset effect 生效（新批次尚未落地）
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('true'))
    // 旧列表已被清空
    expect(screen.getByTestId('items')).toHaveTextContent('')

    await act(async () => {
      settle([{ id: 'b' }])
    })
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('b'))
  })
})
