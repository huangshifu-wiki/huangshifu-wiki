import { useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * 虚拟列表配置选项
 */
export interface VirtualListOptions<T = unknown> {
  /** 数据数组 */
  data: T[];
  /** 预估每项高度（像素），默认 120 */
  estimateSize?: number;
  /** 预渲染的额外项数，默认 5 */
  overscan?: number;
  /** 是否启用网格模式 */
  gridMode?: boolean;
  /** 网格模式下的列数，仅在 gridMode 为 true 时生效 */
  columns?: number;
  /** 是否启用按行虚拟化模式（仅在 gridMode=true 时生效）。
   *  开启后 virtualizer 按"行"计数（count = ceil(data.length/columns)），
   *  并提供 getRowDataRange 做二次数据映射。 */
  rowCountMode?: boolean;
  /** 滚动容器引用 */
  scrollRef?: React.RefObject<HTMLElement | null>;
}

/**
 * 虚拟列表返回值
 */
export interface VirtualListReturn<T> {
  /** @tanstack/react-virtual 的 virtualizer 实例 */
  virtualizer: ReturnType<typeof useVirtualizer>;
  /** 当前可见的虚拟项目数组 */
  virtualItems: ReturnType<typeof useVirtualizer>['getVirtualItems'] extends () => infer R ? R : never;
  /** 总内容高度 */
  totalSize: number;
  /** 滚动到指定索引 */
  scrollToIndex: (index: number, options?: ScrollIntoViewOptions) => void;
  /** 滚动到顶部 */
  scrollToTop: () => void;
  /** 滚动容器 ref 回调 */
  setScrollRef: (el: HTMLElement | null) => void;
  /**
   * 仅在 gridMode && rowCountMode 时有效。
   * 根据虚拟行索引获取对应的数据索引范围 { start, end }。
   * 用于将虚拟行映射到实际数据项（一行包含 columns 个数据项）。
   */
  getRowDataRange?: (virtualRowIndex: number) => { start: number; end: number };
}

/**
 * 通用虚拟滚动 Hook
 *
 * 使用 @tanstack/react-virtual 实现高性能虚拟滚动，
 * 支持单列列表和多列网格两种模式。
 *
 * @example
 * ```tsx
 * const { virtualizer, virtualItems, totalSize, setScrollRef } = useVirtualList({
 *   data: items,
 *   estimateSize: 120,
 *   overscan: 5,
 * });
 *
 * return (
 *   <div ref={setScrollRef} style={{ height: '500px', overflow: 'auto' }}>
 *     <div style={{ height: totalSize }}>
 *       {virtualItems.map((item) => (
 *         <div
 *           key={item.key}
 *           style={{
 *             position: 'absolute',
 *             top: item.start,
 *             left: 0,
 *             width: '100%',
 *             height: item.size,
 *           }}
 *         >
 *           {renderItem(data[item.index], item.index)}
 *         </div>
 *       ))}
 *     </div>
 *   </div>
 * );
 * ```
 *
 * @param options - 虚拟列表配置选项
 * @returns 虚拟列表控制对象
 */
export function useVirtualList<T = unknown>(options: VirtualListOptions<T>): VirtualListReturn<T> {
  const {
    data,
    estimateSize = 120,
    overscan = 5,
    gridMode = false,
    columns = 1,
    rowCountMode = false,
    scrollRef: externalScrollRef,
  } = options;

  // 内部滚动容器引用
  const internalScrollRef = useRef<HTMLElement | null>(null);

  // 选择使用外部传入的 ref 还是内部 ref
  const scrollElement = externalScrollRef?.current ?? internalScrollRef.current;

  // 按行虚拟化模式：count 为行数而非数据条数
  const isRowMode = gridMode && rowCountMode;
  const virtualizerCount = isRowMode ? Math.ceil(data.length / columns) : data.length;

  // 创建 virtualizer 实例
  const virtualizer = useVirtualizer({
    count: virtualizerCount,
    getScrollElement: () => scrollElement ?? null,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
  });

  // 获取当前可见的虚拟项目（调用函数获取数组）
  const virtualItems = virtualizer.getVirtualItems();

  // 总内容高度
  const totalSize = virtualizer.getTotalSize();

  /**
   * 仅在 rowCountMode 下有效：
   * 根据虚拟行索引获取对应的数据索引范围
   */
  const getRowDataRange = useCallback(
    (virtualRowIndex: number) => {
      const start = virtualRowIndex * columns;
      const end = Math.min(start + columns, data.length);
      return { start, end };
    },
    [columns, data.length]
  );

  // 滚动到指定索引
  // 在 rowCountMode 下，传入的是数据索引，需要转换为行索引
  const scrollToIndex = useCallback(
    (index: number, options?: ScrollIntoViewOptions) => {
      const targetIndex = isRowMode ? Math.floor(index / columns) : index;
      virtualizer.scrollToIndex(targetIndex, options);
    },
    [virtualizer, isRowMode, columns]
  );

  // 滚动到顶部
  const scrollToTop = useCallback(() => {
    if (scrollElement) {
      scrollElement.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [scrollElement]);

  // 设置滚动容器的 ref 回调
  const setScrollRef = useCallback(
    (el: HTMLElement | null) => {
      internalScrollRef.current = el;
      // 触发重新计算
      virtualizer.measure();
    },
    [virtualizer]
  );

  // 当列数或数据量变化时重新测量（rowCountMode 专用）
  useEffect(() => {
    if (isRowMode) {
      virtualizer.measure();
    }
  }, [isRowMode, columns, data.length, virtualizer]);

  return {
    virtualizer,
    virtualItems,
    totalSize,
    scrollToIndex,
    scrollToTop,
    setScrollRef,
    ...(isRowMode ? { getRowDataRange } : {}),
  };
}

export default useVirtualList;
