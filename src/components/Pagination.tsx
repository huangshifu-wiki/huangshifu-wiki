import React from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@/src/components/icons'
import { Button, IconButton, Select, cn } from '@/src/components/ui'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  pageSize?: number
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  showPageSizeSelector?: boolean
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
function generatePageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | 'ellipsis')[] = [1]

  if (current > 3) pages.push('ellipsis')

  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i)
  }

  if (current < total - 2) pages.push('ellipsis')

  pages.push(total)
  return pages
}

interface DockedPaginationLayout {
  height: number
  left: number
  width: number
}

function useDockedPagination(enabled: boolean) {
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const navigationRef = React.useRef<HTMLElement>(null)
  const portalHostRef = React.useRef<HTMLElement | null>(null)
  const [dockedLayout, setDockedLayout] = React.useState<DockedPaginationLayout | null>(null)

  React.useLayoutEffect(() => {
    if (!enabled) {
      portalHostRef.current = null
      setDockedLayout(null)
      return
    }

    const anchor = anchorRef.current
    if (!anchor) return

    const adminScrollContainer = anchor.closest('[data-admin-scroll-container]')
    const scrollTarget = adminScrollContainer instanceof HTMLElement ? adminScrollContainer : window
    const portalHost = anchor.closest('[data-bottom-navigation]')
    portalHostRef.current = portalHost instanceof HTMLElement ? portalHost : document.body

    let frameId: number | null = null
    let observedNavigation: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null

    const syncLayout = () => {
      const navigation = navigationRef.current
      if (!navigation) return

      if (resizeObserver && observedNavigation !== navigation) {
        if (observedNavigation) resizeObserver.unobserve(observedNavigation)
        resizeObserver.observe(navigation)
        observedNavigation = navigation
      }

      const anchorRect = anchor.getBoundingClientRect()
      const navigationRect = navigation.getBoundingClientRect()
      const computedBottom = Number.parseFloat(window.getComputedStyle(navigation).bottom)
      const bottomOffset = Number.isFinite(computedBottom) ? computedBottom : 0
      const shouldDock = anchorRect.top > window.innerHeight - bottomOffset - navigationRect.height

      setDockedLayout((current) => {
        if (!shouldDock) return current === null ? current : null

        const next = {
          height: navigationRect.height,
          left: anchorRect.left,
          width: anchorRect.width,
        }
        if (
          current?.height === next.height &&
          current.left === next.left &&
          current.width === next.width
        ) {
          return current
        }
        return next
      })
    }

    const scheduleSync = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        syncLayout()
      })
    }

    resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSync) : null
    mutationObserver =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleSync) : null
    if (mutationObserver && portalHostRef.current) {
      mutationObserver.observe(portalHostRef.current, {
        attributeFilter: ['data-music-player'],
        attributes: true,
      })
    }
    resizeObserver?.observe(anchor)
    syncLayout()
    scrollTarget.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      scrollTarget.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      portalHostRef.current = null
    }
  }, [enabled])

  return { anchorRef, navigationRef, portalHostRef, dockedLayout }
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPageSizeSelector = false,
}) => {
  const { anchorRef, navigationRef, portalHostRef, dockedLayout } = useDockedPagination(
    totalPages > 0
  )

  if (totalPages <= 0) return null

  const handlePrev = () => {
    if (page > 1) onPageChange(page - 1)
  }

  const handleNext = () => {
    if (page < totalPages) onPageChange(page + 1)
  }

  const handleFirst = () => {
    if (page > 1) onPageChange(1)
  }

  const handleLast = () => {
    if (page < totalPages) onPageChange(totalPages)
  }

  const pageNumbers = generatePageNumbers(page, totalPages)

  const navigation = (
    <footer
      ref={navigationRef}
      className={cn(
        'pagination-panel z-30 flex flex-col gap-3 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] px-2 py-2 shadow-[var(--book-panel-shadow)] backdrop-blur-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-3 sm:py-3',
        dockedLayout ? 'fixed' : 'static w-full'
      )}
      data-state={dockedLayout ? 'docked' : 'inline'}
      style={dockedLayout ? { left: dockedLayout.left, width: dockedLayout.width } : undefined}
      role="navigation"
      aria-label="分页导航"
    >
      <div className="flex items-center gap-3">
        <p className="text-xs text-text-muted" aria-live="polite" aria-atomic="true">
          第 {Math.min(page, totalPages)} / {totalPages} 页
        </p>
        {showPageSizeSelector && pageSize && onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">每页</span>
            <Select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="每页显示条数"
              className="w-auto cursor-pointer px-1.5 py-0.5 text-xs"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div className="-mx-0.5 flex items-center gap-1 overflow-x-auto px-0.5">
        <IconButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleFirst}
          disabled={page <= 1}
          aria-label="首页"
        >
          <ChevronsLeft size={14} />
        </IconButton>
        <IconButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={handlePrev}
          disabled={page <= 1}
          aria-label="上一页"
        >
          <ChevronLeft size={14} />
        </IconButton>

        {pageNumbers.map((item, index) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="shrink-0 px-1 text-xs text-text-muted/60"
              aria-hidden="true"
            >
              ...
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={item === page ? 'primary' : 'secondary'}
              key={item}
              onClick={() => onPageChange(item)}
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? 'page' : undefined}
              className={cn('h-8 min-w-8 shrink-0 px-2', item === page && 'font-medium')}
            >
              {item}
            </Button>
          )
        )}

        <IconButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleNext}
          disabled={page >= totalPages}
          aria-label="下一页"
        >
          <ChevronRight size={14} />
        </IconButton>
        <IconButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleLast}
          disabled={page >= totalPages}
          aria-label="末页"
        >
          <ChevronsRight size={14} />
        </IconButton>
      </div>
    </footer>
  )

  return (
    <div
      ref={anchorRef}
      className="mt-6"
      data-pagination-anchor
      style={dockedLayout ? { height: dockedLayout.height } : undefined}
    >
      {dockedLayout && portalHostRef.current
        ? createPortal(navigation, portalHostRef.current)
        : navigation}
    </div>
  )
}

export default Pagination
