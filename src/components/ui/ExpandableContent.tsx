import React, { useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/src/components/icons'
import { Button } from './actions'
import { cn } from './utils'
import styles from './ExpandableContent.module.css'

export interface ExpandableContentProps extends React.HTMLAttributes<HTMLDivElement> {
  previewHeight: number
  expandLabel: string
  collapseLabel: string
  contentClassName?: string
}

export const ExpandableContent = React.forwardRef<HTMLDivElement, ExpandableContentProps>(
  (
    {
      previewHeight,
      expandLabel,
      collapseLabel,
      contentClassName,
      className,
      children,
      onFocusCapture,
      ...props
    },
    ref
  ) => {
    const rootRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const contentId = useId()
    const [fullHeight, setFullHeight] = useState<number | null>(null)
    const [expanded, setExpanded] = useState(false)
    const [focusReveal, setFocusReveal] = useState(false)
    const canMeasure = typeof ResizeObserver !== 'undefined'
    const overflowing = fullHeight !== null && fullHeight > previewHeight + 1

    useImperativeHandle(ref, () => rootRef.current!)

    useLayoutEffect(() => {
      const content = contentRef.current
      if (!content || !canMeasure) return

      // 只观察正文的自然尺寸，不观察正在过渡的裁切视窗。
      const updateHeight = (height: number) => {
        setFullHeight(height)
        if (height <= previewHeight + 1) {
          setExpanded(false)
          setFocusReveal(false)
        }
      }
      updateHeight(content.getBoundingClientRect().height)
      const observer = new ResizeObserver(([entry]) => {
        updateHeight(entry.borderBoxSize[0].blockSize)
      })
      observer.observe(content, { box: 'border-box' })
      return () => observer.disconnect()
    }, [previewHeight, canMeasure])

    const toggleExpanded = () => {
      const root = rootRef.current!
      if (expanded) {
        const scrollMargin = parseFloat(getComputedStyle(root).scrollMarginTop)
        if (root.getBoundingClientRect().top < scrollMargin) {
          root.scrollIntoView({ block: 'start', behavior: 'instant' })
        }
      }
      setFocusReveal(false)
      setExpanded(!expanded)
    }

    return (
      <div
        {...props}
        ref={rootRef}
        className={cn(styles.root, className)}
        onFocusCapture={(event) => {
          onFocusCapture?.(event)
          const content = contentRef.current
          if (!overflowing || expanded || !content?.contains(event.target)) return
          const targetBottom = event.target.getBoundingClientRect().bottom
          if (targetBottom > content.getBoundingClientRect().top + previewHeight) {
            // 键盘进入被裁切的正文时立即揭示目标，不等待高度动画。
            setFocusReveal(true)
            setExpanded(true)
          }
        }}
      >
        <div
          id={contentId}
          className={styles.viewport}
          data-collapsed={overflowing && !expanded ? '' : undefined}
          data-animate={overflowing && !focusReveal ? '' : undefined}
          style={{
            maxHeight: canMeasure && fullHeight === null ? previewHeight : undefined,
            height: overflowing ? (expanded ? fullHeight : previewHeight) : undefined,
          }}
        >
          <div ref={contentRef} className={cn(styles.content, contentClassName)}>
            {children}
          </div>
        </div>
        {overflowing && (
          <div className={styles.actions}>
            <Button
              variant="ghost"
              data-press-feedback="inline"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={toggleExpanded}
              className="text-text-muted hover:text-brand-gold"
            >
              {expanded ? collapseLabel : expandLabel}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={styles.chevron}
                data-expanded={expanded ? '' : undefined}
              />
            </Button>
          </div>
        )}
      </div>
    )
  }
)
ExpandableContent.displayName = 'ExpandableContent'
