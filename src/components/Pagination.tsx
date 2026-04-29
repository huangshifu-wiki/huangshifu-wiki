import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

  return (
    <footer className="px-4 md:px-6 py-3 border-t border-[#e0dcd3] flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-[#9e968e]">
          第 {Math.min(page, totalPages)} / {totalPages} 页
        </p>
        {showPageSizeSelector && pageSize && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9e968e]">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
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
          onClick={handlePrev}
          disabled={page <= 1}
          className={clsx(
            'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          <ChevronLeft size={14} /> 上一页
        </button>
        <button
          onClick={handleNext}
          disabled={page >= totalPages}
          className={clsx(
            'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded',
            'border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
          )}
        >
          下一页 <ChevronRight size={14} />
        </button>
      </div>
    </footer>
  );
};

export default Pagination;
