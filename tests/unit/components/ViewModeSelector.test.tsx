// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewModeSelector } from '../../../src/components/ViewModeSelector'

describe('ViewModeSelector', () => {
  it('limits visible options when modes are provided', () => {
    render(<ViewModeSelector value="list" onChange={vi.fn()} modes={['large', 'list']} />)

    expect(screen.getByRole('button', { name: '舒适' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '列表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '标准' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '紧凑' })).not.toBeInTheDocument()
  })
})
