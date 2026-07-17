const PRESSABLE_SELECTOR = 'button, a[href], [role="button"], [role="link"], [data-pressable]'
const RIPPLE_CLASS = 'material-ripple'
const STATE_LAYER_CLASS = 'material-state-layer'
const RIPPLE_SURFACE_CLASS = 'material-ripple-surface'
const RIPPLE_FALLBACK_SIZE = 44
const RIPPLE_CLEANUP_DELAY = 700
const CARD_FEEDBACK_MIN_HEIGHT = 64
const CARD_FEEDBACK_MIN_AREA = 12_000

type PressFeedbackVariant = 'ripple' | 'state' | 'inline'

type PressPoint = {
  clientX: number
  clientY: number
}

const isPressable = (element: Element): boolean => {
  if (
    element.getAttribute('data-press-feedback') === 'none' ||
    element.getAttribute('aria-disabled') === 'true'
  ) {
    return false
  }

  return !(element instanceof HTMLButtonElement && element.disabled)
}

const findPressable = (target: EventTarget | null): Element | null => {
  if (!(target instanceof Element)) {
    return null
  }

  const element = target.closest(PRESSABLE_SELECTOR)
  return element && isPressable(element) ? element : null
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
  point?: PressPoint
): DOMRect => {
  if (variant !== 'inline') {
    return element.getBoundingClientRect()
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

  return lineRects[0] || element.getBoundingClientRect()
}

const createPressFeedback = (
  element: Element,
  onRemove: (surface: HTMLSpanElement) => void,
  point?: PressPoint
): HTMLSpanElement => {
  const ownerDocument = element.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  const computedStyle = ownerWindow?.getComputedStyle(element)
  const initialRect = element.getBoundingClientRect()
  const variant = resolveVariant(element, initialRect, computedStyle)
  const rect = resolveFeedbackRect(element, variant, point)
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

  const removeRipple = () => {
    surface.remove()
    onRemove(surface)
  }
  feedbackLayer.addEventListener('animationend', removeRipple, { once: true })
  ownerWindow?.setTimeout(removeRipple, RIPPLE_CLEANUP_DELAY)

  return surface
}

export const initPressFeedback = (root: Document | HTMLElement = document): (() => void) => {
  const activeSurfaces = new Map<HTMLSpanElement, Element>()
  const ownerDocument = root instanceof Document ? root : root.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  let staleCheckTimer: number | undefined

  const removeSurface = (surface: HTMLSpanElement) => {
    activeSurfaces.delete(surface)
  }

  const removeActiveSurfaces = () => {
    activeSurfaces.forEach((_element, surface) => surface.remove())
    activeSurfaces.clear()
  }

  const removeStaleSurfaces = () => {
    activeSurfaces.forEach((element, surface) => {
      const rect = element.getBoundingClientRect()
      const hasMoved =
        Math.abs(rect.top - Number.parseFloat(surface.style.top)) > 0.5 ||
        Math.abs(rect.left - Number.parseFloat(surface.style.left)) > 0.5 ||
        Math.abs(rect.width - Number.parseFloat(surface.style.width)) > 0.5 ||
        Math.abs(rect.height - Number.parseFloat(surface.style.height)) > 0.5

      if (!element.isConnected || hasMoved) {
        surface.remove()
        activeSurfaces.delete(surface)
      }
    })
  }

  const scheduleStaleSurfaceCheck = () => {
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

  const showFeedback = (element: Element, point?: PressPoint) => {
    const surface = createPressFeedback(element, removeSurface, point)
    activeSurfaces.set(surface, element)
  }

  const handlePointerDown = (event: Event) => {
    const pointerEvent = event as PointerEvent
    if (pointerEvent.button !== 0) {
      return
    }

    const element = findPressable(pointerEvent.target)
    if (element) {
      showFeedback(element, pointerEvent)
    }
  }

  const handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.repeat || (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ')) {
      return
    }

    const element = findPressable(keyboardEvent.target)
    if (element) {
      showFeedback(element)
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
