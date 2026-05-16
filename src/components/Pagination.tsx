import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { clsx } from 'clsx';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function generatePageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | 'ellipsis')[] = [1];

  if (current > 3) pages.push('ellipsis');

  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push('ellipsis');

  pages.push(total);
  return pages;
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
  if (totalPages <= 0) return null;

  const handlePrev = () => {
    if (page > 1) {
      onPageChange(page - 1);
    }
  };

  const handleNext = () => {
    if (page < totalPages) {
      onPageChange(page + 1);
    }
  };

  const handleFirst = () => {
    if (page > 1) {
      onPageChange(1);
    }
  };

  const handleLast = () => {
    if (page < totalPages) {
      onPageChange(totalPages);
    }
  };

  const pageNumbers = generatePageNumbers(page, totalPages);

  return (
    <footer
      className="px-4 md:px-6 py-3 border-t border-[#e0dcd3] flex items-center justify-between flex-wrap gap-3"
      role="navigation"
      aria-label="分页导航"
    >
      <div className="flex items-center gap-3">
        <p
          className="text-xs text-[#9e968e]"
          aria-live="polite"
          aria-atomic="true"
        >
          第 {Math.min(page, totalPages)} / {totalPages} 页
        </p>
        {showPageSizeSelector && pageSize && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9e968e]">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="每页显示条数"
              className="text-xs border border-[#e0dcd3] rounded px-2 py-1 text-[#6b6560] bg-white hover:border-[#c8951e] cursor-pointer focus:outline-none"
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
      <div className="flex items-center gap-2">
        <button
          onClick={handleFirst}
          disabled={page <= 1}
          aria-label="首页"
          aria-disabled={page <= 1}
          className={clsx(
            'inline-flex items-center justify-center px-2.5 py-1 text-xs rounded min-h-[44px] min-w-[44px]',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={handlePrev}
          disabled={page <= 1}
          aria-label="上一页"
          aria-disabled={page <= 1}
          className={clsx(
            'inline-flex items-center justify-center gap-1 px-2.5 py-1 text-xs rounded min-h-[44px] min-w-[44px]',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          <ChevronLeft size={14} />
        </button>

        {pageNumbers.map((item, index) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="text-[#9e968e] px-1 cursor-default text-xs"
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
                'inline-flex items-center justify-center px-2.5 py-1 text-xs rounded border transition-all min-h-[44px] min-w-[44px]',
                item === page
                  ? 'bg-[#c8951e] text-white border-[#c8951e]'
                  : 'border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]'
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
          className={clsx(
            'inline-flex items-center justify-center gap-1 px-2.5 py-1 text-xs rounded min-h-[44px] min-w-[44px]',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={handleLast}
          disabled={page >= totalPages}
          aria-label="末页"
          aria-disabled={page >= totalPages}
          className={clsx(
            'inline-flex items-center justify-center px-2.5 py-1 text-xs rounded min-h-[44px] min-w-[44px]',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          <ChevronsRight size={14} />
        </button>
      </div>
    </footer>
  );
};

export default Pagination;
