import { useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * 虚拟网格滚动 Hook
 * 基于 @tanstack/react-virtual 的 useVirtualizer，支持 grid 模式
 *
 * @param options.columnCount - 网格列数
 * @param options.estimateSize - 预估行高（px）
 * @param options.overscan - 预渲染额外行数（默认 5）
 * @param options.count - 数据总条数（用于计算总行数）
 * @param options.getScrollElement - 获取滚动容器的函数
 */
export function useVirtualGrid<T extends HTMLElement | null>(options: {
  columnCount: number;
  estimateSize: () => number;
  overscan?: number;
  count: number;
  getScrollElement: () => T;
}) {
  const {
    columnCount,
    estimateSize,
    overscan = 5,
    count,
    getScrollElement,
  } = options;

  // 计算总行数：向上取整
  const rowCount = Math.ceil(count / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan,
  });

  // 虚拟化后的行数据
  const virtualRows = virtualizer.getVirtualItems();

  // 容器总高度
  const totalHeight = virtualizer.getTotalSize();

  /**
   * 根据虚拟行的索引获取对应的数据索引范围
   * 用于将虚拟行映射到实际数据项
   */
  const getRowDataRange = (virtualRowIndex: number) => {
    const start = virtualRowIndex * columnCount;
    const end = Math.min(start + columnCount, count);
    return { start, end };
  };

  /**
   * 测量指定索引的实际尺寸并更新虚拟化器缓存
   */
  const measure = (index: number) => {
    virtualizer.measure();
  };

  /**
   * 滚动到指定索引
   */
  const scrollToIndex = (index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto'; behavior?: 'smooth' | 'instant' }) => {
    const targetRowIndex = Math.floor(index / columnCount);
    virtualizer.scrollToIndex(targetRowIndex, options);
  };

  /**
   * 滚动到顶部
   */
  const scrollToTop = (options?: { behavior?: 'smooth' | 'instant' }) => {
    virtualizer.scrollToOffset(0, options);
  };

  // 当列数或数据量变化时重新测量
  useEffect(() => {
    virtualizer.measure();
  }, [columnCount, count]);

  return {
    virtualizer,
    virtualRows,
    totalHeight,
    rowCount,
    columnCount,
    getRowDataRange,
    measure,
    scrollToIndex,
    scrollToTop,
  };
}

export type UseVirtualGridReturn = ReturnType<typeof useVirtualGrid>;
