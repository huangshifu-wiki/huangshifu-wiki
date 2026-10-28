// @vitest-environment jsdom
import React, { useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useScrollRestore } from '../../src/hooks/useScrollRestore'

const Harness = () => {
  const saveScroll = useScrollRestore()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tick, setTick] = useState(0)

  return (
    <div>
      <div data-admin-scroll-container ref={containerRef} />
      <button
        type="button"
        onClick={() => {
          saveScroll()
          // 模拟数据落地前滚动位置被外部干扰（如浏览器钳制），提交后应由 hook 恢复
          if (containerRef.current) containerRef.current.scrollTop = 0
          setTick((value) => value + 1)
        }}
      >
        save
      </button>
      <span>{tick}</span>
    </div>
  )
}

describe('useScrollRestore', () => {
  it('数据 commit 后恢复滚动位置', async () => {
    render(<Harness />)

    const container = document.querySelector('[data-admin-scroll-container]') as HTMLElement
    container.scrollTop = 120

    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(container.scrollTop).toBe(120))
  })
})
