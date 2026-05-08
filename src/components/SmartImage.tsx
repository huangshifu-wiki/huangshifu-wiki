import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { decodeBlurhashToDataURL } from '../hooks/useBlurhash';
import { ImageMap, getImagePreference, resolveImageUrl } from '../services/imageService';
import {
  detectImageFormatSupport,
  convertToFormat,
  getBestImageFormat,
  SupportedImageFormat,
} from '../utils/imageFormat';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

export interface SmartImageProps {
  image?: ImageMap | string | null | undefined;
  src?: string | null;
  alt?: string;
  width?: number | string;
  height?: number | string;
  /**
   * 图片宽高比 - 用于防止 CLS
   * 格式: "16/9", "4/3", "1/1" 或数字 1.77
   */
  aspectRatio?: string | number;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  /**
   * 图片加载优先级 - 用于首屏 LCP 图片优化
   * - 'high': 高优先级，用于首屏关键图片
   * - 'low': 低优先级，用于非关键图片
   * - 'auto': 浏览器自动决定（默认）
   * - 'auto-detect': 自动检测是否在首屏并设置
   */
  fetchpriority?: 'high' | 'low' | 'auto' | 'auto-detect';
  /**
   * 是否启用懒加载 - 默认 false
   * 当 fetchpriority='high' 时自动禁用懒加载
   */
  lazy?: boolean;
  /**
   * 是否启用格式优化（WebP/AVIF 自动选择）
   */
  formatOptimization?: boolean;
  /**
   * 图片质量（1-100）
   */
  quality?: number;
  /**
   * 响应式尺寸
   */
  sizes?: string;
  /**
   * 自定义 srcset
   */
  srcSet?: string;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  fallback?: React.ReactNode;
  decodeOptions?: {
    width?: number;
    height?: number;
    punch?: number;
  };
  transitionDuration?: number;
  /**
   * 背景色占位 - 在 blurhash 加载前显示
   */
  placeholderColor?: string;
  /**
   * 是否启用模糊过渡效果
   */
  enableBlurTransition?: boolean;
}

// 全局格式支持缓存
let globalFormatSupport: { format: SupportedImageFormat; supported: boolean } | null = null;

// 初始化格式支持检测
const initFormatSupport = async (): Promise<void> => {
  if (globalFormatSupport) return;

  const support = await detectImageFormatSupport();
  let format: SupportedImageFormat = 'jpeg';
  if (support.avif) format = 'avif';
  else if (support.webp) format = 'webp';

  globalFormatSupport = { format, supported: format !== 'jpeg' };
};

// 启动格式检测
initFormatSupport();

export const SmartImage: React.FC<SmartImageProps> = ({
  image,
  src,
  alt = '',
  width,
  height,
  aspectRatio,
  className = '',
  style = {},
  loading: loadingProp,
  fetchpriority = 'auto',
  lazy = false,
  formatOptimization = true,
  quality,
  sizes,
  srcSet,
  onLoad,
  onError,
  fallback,
  decodeOptions = {},
  transitionDuration = 300,
  placeholderColor = '#f5f5f5',
  enableBlurTransition = true,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [blurhashDataUrl, setBlurhashDataUrl] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [optimizedUrl, setOptimizedUrl] = useState('');
  const [isAboveTheFold, setIsAboveTheFold] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Mobile and slow connection detection
  const isMobileDevice = typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const connectionInfo = typeof navigator !== 'undefined' && 'connection' in navigator
    ? (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    : null;
  const isSlowConnection = connectionInfo && (
    (connectionInfo.effectiveType && ['slow-2g', '2g', '3g'].includes(connectionInfo.effectiveType)) ||
    connectionInfo.saveData
  );

  // Default quality: lower for mobile/slow connections
  const effectiveQuality = quality ?? (isMobileDevice || isSlowConnection ? 60 : 80);

  const imageInput = image || src;

  // 使用 Intersection Observer 检测是否在视口内
  // 移动网络下减少预加载距离，降低并发
  const lazyMargin = isSlowConnection ? '20px' : '100px';
  const { isIntersecting, hasIntersected } = useIntersectionObserver({
    threshold: 0,
    rootMargin: lazyMargin,
    triggerOnce: true,
    externalRef: containerRef as React.RefObject<HTMLElement | null>,
  });

  // 提取 blurhash
  const blurhash = useMemo(() => {
    if (!imageInput || typeof imageInput === 'string') return undefined;
    return imageInput.blurhash;
  }, [imageInput]);

  // 自动检测首屏
  useEffect(() => {
    if (fetchpriority !== 'auto-detect') return;

    const checkAboveTheFold = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      const isInFold = rect.top < windowHeight && rect.bottom > 0;
      setIsAboveTheFold(isInFold);
    };

    // 初始检查
    checkAboveTheFold();

    // 监听滚动
    const handleScroll = () => {
      checkAboveTheFold();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [fetchpriority]);

  // 计算实际的 loading 和 fetchpriority
  const { actualLoading, actualFetchPriority } = useMemo(() => {
    let loading: 'lazy' | 'eager' = loadingProp || (lazy ? 'lazy' : 'eager');
    let priority: 'high' | 'low' | 'auto' = 'auto';

    if (fetchpriority === 'auto-detect') {
      priority = isAboveTheFold ? 'high' : 'auto';
      if (isAboveTheFold) loading = 'eager';
    } else if (fetchpriority !== 'auto') {
      priority = fetchpriority;
      if (fetchpriority === 'high') loading = 'eager';
    }

    return { actualLoading: loading, actualFetchPriority: priority };
  }, [fetchpriority, isAboveTheFold, lazy, loadingProp]);

  // 解析图片 URL
  useEffect(() => {
    const resolveUrl = async () => {
      if (!imageInput) {
        setResolvedUrl('');
        return;
      }

      if (typeof imageInput === 'string') {
        setResolvedUrl(imageInput);
        return;
      }

      try {
        const preference = await getImagePreference();
        const result = await resolveImageUrl(imageInput, preference);
        setResolvedUrl(result.url);
      } catch (error) {
        console.error('Failed to resolve image URL:', error);
        setResolvedUrl(imageInput.localUrl || imageInput.s3Url || imageInput.externalUrl || '');
      }
    };

    resolveUrl();
  }, [imageInput]);

  // 格式优化 - 转换为最佳格式
  useEffect(() => {
    if (!resolvedUrl || !formatOptimization) {
      setOptimizedUrl(resolvedUrl);
      return;
    }

    const optimize = async () => {
      // 等待格式检测完成
      if (!globalFormatSupport) {
        await initFormatSupport();
      }

      if (globalFormatSupport?.supported) {
        const optimized = convertToFormat(resolvedUrl, globalFormatSupport.format, effectiveQuality);
        setOptimizedUrl(optimized);
      } else {
        setOptimizedUrl(resolvedUrl);
      }
    };

    optimize();
  }, [resolvedUrl, formatOptimization, quality]);

  // 解码 blurhash
  useEffect(() => {
    if (!blurhash || blurhash.length === 0) {
      setBlurhashDataUrl(null);
      return;
    }

    // 使用 requestIdleCallback 在空闲时解码，避免阻塞主线程
    const decodeBlurhash = () => {
      const dataUrl = decodeBlurhashToDataURL(
        blurhash,
        decodeOptions.width || 32,
        decodeOptions.height || 32,
        decodeOptions.punch
      );
      setBlurhashDataUrl(dataUrl);
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(decodeBlurhash, { timeout: 100 });
      return () => window.cancelIdleCallback(id);
    } else {
      // 降级使用 setTimeout
      const id = setTimeout(decodeBlurhash, 0);
      return () => clearTimeout(id);
    }
  }, [blurhash, decodeOptions.width, decodeOptions.height, decodeOptions.punch]);

  // 重置加载状态
  useEffect(() => {
    if (!imageInput) return;
    setImageLoaded(false);
    setImageError(false);
  }, [imageInput]);

  // 处理图片加载完成
  const handleLoad = useCallback(() => {
    // 使用 requestAnimationFrame 确保平滑过渡
    requestAnimationFrame(() => {
      setImageLoaded(true);
      setImageError(false);
      onLoad?.();
    });
  }, [onLoad]);

  // 处理图片加载错误
  const handleError = useCallback((error: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setImageError(true);
    setImageLoaded(false);
    const err = error instanceof Error ? error : new Error('Image load failed');
    onError?.(err);
  }, [onError]);

  // 兜底：浏览器缓存命中时 load 事件可能在 React 挂上 onLoad 监听前就同步触发，
  // 导致 imageLoaded 一直为 false（opacity:0 → 看起来空白）。
  // 在 ref 回调里同步检查 complete 状态，命中即标记加载完成。
  const handleImgRef = useCallback((node: HTMLImageElement | null) => {
    imageRef.current = node;
    if (node && node.complete && node.naturalWidth > 0) {
      setImageLoaded(true);
    }
  }, []);

  // 计算是否显示占位符
  const showPlaceholder = blurhashDataUrl && !imageLoaded && !imageError;
  const showImage = optimizedUrl && !imageError;
  const shouldLoadImage = actualLoading === 'eager' || hasIntersected || isIntersecting;

  // 计算容器样式 - 防止 CLS
  const containerStyle: React.CSSProperties = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: placeholderColor,
    };

    // 只在明确传递 width 时设置宽度
    if (width) {
      baseStyle.width = typeof width === 'number' ? `${width}px` : width;
    }

    // 只在明确传递 height 时设置高度
    if (height) {
      baseStyle.height = typeof height === 'number' ? `${height}px` : height;
    }

    // 添加 aspect-ratio 防止 CLS
    if (aspectRatio) {
      baseStyle.aspectRatio = String(aspectRatio);
    }

    // 如果没有明确高度但有宽度，使用占位比例
    if (!height && !aspectRatio && width) {
      baseStyle.minHeight = '100px';
    }

    return { ...baseStyle, ...style };
  }, [width, height, aspectRatio, placeholderColor, style]);

  // 占位符样式
  const placeholderStyleFinal: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: enableBlurTransition
      ? `opacity ${transitionDuration}ms ease-in-out, filter ${transitionDuration}ms ease-in-out`
      : undefined,
    opacity: showPlaceholder ? 1 : 0,
    filter: imageLoaded ? 'blur(10px)' : 'blur(0px)',
  }), [showPlaceholder, imageLoaded, transitionDuration, enableBlurTransition]);

  // 图片样式
  // 仅在存在 blurhash 占位时需要等 imageLoaded 才淡入；否则直接显示，
  // 避免 React reconcile 后浏览器 load 事件丢失导致 opacity 卡在 0
  const imageStyleFinal: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: enableBlurTransition && blurhashDataUrl
      ? `opacity ${transitionDuration}ms ease-in-out`
      : undefined,
    opacity: blurhashDataUrl ? (imageLoaded ? 1 : 0) : 1,
  }), [imageLoaded, transitionDuration, enableBlurTransition, blurhashDataUrl]);

  // 无图片状态
  if (!imageInput) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: width || '100%',
          height: height || '100%',
          backgroundColor: '#f0f0f0',
          color: '#999',
          fontSize: '14px',
          aspectRatio: aspectRatio ? String(aspectRatio) : undefined,
          ...style,
        }}
      >
        无图片
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`smart-image-container ${className}`}
      style={containerStyle}
    >
      {/* Blurhash 占位符 */}
      {blurhashDataUrl && (
        <img
          src={blurhashDataUrl}
          alt=""
          style={placeholderStyleFinal}
          aria-hidden="true"
        />
      )}

      {/* 实际图片 */}
      {showImage && shouldLoadImage && (
        <img
          ref={handleImgRef}
          src={optimizedUrl}
          alt={alt}
          loading={actualLoading}
          decoding="async"
          fetchPriority={actualFetchPriority}
          sizes={sizes}
          srcSet={srcSet}
          onLoad={handleLoad}
          onError={handleError}
          style={imageStyleFinal}
        />
      )}

      {/* 错误状态 */}
      {imageError && !blurhashDataUrl && (
        fallback || (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              backgroundColor: '#f0f0f0',
              color: '#999',
              fontSize: '14px',
            }}
          >
            图片加载失败
          </div>
        )
      )}
    </div>
  );
};

export default SmartImage;
