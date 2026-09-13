// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TRANSITION_MS, useFloatingPresence } from '../../../src/hooks/useFloatingPresence'

const PresenceProbe = ({ open }: { open: boolean }) => {
  const presence = useFloatingPresence(open)

  if (!presence.mounted) return <div data-testid="presence">unmounted</div>

  return <div data-testid="presence">{presence.state}</div>
}

describe('useFloatingPresence', () => {
  beforeEach(() => {
    cleanup()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('mounts closed first, then opens on the next animation frame', () => {
    const { rerender } = render(<PresenceProbe open={false} />)
    expect(screen.getByTestId('presence')).toHaveTextContent('unmounted')

    rerender(<PresenceProbe open />)
    expect(screen.getByTestId('presence')).toHaveTextContent('closed')

    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('closed')

    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(screen.getByTestId('presence')).toHaveTextContent('open')
  })

  it('关闭动画进行中重新打开时立即恢复展开，不再走两帧预热也不卸载', () => {
    const { rerender } = render(<PresenceProbe open />)

    act(() => {
      vi.advanceTimersByTime(32)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('open')

    rerender(<PresenceProbe open={false} />)
    expect(screen.getByTestId('presence')).toHaveTextContent('closed')

    // 卸载延迟内连续点击重新打开：元素仍挂载且已绘制过收起态，应立即回到 open
    rerender(<PresenceProbe open />)
    expect(screen.getByTestId('presence')).toHaveTextContent('open')

    // 之前的卸载计时器已被取消，不会把菜单意外卸载
    act(() => {
      vi.advanceTimersByTime(FLOATING_TRANSITION_MS + 100)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('open')
  })

  it('打开预热未完成就收起再重开，重新预热后仍能展开', () => {
    const { rerender } = render(<PresenceProbe open={false} />)

    rerender(<PresenceProbe open />)
    // 两帧预热未完成就收起：取消预热并安排卸载
    rerender(<PresenceProbe open={false} />)
    // 卸载前重开：从未展开过（entered=false），需要重新预热
    rerender(<PresenceProbe open />)

    act(() => {
      vi.advanceTimersByTime(32)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('open')

    act(() => {
      vi.advanceTimersByTime(FLOATING_TRANSITION_MS + 100)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('open')
  })

  it('keeps mounted while closing, then unmounts after the transition duration', () => {
    const { rerender } = render(<PresenceProbe open />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    rerender(<PresenceProbe open={false} />)
    expect(screen.getByTestId('presence')).toHaveTextContent('closed')

    act(() => {
      vi.advanceTimersByTime(FLOATING_TRANSITION_MS - 1)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('closed')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('presence')).toHaveTextContent('unmounted')
  })
})
