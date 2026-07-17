import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initPressFeedback } from '@/src/utils/pressFeedback'

const dispatchPointerDown = (
  target: Element,
  options: { button?: number; clientX?: number; clientY?: number } = {}
) => {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  })

  target.dispatchEvent(event)
}

const getSurface = () => document.body.querySelector<HTMLElement>('.material-ripple-surface')

const getRipple = () => document.body.querySelector<HTMLElement>('.material-ripple')

const getStateLayer = () => document.body.querySelector<HTMLElement>('.material-state-layer')

describe('pressFeedback', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    cleanup = initPressFeedback()
  })

  afterEach(() => {
    cleanup?.()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('从嵌套图标的触点创建独立且受按钮边界裁切的涟漪', () => {
    const button = document.createElement('button')
    button.dataset.pressable = ''
    const icon = document.createElement('svg')
    button.append(icon)
    document.body.append(button)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })

    dispatchPointerDown(icon, { clientX: 30, clientY: 30 })

    const surface = getSurface()
    const ripple = getRipple()
    expect(button.children).toHaveLength(1)
    expect(surface?.parentElement).toBe(document.body)
    expect(surface?.style.left).toBe('10px')
    expect(surface?.style.top).toBe('20px')
    expect(surface?.style.width).toBe('100px')
    expect(surface?.style.height).toBe('40px')
    expect(surface).toHaveAttribute('aria-hidden', 'true')
    expect(ripple).not.toBeNull()
    expect(ripple?.style.width).toBe(ripple?.style.height)
    expect(Number.parseFloat(ripple?.style.left || '')).toBeLessThan(20)
  })

  it.each(['Enter', ' '])('键盘 %s 从按钮中心创建涟漪', (key) => {
    const button = document.createElement('button')
    button.dataset.pressable = ''
    document.body.append(button)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 80,
      bottom: 40,
      width: 80,
      height: 40,
      toJSON: () => ({}),
    })

    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))

    const ripple = getRipple()
    const diameter = Number.parseFloat(ripple?.style.width || '')
    expect(ripple).not.toBeNull()
    expect(Number.parseFloat(ripple?.style.left || '')).toBeCloseTo(40 - diameter / 2)
    expect(Number.parseFloat(ripple?.style.top || '')).toBeCloseTo(20 - diameter / 2)
  })

  it('支持显式标记的按钮式链接', () => {
    const link = document.createElement('a')
    link.dataset.pressable = ''
    document.body.append(link)

    dispatchPointerDown(link)

    expect(getRipple()).not.toBeNull()
  })

  it('自动覆盖带背景的紧凑链接并使用涟漪反馈', () => {
    const link = document.createElement('a')
    link.href = '/wiki'
    link.style.display = 'inline-flex'
    link.style.backgroundColor = 'rgb(120, 90, 40)'
    document.body.append(link)
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 90,
      bottom: 60,
      width: 80,
      height: 40,
      toJSON: () => ({}),
    })

    dispatchPointerDown(link, { clientX: 30, clientY: 30 })

    expect(getSurface()?.dataset.pressVariant).toBe('ripple')
    expect(getRipple()).not.toBeNull()
  })

  it('自动覆盖声明悬停背景的元素', () => {
    const button = document.createElement('button')
    button.className = 'rounded hover:bg-surface-alt'
    document.body.append(button)

    dispatchPointerDown(button)

    expect(getRipple()).not.toBeNull()
  })

  it('无背景和边框的文字按钮不创建背景动画', () => {
    const button = document.createElement('button')
    button.className =
      'border border-transparent text-brand-gold hover:bg-transparent hover:underline'
    button.style.border = '1px solid transparent'
    document.body.append(button)

    dispatchPointerDown(button)

    expect(getSurface()).toBeNull()
  })

  it('大型链接和 role button 使用克制状态层', () => {
    const cardLink = document.createElement('a')
    cardLink.href = '/gallery/1'
    cardLink.style.display = 'block'
    cardLink.style.backgroundColor = 'rgb(245, 240, 230)'
    document.body.append(cardLink)
    vi.spyOn(cardLink, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 120,
      width: 240,
      height: 120,
      toJSON: () => ({}),
    })

    dispatchPointerDown(cardLink, { clientX: 30, clientY: 30 })

    expect(getSurface()?.dataset.pressVariant).toBe('state')
    expect(getStateLayer()).not.toBeNull()

    const customButton = document.createElement('div')
    customButton.setAttribute('role', 'button')
    customButton.style.border = '1px solid currentColor'
    document.body.append(customButton)
    vi.spyOn(customButton, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 80,
      width: 200,
      height: 80,
      toJSON: () => ({}),
    })

    dispatchPointerDown(customButton, { clientX: 30, clientY: 30 })

    expect(document.body.querySelectorAll('[data-press-variant="state"]')).toHaveLength(2)
  })

  it('开关保持轨道尺寸并使用状态层而不是圆形涟漪', () => {
    const toggle = document.createElement('button')
    toggle.setAttribute('role', 'switch')
    toggle.setAttribute('aria-label', '启用功能')
    document.body.append(toggle)
    vi.spyOn(toggle, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 58,
      bottom: 44,
      width: 48,
      height: 24,
      toJSON: () => ({}),
    })

    dispatchPointerDown(toggle, { clientX: 30, clientY: 30 })

    expect(getSurface()?.style.width).toBe('48px')
    expect(getSurface()?.style.height).toBe('24px')
    expect(getSurface()?.dataset.pressVariant).toBe('state')
    expect(getStateLayer()).not.toBeNull()
    expect(getRipple()).toBeNull()
  })

  it('普通正文链接不创建背景动画', () => {
    const link = document.createElement('a')
    link.href = '/wiki/example'
    document.body.append(link)
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 130,
      bottom: 60,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    })
    vi.spyOn(link, 'getClientRects').mockReturnValue([
      {
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 130,
        bottom: 38,
        width: 120,
        height: 18,
        toJSON: () => ({}),
      },
      {
        x: 10,
        y: 42,
        left: 10,
        top: 42,
        right: 70,
        bottom: 60,
        width: 60,
        height: 18,
        toJSON: () => ({}),
      },
    ] as unknown as DOMRectList)

    dispatchPointerDown(link, { clientX: 30, clientY: 50 })

    expect(getSurface()).toBeNull()
  })

  it('嵌套控件只反馈最内层交互元素', () => {
    const card = document.createElement('div')
    card.setAttribute('role', 'button')
    card.dataset.pressable = ''
    const button = document.createElement('button')
    button.dataset.pressable = ''
    card.append(button)
    document.body.append(card)

    dispatchPointerDown(button)

    expect(getSurface()?.dataset.pressVariant).toBe('ripple')
    expect(getRipple()).not.toBeNull()
    expect(getStateLayer()).toBeNull()
  })

  it.each(['ripple', 'state', 'inline'] as const)('支持显式指定 %s 反馈', (variant) => {
    const element = document.createElement('div')
    element.dataset.pressable = ''
    element.dataset.pressFeedback = variant
    document.body.append(element)

    dispatchPointerDown(element)

    expect(getSurface()?.dataset.pressVariant).toBe(variant)
  })

  it('显式行内反馈不会因裁切矩形小于元素矩形而被误清理', () => {
    vi.useFakeTimers()
    const link = document.createElement('a')
    link.dataset.pressable = ''
    link.dataset.pressFeedback = 'inline'
    document.body.append(link)
    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 130,
      bottom: 60,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    })
    vi.spyOn(link, 'getClientRects').mockReturnValue([
      {
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 70,
        bottom: 38,
        width: 60,
        height: 18,
        toJSON: () => ({}),
      },
    ] as unknown as DOMRectList)

    dispatchPointerDown(link, { clientX: 30, clientY: 30 })
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    vi.advanceTimersByTime(0)

    expect(getSurface()).not.toBeNull()
  })

  it.each([
    ['禁用按钮', '<button disabled></button>'],
    ['aria-disabled 元素', '<a data-pressable aria-disabled="true"></a>'],
    ['显式退出元素', '<button data-press-feedback="none"></button>'],
  ])('%s 不创建涟漪', (_name, markup) => {
    document.body.innerHTML = markup
    const target = document.body.firstElementChild!

    dispatchPointerDown(target)

    expect(getSurface()).toBeNull()
  })

  it('忽略非主键点击和键盘长按', () => {
    const button = document.createElement('button')
    button.dataset.pressable = ''
    document.body.append(button)

    dispatchPointerDown(button, { button: 2 })
    button.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', repeat: true })
    )

    expect(getRipple()).toBeNull()
  })

  it('在动画结束或兜底超时后清理涟漪', () => {
    vi.useFakeTimers()
    const button = document.createElement('button')
    button.dataset.pressable = ''
    document.body.append(button)

    dispatchPointerDown(button)
    const firstSurface = getSurface()!
    const firstRipple = getRipple()!
    firstRipple.dispatchEvent(new Event('animationend'))
    expect(firstSurface).not.toBeInTheDocument()
    expect(firstRipple).not.toBeInTheDocument()

    dispatchPointerDown(button)
    const secondSurface = getSurface()!
    vi.advanceTimersByTime(700)
    expect(secondSurface).not.toBeInTheDocument()
  })

  it('滚动、窗口变化和卸载时立即清理动画层', () => {
    const button = document.createElement('button')
    button.dataset.pressable = ''
    document.body.append(button)

    dispatchPointerDown(button)
    document.dispatchEvent(new Event('scroll'))
    expect(getSurface()).toBeNull()

    dispatchPointerDown(button)
    window.dispatchEvent(new Event('resize'))
    expect(getSurface()).toBeNull()

    dispatchPointerDown(button)
    cleanup?.()
    cleanup = undefined
    expect(getSurface()).toBeNull()
  })

  it('按钮在点击后消失或移动时清理原位置的动画层', () => {
    vi.useFakeTimers()
    const button = document.createElement('button')
    button.dataset.pressable = ''
    document.body.append(button)
    const rectSpy = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })

    dispatchPointerDown(button, { clientX: 30, clientY: 30 })
    rectSpy.mockReturnValue({
      x: 110,
      y: 120,
      left: 110,
      top: 120,
      right: 210,
      bottom: 160,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(getSurface()).not.toBeNull()
    vi.advanceTimersByTime(0)
    expect(getSurface()).toBeNull()

    dispatchPointerDown(button, { clientX: 130, clientY: 130 })
    button.remove()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    vi.advanceTimersByTime(0)
    expect(getSurface()).toBeNull()
  })

  it('在 React 事件结束后的提交阶段之后清理失效动画层', () => {
    vi.useFakeTimers()
    const link = document.createElement('a')
    link.href = '/next'
    link.dataset.pressable = ''
    link.addEventListener('click', (event) => event.preventDefault())
    document.body.append(link)

    dispatchPointerDown(link)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    link.remove()

    expect(getSurface()).not.toBeNull()
    vi.advanceTimersByTime(0)
    expect(getSurface()).toBeNull()

    const customLink = document.createElement('div')
    customLink.setAttribute('role', 'link')
    customLink.dataset.pressable = ''
    document.body.append(customLink)
    customLink.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    customLink.remove()

    expect(getSurface()).not.toBeNull()
    vi.advanceTimersByTime(0)
    expect(getSurface()).toBeNull()
  })
})
