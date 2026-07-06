import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@/src/components/icons'
import { clsx } from 'clsx'

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
const NAV_BUTTON_CLASS = clsx(
  'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded px-2.5 py-1 text-xs',
  'border transition-all',
  'disabled:cursor-not-allowed disabled:opacity-50'
)
const INACTIVE_NAV_BUTTON_CLASS = clsx(
  NAV_BUTTON_CLASS,
  'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-secondary hover:border-brand-gold hover:bg-[var(--book-panel-hover)] hover:text-brand-gold'
)
const INACTIVE_NAV_BUTTON_WITH_GAP_CLASS = clsx(INACTIVE_NAV_BUTTON_CLASS, 'gap-1')

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

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPageSizeSelector = false,
}) => {
  if (totalPages <= 0) return null

  const handlePrev = () => {
    if (page > 1) {
      onPageChange(page - 1)
    }
  }

  const handleNext = () => {
    if (page < totalPages) {
      onPageChange(page + 1)
    }
  }

  const handleFirst = () => {
    if (page > 1) {
      onPageChange(1)
    }
  }

  const handleLast = () => {
    if (page < totalPages) {
      onPageChange(totalPages)
    }
  }

  const pageNumbers = generatePageNumbers(page, totalPages)

  return (
    <footer
      className="mt-6 flex flex-col gap-3 border-t border-[var(--book-ink-line)] px-0 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4 md:px-6"
      role="navigation"
      aria-label="分页导航"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-text-muted" aria-live="polite" aria-atomic="true">
          第 {Math.min(page, totalPages)} / {totalPages} 页
        </p>
        {showPageSizeSelector && pageSize && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="每页显示条数"
              className="theme-input text-xs rounded px-2 py-1 cursor-pointer"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1">
        <button
          onClick={handleFirst}
          disabled={page <= 1}
          aria-label="首页"
          aria-disabled={page <= 1}
          className={INACTIVE_NAV_BUTTON_CLASS}
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={handlePrev}
          disabled={page <= 1}
          aria-label="上一页"
          aria-disabled={page <= 1}
          className={INACTIVE_NAV_BUTTON_WITH_GAP_CLASS}
        >
          <ChevronLeft size={14} />
        </button>

        {pageNumbers.map((item, index) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="shrink-0 cursor-default px-1 text-xs text-text-muted"
              aria-hidden="true"
            >
              ...
            </span>
          ) : (
            <button
              key={item}
              onClick={() => onPageChange(item)}
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? 'page' : undefined}
              className={clsx(
                NAV_BUTTON_CLASS,
                item === page
                  ? 'bg-[var(--color-theme-accent)] text-white border-[var(--color-theme-accent)]'
                  : 'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-secondary hover:border-brand-gold hover:bg-[var(--book-panel-hover)] hover:text-brand-gold'
              )}
            >
              {item}
            </button>
          )
        )}

        <button
          onClick={handleNext}
          disabled={page >= totalPages}
          aria-label="下一页"
          aria-disabled={page >= totalPages}
          className={INACTIVE_NAV_BUTTON_WITH_GAP_CLASS}
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={handleLast}
          disabled={page >= totalPages}
          aria-label="末页"
          aria-disabled={page >= totalPages}
          className={INACTIVE_NAV_BUTTON_CLASS}
        >
          <ChevronsRight size={14} />
        </button>
      </div>
    </footer>
  )
}

export default Pagination
