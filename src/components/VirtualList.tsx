import React, { forwardRef, useImperativeHandle } from 'react';
import { useVirtualList, type VirtualListOptions, type VirtualListReturn } from '../hooks/useVirtualList';

/**
 * VirtualList 组件的 props 接口
 */
export interface VirtualListProps<T> {
  /** 数据数组 */
  data: T[];
  /** 预估每项高度（像素），默认 120 */
  estimateSize?: number;
  /** 预渲染的额外项数，默认 5 */
  overscan?: number;
  /** 容器高度，可以是固定像素值或 CSS 值 */
  height?: string | number;
  /** 自定义样式类名 */
  className?: string;
  /** 渲染函数：接收数据项和索引，返回 React 元素 */
  children: (item: T, index: number) => React.ReactNode;
}

/**
 * VirtualList 暴露给父组件的方法
 */
export interface VirtualListHandle<T> {
  /** 滚动到指定索引 */
  scrollToIndex: (index: number, options?: ScrollIntoViewOptions) => void;
  /** 滚动到顶部 */
  scrollToTop: () => void;
  /** 获取 virtualizer 实例（高级用法） */
  getVirtualizer: () => NonNullable<VirtualListReturn<T>['virtualizer']>;
}

/**
 * 虚拟滚动列表组件
 *
 * 高性能渲染大型列表，只渲染可视区域内的项目，
 * 显著减少 DOM 节点数量，提升滚动性能。
 *
 * @example
 * ```tsx
 * const listRef = useRef<VirtualListHandle<Song>>(null);
 *
 * <VirtualList
 *   ref={listRef}
 *   data={songs}
 *   estimateSize={120}
 *   height="600px"
 * >
 *   {(song, index) => (
 *     <SongCard
 *       key={song.id}
 *       song={song}
 *       onPlay={() => playSong(song)}
 *     />
 *   )}
 * </VirtualList>
 * ```
 *
 * @param props - VirtualList 属性
 * @returns 虚拟列表 JSX 元素
 */
function VirtualListInner<T>(
  props: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle<T>>
) {
  const {
    data,
    estimateSize = 120,
    overscan = 5,
    height = '100%',
    className,
    children,
  } = props;

  // 使用虚拟滚动 Hook
  const { virtualizer, virtualItems, totalSize, scrollToIndex, scrollToTop, setScrollRef } =
    useVirtualList<T>({
      data,
      estimateSize,
      overscan,
    });

  // 暴露方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex,
      scrollToTop,
      getVirtualizer: () => virtualizer,
    }),
    [scrollToIndex, scrollToTop, virtualizer]
  );

  return (
    <div
      ref={setScrollRef}
      className={`overflow-y-auto ${className ?? ''}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      {/* 总高度容器 */}
      <div
        style={{
          width: '100%',
          height: totalSize,
          position: 'relative',
        }}
      >
        {/* 只渲染可见的项目 */}
        {virtualItems.map((virtualItem) => {
          const item = data[virtualItem.index];
          if (!item) return null;

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {children(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 使用 forwardRef 创建可引用的 VirtualList 组件
 */
export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<VirtualListHandle<T>> }
) => React.ReactElement | null;

export default VirtualList;
