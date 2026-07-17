import React from 'react'
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
}

export default Pagination
