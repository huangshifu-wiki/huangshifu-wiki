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
const NAV_BTN = clsx(
  'inline-flex h-9 min-w-[36px] shrink-0 items-center justify-center rounded border',
  'border-[var(--book-ink-line)] text-text-muted transition-colors',
  'hover:border-brand-gold/50 hover:text-brand-gold',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--book-ink-line)] disabled:hover:text-text-muted'
)

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

  return (
    <footer
      className="mt-6 flex flex-col gap-3 border-t border-[var(--book-ink-line)] pt-4 sm:flex-row sm:items-center sm:justify-between"
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
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="每页显示条数"
              className="cursor-pointer rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-1.5 py-0.5 text-xs text-text-primary"
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
      <div className="-mx-0.5 flex items-center gap-1 overflow-x-auto px-0.5">
        <button
          onClick={handleFirst}
          disabled={page <= 1}
          aria-label="首页"
          aria-disabled={page <= 1}
          className={NAV_BTN}
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={handlePrev}
          disabled={page <= 1}
          aria-label="上一页"
          aria-disabled={page <= 1}
          className={NAV_BTN}
        >
          <ChevronLeft size={14} />
        </button>

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
            <button
              key={item}
              onClick={() => onPageChange(item)}
              aria-label={`第 ${item} 页`}
              aria-current={item === page ? 'page' : undefined}
              className={clsx(
                'inline-flex h-9 min-w-[36px] shrink-0 items-center justify-center rounded px-2 text-xs transition-all',
                item === page
                  ? 'bg-brand-gold font-medium text-white'
                  : 'border border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold'
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
          className={NAV_BTN}
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={handleLast}
          disabled={page >= totalPages}
          aria-label="末页"
          aria-disabled={page >= totalPages}
          className={NAV_BTN}
        >
          <ChevronsRight size={14} />
        </button>
      </div>
    </footer>
  )
}

export default Pagination
