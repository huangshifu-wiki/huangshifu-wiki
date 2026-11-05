import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExpandableContent } from '@/src/components/ui'

// jsdom 没有排版；用独立的自然尺寸与页面坐标提供浏览器几何输入。
const observers = new Set<LayoutObserver>()
class LayoutObserver {
  private target!: Element
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this)
  }
  observe(target: Element) {
    this.target = target
  }
  disconnect() {
    observers.delete(this)
  }
  notify() {
    const fixture = this.target.querySelector<HTMLElement>('[data-natural-height]')
    const entry = {
      borderBoxSize: [{ blockSize: Number(fixture?.dataset.naturalHeight || 0) }],
    } as unknown as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }
}
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)

beforeEach(() => {
  vi.stubGlobal('scrollY', 0)
  vi.stubGlobal('ResizeObserver', LayoutObserver)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement) {
      window.scrollY = 100 - parseFloat(getComputedStyle(this).scrollMarginTop)
    },
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const fixture = this.matches('[data-natural-height]')
      ? this
      : this.querySelector<HTMLElement>('[data-natural-height]')
    const naturalHeight = Number(fixture?.dataset.naturalHeight || 0)
    const height = this.style.height ? parseFloat(this.style.height) : naturalHeight
    const top = 100 - window.scrollY + Number(this.dataset.offset || 0)
    return new DOMRect(0, top, 320, this.matches('a') ? 20 : height)
  })
})
afterEach(() => {
  observers.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  }
})

function Example({ height = 900, identity = 'song-1' }: { height?: number; identity?: string }) {
  return (
    <ExpandableContent
      key={identity}
      style={{ scrollMarginTop: '80px' }}
      previewHeight={300}
      expandLabel="展开完整歌词"
      collapseLabel="收起歌词"
    >
      <div data-natural-height={height}>
        <p>正文开头</p>
        <a href="#end" data-offset={height - 20}>
          正文末尾
        </a>
      </div>
    </ExpandableContent>
  )
}

function notifyLayout() {
  act(() => {
    for (const observer of observers) observer.notify()
  })
}

function expectEndReachable() {
  const button = screen.getByRole('button', { name: '收起歌词' })
  const viewport = document.getElementById(button.getAttribute('aria-controls')!)!
  expect(screen.getByRole('link').getBoundingClientRect().bottom).toBeLessThanOrEqual(
    viewport.getBoundingClientRect().bottom
  )
}

describe('ExpandableContent 阅读行为', () => {
  it.each([0, 120, 300, 301, 302])('自然高度 %ipx 时只为溢出正文提供入口', (height) => {
    render(<Example height={height} />)
    expect(screen.getByText('正文开头')).toBeInTheDocument()
    if (height > 301) {
      expect(screen.getByRole('button', { name: '展开完整歌词' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    } else {
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    }
  })

  it.each(['click', 'Enter', 'Space'] as const)('%s 可以反复展开收起并保持焦点', async (method) => {
    const user = userEvent.setup()
    render(<Example />)
    const button = screen.getByRole('button', { name: '展开完整歌词' })
    button.focus()
    const activate = () =>
      method === 'click' ? user.click(button) : user.keyboard(method === 'Space' ? ' ' : '{Enter}')
    await activate()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expectEndReachable()
    await activate()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await activate()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveFocus()
    expectEndReachable()
  })

  it('正文尺寸变化后重新判断溢出并隔离新内容状态', async () => {
    const user = userEvent.setup()
    const view = render(<Example height={120} />)
    view.rerender(<Example height={900} />)
    notifyLayout()
    await user.click(screen.getByRole('button', { name: '展开完整歌词' }))
    view.rerender(<Example height={1200} />)
    notifyLayout()
    expectEndReachable()
    view.rerender(<Example height={120} />)
    notifyLayout()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(<Example height={900} />)
    notifyLayout()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button'))
    view.rerender(<Example height={900} identity="song-2" />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([0, 800])('隐藏链接聚焦可读，页面滚动到 %ipx 时收起定位正确', async (initialScroll) => {
    const user = userEvent.setup()
    window.scrollY = initialScroll
    render(<Example />)
    act(() => screen.getByRole('link').focus())
    expectEndReachable()
    expect(screen.getByRole('link')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '收起歌词' }))
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(window.scrollY).toBe(initialScroll === 0 ? 0 : 20)
  })
})
