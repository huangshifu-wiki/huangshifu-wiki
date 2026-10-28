/**
 * 使用 Intersection Observer 检测元素可见性
 * 用于懒加载和首屏检测
 */

import { useEffect, useRef, useState, useCallback } from 'react'

export interface UseIntersectionObserverOptions {
  threshold?: number | number[]
  root?: Element | null
  rootMargin?: string
  triggerOnce?: boolean
  /**
   * 可选的外部 ref，用于与组件内部的 ref 共享
   */
  externalRef?: React.RefObject<HTMLElement | null>
}

export interface UseIntersectionObserverReturn {
  isIntersecting: boolean
  hasIntersected: boolean
  entry: IntersectionObserverEntry | null
  ref: React.RefObject<HTMLElement | null>
}

/**
 * 使用 Intersection Observer 检测元素是否进入视口
 */
export function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverReturn {
  const {
    threshold = 0,
    root = null,
    rootMargin = '0px',
    triggerOnce = false,
    externalRef,
  } = options

  const [isIntersecting, setIsIntersecting] = useState(false)
  const [hasIntersected, setHasIntersected] = useState(false)
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null)
  const internalRef = useRef<HTMLElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // 使用外部 ref 或内部 ref
  const ref = externalRef || internalRef

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // 清理之前的 observer
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setEntry(entry)
        setIsIntersecting(entry.isIntersecting)

        if (entry.isIntersecting) {
          setHasIntersected(true)

          // 如果 triggerOnce 为 true，取消观察
          if (triggerOnce && observerRef.current) {
            observerRef.current.unobserve(element)
          }
        }
      },
      { threshold, root, rootMargin }
    )

    observerRef.current.observe(element)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [threshold, root, rootMargin, triggerOnce, ref])

  return { isIntersecting, hasIntersected, entry, ref }
}

/**
 * 检测元素是否在首屏（用于自动设置 fetchpriority）
 */
export function useAboveTheFold(options: Omit<UseIntersectionObserverOptions, 'rootMargin'> = {}): {
  isAboveTheFold: boolean
  ref: React.RefObject<HTMLElement | null>
} {
  const [isAboveTheFold, setIsAboveTheFold] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // 立即检查是否在首屏
    const checkAboveTheFold = () => {
      const rect = element.getBoundingClientRect()
      const windowHeight = window.innerHeight || document.documentElement.clientHeight
      const isInFold = rect.top < windowHeight && rect.bottom > 0
      setIsAboveTheFold(isInFold)
    }

    // 初始检查
    checkAboveTheFold()

    // 使用 Intersection Observer 持续监测
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsAboveTheFold(true)
        }
      },
      {
        threshold: 0,
        rootMargin: '0px',
        ...options,
      }
    )

    observer.observe(element)

    // 监听滚动事件进行额外检查
    const handleScroll = () => {
      checkAboveTheFold()
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', handleScroll)
    }
  }, [options.threshold])

  return { isAboveTheFold, ref }
}

/**
 * 延迟加载 Hook - 元素进入视口后才加载
 */
export function useLazyLoad<T extends HTMLElement>(
  options: UseIntersectionObserverOptions = {}
): {
  shouldLoad: boolean
  ref: React.RefObject<T | null>
  isIntersecting: boolean
} {
  const { isIntersecting, hasIntersected, ref } = useIntersectionObserver({
    ...options,
    triggerOnce: true,
  })

  return {
    shouldLoad: hasIntersected,
    ref: ref as React.RefObject<T | null>,
    isIntersecting,
  }
}

/**
 * 批量懒加载 - 用于图片列表
 */
export function useBatchLazyLoad(
  itemCount: number,
  options: UseIntersectionObserverOptions = {}
): {
  loadStates: boolean[]
  setItemRef: (index: number) => (el: HTMLElement | null) => void
} {
  const [loadStates, setLoadStates] = useState<boolean[]>(() => Array(itemCount).fill(false))
  const observersRef = useRef<Map<number, IntersectionObserver>>(new Map())
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map())

  const setItemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (!el) {
        // 清理已移除元素的 observer
        const existingObserver = observersRef.current.get(index)
        if (existingObserver) {
          const existingElement = elementsRef.current.get(index)
          if (existingElement) {
            existingObserver.unobserve(existingElement)
          }
          observersRef.current.delete(index)
          elementsRef.current.delete(index)
        }
        return
      }

      elementsRef.current.set(index, el)

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setLoadStates((prev) => {
              const newStates = [...prev]
              newStates[index] = true
              return newStates
            })

            // 加载后取消观察
            observer.unobserve(el)
            observersRef.current.delete(index)
          }
        },
        { threshold: 0, rootMargin: '50px', ...options }
      )

      observer.observe(el)
      observersRef.current.set(index, observer)
    },
    [options]
  )

  // 清理所有 observers
  useEffect(() => {
    return () => {
      observersRef.current.forEach((observer, index) => {
        const element = elementsRef.current.get(index)
        if (element) {
          observer.unobserve(element)
        }
      })
      observersRef.current.clear()
      elementsRef.current.clear()
    }
  }, [])

  return { loadStates, setItemRef }
}
