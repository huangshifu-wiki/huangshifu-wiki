import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useUnsavedChangesGuard,
  resetUnsavedChangesGuardForTests,
} from '../../src/hooks/useUnsavedChangesGuard'

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn<() => Promise<boolean>>() }))

vi.mock('../../src/components/Dialog', () => ({
  useDialog: () => ({
    confirm: confirmMock,
  }),
}))

const Harness = ({ when }: { when: boolean }) => {
  const guard = useUnsavedChangesGuard(when)
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <button type="button" onClick={() => navigate('/elsewhere')}>
        nav
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button type="button" onClick={guard.markClean}>
        clean
      </button>
    </div>
  )
}

function renderHarness(when: boolean) {
  return render(
    <MemoryRouter initialEntries={['/edit']}>
      <Harness when={when} />
    </MemoryRouter>
  )
}

function dispatchBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    if (isSentinelCurrentEntry()) {
      window.history.replaceState({}, '', window.location.href)
    }
    resetUnsavedChangesGuardForTests()
    confirmMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('when=false 时导航不受拦截', async () => {
    renderHarness(false)

    fireEvent.click(screen.getByRole('button', { name: 'nav' }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('挂载后 when 由 false 变 true 时激活拦截（真实编辑路径）', async () => {
    confirmMock.mockResolvedValue(false)
    const { rerender } = renderHarness(false)

    rerender(
      <MemoryRouter initialEntries={['/edit']}>
        <Harness when={true} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'nav' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('pathname').textContent).toBe('/edit')
  })

  it('when=true 时导航先弹确认；取消则留在原页', async () => {
    confirmMock.mockResolvedValue(false)
    renderHarness(true)

    fireEvent.click(screen.getByRole('button', { name: 'nav' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '离开此页面？',
        confirmText: '离开',
        cancelText: '留在本页',
      })
    )
    expect(screen.getByTestId('pathname').textContent).toBe('/edit')
  })

  it('when=true 时确认离开则放行导航', async () => {
    confirmMock.mockResolvedValue(true)
    renderHarness(true)

    fireEvent.click(screen.getByRole('button', { name: 'nav' }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
  })

  it('markClean 后导航不再弹确认', async () => {
    renderHarness(true)

    fireEvent.click(screen.getByRole('button', { name: 'clean' }))
    fireEvent.click(screen.getByRole('button', { name: 'nav' }))

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('when=true 拦截 beforeunload；when=false 放行', () => {
    const { rerender } = renderHarness(true)
    expect(dispatchBeforeUnload()).toBe(true)

    rerender(
      <MemoryRouter initialEntries={['/edit']}>
        <Harness when={false} />
      </MemoryRouter>
    )
    expect(dispatchBeforeUnload()).toBe(false)
  })

  it('激活时压入哨兵历史条目', () => {
    const baselineLength = window.history.length
    renderHarness(true)

    expect(window.history.length).toBe(baselineLength + 1)
    expect(isSentinelCurrentEntry()).toBe(true)
  })

  it('浏览器后退触发确认：选择留下则前进弹回哨兵', async () => {
    const goSpy = vi.spyOn(window.history, 'go')
    confirmMock.mockResolvedValue(false)
    renderHarness(true)

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(goSpy).toHaveBeenCalledWith(1))
    expect(screen.getByTestId('pathname').textContent).toBe('/edit')
  })

  it('浏览器后退触发确认：选择离开则继续后退', async () => {
    const goSpy = vi.spyOn(window.history, 'go')
    confirmMock.mockResolvedValue(true)
    renderHarness(true)

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(goSpy).toHaveBeenCalledWith(-1))
  })

  it('popstate 落在哨兵条目上不触发确认（前进/惯性场景）', async () => {
    renderHarness(true)
    const sentinelState = window.history.state

    window.dispatchEvent(new PopStateEvent('popstate', { state: sentinelState }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmMock).not.toHaveBeenCalled()
  })
})

function isSentinelCurrentEntry(): boolean {
  const state = window.history.state as Record<string, unknown> | null
  return Boolean(state && typeof state === 'object' && '__hsfGuard' in state)
}
