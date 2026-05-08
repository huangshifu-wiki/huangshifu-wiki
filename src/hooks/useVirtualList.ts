import { useRef, useCallback } from 'react';
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
    scrollRef: externalScrollRef,
  } = options;

  // 内部滚动容器引用
  const internalScrollRef = useRef<HTMLElement | null>(null);

  // 选择使用外部传入的 ref 还是内部 ref
  const scrollElement = externalScrollRef?.current ?? internalScrollRef.current;

  // 创建 virtualizer 实例
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollElement ?? null,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
  });

  // 获取当前可见的虚拟项目（调用函数获取数组）
  const virtualItems = virtualizer.getVirtualItems();

  // 总内容高度
  const totalSize = virtualizer.getTotalSize();

  // 滚动到指定索引
  const scrollToIndex = useCallback(
    (index: number, options?: ScrollIntoViewOptions) => {
      virtualizer.scrollToIndex(index, options);
    },
    [virtualizer]
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

  return {
    virtualizer,
    virtualItems,
    totalSize,
    scrollToIndex,
    scrollToTop,
    setScrollRef,
  };
}

export default useVirtualList;
