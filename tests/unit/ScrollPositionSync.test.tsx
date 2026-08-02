// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScrollPositionSync } from '../../src/components/ScrollPositionSync'

const NavButton = () => {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/wiki')}>
      跳转
    </button>
  )
}

const renderSync = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ScrollPositionSync />
    </MemoryRouter>
  )

const renderSyncWithNav = () =>
  render(
    <MemoryRouter initialEntries={['/music']}>
      <ScrollPositionSync />
      <NavButton />
    </MemoryRouter>
  )

describe('ScrollPositionSync', () => {
  beforeEach(() => {
    // 只 fake 宏任务计时器：若连同 queueMicrotask 一起 fake，会与 @testing-library 的
    // 异步 act 卡死（复现于 MemoryRouter 渲染）
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight
    delete (window as { scrollY?: number }).scrollY
  })

  it('恢复上次保存的滚动位置', () => {
    sessionStorage.setItem('scrollPos:/music', '1200')
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      configurable: true,
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    renderSync('/music')

    vi.advanceTimersByTime(100)

    expect(scrollToSpy).toHaveBeenCalledWith(0, 1200)
    expect(scrollToSpy).toHaveBeenCalledTimes(1)
  })

  it('内容未渲染够时不恢复，超时放弃', () => {
    sessionStorage.setItem('scrollPos:/music', '1200')
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 500,
      configurable: true,
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    renderSync('/music')

    vi.advanceTimersByTime(2000)

    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('滚动时保存当前位置', () => {
    // fake timers 对 rAF 行为依赖版本，直接同步执行节流回调以稳定断言
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })

    renderSync('/music')

    Object.defineProperty(window, 'scrollY', { value: 123, configurable: true })
    window.dispatchEvent(new Event('scroll'))

    expect(rafSpy).toHaveBeenCalled()
    expect(sessionStorage.getItem('scrollPos:/music')).toBe('123')
  })

  it('pathname 变化时恢复新页位置', () => {
    sessionStorage.setItem('scrollPos:/wiki', '800')
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      configurable: true,
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    renderSyncWithNav()

    fireEvent.click(screen.getByRole('button', { name: '跳转' }))
    vi.advanceTimersByTime(100)

    expect(scrollToSpy).toHaveBeenCalledWith(0, 800)
  })
})
