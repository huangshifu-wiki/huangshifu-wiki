const PRESSABLE_SELECTOR = 'button, a[href], [role="button"], [role="link"], [data-pressable]'
const RIPPLE_CLASS = 'material-ripple'
const STATE_LAYER_CLASS = 'material-state-layer'
const RIPPLE_SURFACE_CLASS = 'material-ripple-surface'
const RIPPLE_FALLBACK_SIZE = 44
const RIPPLE_CLEANUP_DELAY = 700
const CARD_FEEDBACK_MIN_HEIGHT = 64
const CARD_FEEDBACK_MIN_AREA = 12_000
const SURFACE_CLASS_PATTERN = /(?:^|:)(?:theme-(?:button|icon-button)|(?:home|lsky)-btn)/

type PressFeedbackVariant = 'ripple' | 'state' | 'inline'

type PressPoint = {
  clientX: number
  clientY: number
}

type PressableTarget = {
  element: Element
  computedStyle?: CSSStyleDeclaration
}

type FeedbackHandle = {
  surface: HTMLSpanElement
  elementRect: DOMRect
  remove: () => void
}

type ActiveFeedback = Omit<FeedbackHandle, 'surface'> & {
  element: Element
}

const hasVisiblePaint = (value: string): boolean =>
  value !== '' && value !== 'none' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'

const hasSurfaceClass = (element: Element): boolean => {
  for (const className of element.classList) {
    const utility = className.slice(className.lastIndexOf(':') + 1)
    if (
      (utility.startsWith('bg-') && utility !== 'bg-transparent') ||
      SURFACE_CLASS_PATTERN.test(className)
    ) {
      return true
    }
  }
  return false
}

const resolveButtonSurfaceStyle = (element: Element): CSSStyleDeclaration | null | undefined => {
  if (
    element.hasAttribute('data-pressable') ||
    element.getAttribute('role') === 'switch' ||
    hasSurfaceClass(element)
  ) {
    return undefined
  }

  const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!computedStyle) {
    return null
  }

  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(
    (side) =>
      computedStyle.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
      Number.parseFloat(computedStyle.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      hasVisiblePaint(computedStyle.getPropertyValue(`border-${side.toLowerCase()}-color`))
  )

  return hasVisiblePaint(computedStyle.backgroundColor) ||
    hasVisiblePaint(computedStyle.backgroundImage) ||
    hasBorder
    ? computedStyle
    : null
}

const resolvePressable = (element: Element): PressableTarget | null => {
  if (
    element.getAttribute('data-press-feedback') === 'none' ||
    element.getAttribute('aria-disabled') === 'true' ||
    (element instanceof HTMLButtonElement && element.disabled)
  ) {
    return null
  }

  const computedStyle = resolveButtonSurfaceStyle(element)
  return computedStyle === null ? null : { element, computedStyle }
}

const findPressable = (target: EventTarget | null): PressableTarget | null => {
  if (!(target instanceof Element)) {
    return null
  }

  const element = target.closest(PRESSABLE_SELECTOR)
  return element ? resolvePressable(element) : null
}

const resolveVariant = (
  element: Element,
  rect: DOMRect,
  computedStyle?: CSSStyleDeclaration
): PressFeedbackVariant => {
  const requestedVariant = element.getAttribute('data-press-feedback')
  if (
    requestedVariant === 'ripple' ||
    requestedVariant === 'state' ||
    requestedVariant === 'inline'
  ) {
    return requestedVariant
  }

  if (element.getAttribute('role') === 'switch') {
    return 'state'
  }

  if (element instanceof HTMLButtonElement || element.hasAttribute('data-pressable')) {
    return 'ripple'
  }

  if (element.matches('a[href]') && computedStyle?.display === 'inline') {
    return 'inline'
  }

  return rect.height >= CARD_FEEDBACK_MIN_HEIGHT ||
    rect.width * rect.height >= CARD_FEEDBACK_MIN_AREA
    ? 'state'
    : 'ripple'
}

const resolveFeedbackRect = (
  element: Element,
  variant: PressFeedbackVariant,
  initialRect: DOMRect,
  point?: PressPoint
): DOMRect => {
  if (variant !== 'inline') {
    return initialRect
  }

  const lineRects = Array.from(element.getClientRects())
  if (point) {
    const touchedLine = lineRects.find(
      (rect) =>
        point.clientX >= rect.left &&
        point.clientX <= rect.right &&
        point.clientY >= rect.top &&
        point.clientY <= rect.bottom
    )
    if (touchedLine) {
      return touchedLine
    }
  }

  return lineRects[0] || initialRect
}

const createPressFeedback = (
  element: Element,
  onRemove: (surface: HTMLSpanElement) => void,
  point?: PressPoint,
  computedStyle?: CSSStyleDeclaration
): FeedbackHandle => {
  const ownerDocument = element.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  computedStyle ??= ownerWindow?.getComputedStyle(element)
  const initialRect = element.getBoundingClientRect()
  const variant = resolveVariant(element, initialRect, computedStyle)
  const rect = resolveFeedbackRect(element, variant, initialRect, point)
  const width = rect.width || element.clientWidth || RIPPLE_FALLBACK_SIZE
  const height = rect.height || element.clientHeight || RIPPLE_FALLBACK_SIZE
  const x = point ? Math.min(Math.max(point.clientX - rect.left, 0), width) : width / 2
  const y = point ? Math.min(Math.max(point.clientY - rect.top, 0), height) : height / 2
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y))
  const diameter = Math.max(radius * 2, RIPPLE_FALLBACK_SIZE)
  const surface = ownerDocument.createElement('span')
  const feedbackLayer = ownerDocument.createElement('span')

  surface.className = RIPPLE_SURFACE_CLASS
  surface.dataset.pressVariant = variant
  surface.setAttribute('aria-hidden', 'true')
  surface.style.top = `${rect.top}px`
  surface.style.left = `${rect.left}px`
  surface.style.width = `${width}px`
  surface.style.height = `${height}px`
  surface.style.borderRadius =
    variant === 'inline' ? '0.2rem' : computedStyle?.borderRadius || '0px'
  surface.style.color = computedStyle?.color || 'currentColor'

  if (variant === 'ripple') {
    feedbackLayer.className = RIPPLE_CLASS
    feedbackLayer.style.width = `${diameter}px`
    feedbackLayer.style.height = `${diameter}px`
    feedbackLayer.style.left = `${x - diameter / 2}px`
    feedbackLayer.style.top = `${y - diameter / 2}px`
  } else {
    feedbackLayer.className = STATE_LAYER_CLASS
  }

  surface.append(feedbackLayer)
  ownerDocument.body.append(surface)

  let removed = false
  let cleanupTimer: number | undefined
  const removeRipple = () => {
    if (removed) return
    removed = true
    feedbackLayer.removeEventListener('animationend', removeRipple)
    if (cleanupTimer !== undefined) ownerWindow?.clearTimeout(cleanupTimer)
    surface.remove()
    onRemove(surface)
  }
  feedbackLayer.addEventListener('animationend', removeRipple, { once: true })
  cleanupTimer = ownerWindow?.setTimeout(removeRipple, RIPPLE_CLEANUP_DELAY)

  return { surface, elementRect: initialRect, remove: removeRipple }
}

export const initPressFeedback = (root: Document | HTMLElement = document): (() => void) => {
  const activeSurfaces = new Map<HTMLSpanElement, ActiveFeedback>()
  const ownerDocument = root instanceof Document ? root : root.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  let staleCheckTimer: number | undefined

  const removeSurface = (surface: HTMLSpanElement) => {
    activeSurfaces.delete(surface)
  }

  const removeActiveSurfaces = () => {
    if (staleCheckTimer !== undefined) {
      ownerWindow?.clearTimeout(staleCheckTimer)
      staleCheckTimer = undefined
    }
    activeSurfaces.forEach(({ remove }) => remove())
  }

  const removeStaleSurfaces = () => {
    activeSurfaces.forEach(({ element, elementRect: initialRect, remove }) => {
      if (!element.isConnected) {
        remove()
        return
      }

      const rect = element.getBoundingClientRect()
      const hasMoved =
        Math.abs(rect.top - initialRect.top) > 0.5 ||
        Math.abs(rect.left - initialRect.left) > 0.5 ||
        Math.abs(rect.width - initialRect.width) > 0.5 ||
        Math.abs(rect.height - initialRect.height) > 0.5

      if (hasMoved) remove()
    })
  }

  const scheduleStaleSurfaceCheck = () => {
    if (activeSurfaces.size === 0) return

    if (!ownerWindow) {
      removeStaleSurfaces()
      return
    }

    if (staleCheckTimer !== undefined) {
      ownerWindow.clearTimeout(staleCheckTimer)
    }
    staleCheckTimer = ownerWindow.setTimeout(() => {
      staleCheckTimer = undefined
      removeStaleSurfaces()
    }, 0)
  }

  const showFeedback = ({ element, computedStyle }: PressableTarget, point?: PressPoint) => {
    const feedback = createPressFeedback(element, removeSurface, point, computedStyle)
    activeSurfaces.set(feedback.surface, {
      element,
      elementRect: feedback.elementRect,
      remove: feedback.remove,
    })
  }

  const handlePointerDown = (event: Event) => {
    const pointerEvent = event as PointerEvent
    if (pointerEvent.button !== 0) {
      return
    }

    const target = findPressable(pointerEvent.target)
    if (target) {
      showFeedback(target, pointerEvent)
    }
  }

  const handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.repeat || (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ')) {
      return
    }

    const target = findPressable(keyboardEvent.target)
    if (target) {
      showFeedback(target)
      scheduleStaleSurfaceCheck()
    }
  }

  root.addEventListener('pointerdown', handlePointerDown)
  root.addEventListener('keydown', handleKeyDown)
  root.addEventListener('click', scheduleStaleSurfaceCheck)
  root.addEventListener('scroll', removeActiveSurfaces, true)
  ownerWindow?.addEventListener('resize', removeActiveSurfaces)

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown)
    root.removeEventListener('keydown', handleKeyDown)
    root.removeEventListener('click', scheduleStaleSurfaceCheck)
    root.removeEventListener('scroll', removeActiveSurfaces, true)
    ownerWindow?.removeEventListener('resize', removeActiveSurfaces)
    if (staleCheckTimer !== undefined) {
      ownerWindow?.clearTimeout(staleCheckTimer)
    }
    removeActiveSurfaces()
  }
}
