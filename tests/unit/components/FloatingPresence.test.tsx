// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FLOATING_TRANSITION_MS,
  useFloatingPresence,
} from '../../../src/hooks/useFloatingPresence'

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
