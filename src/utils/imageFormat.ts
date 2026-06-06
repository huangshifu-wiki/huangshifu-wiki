/**
 * 图片格式检测和自动选择工具
 * 用于首屏性能优化 - 自动选择最佳图片格式
 */

export type SupportedImageFormat = 'avif' | 'webp' | 'jpeg' | 'png';

export interface ImageFormatSupport {
  avif: boolean;
  webp: boolean;
  jpeg: boolean;
  png: boolean;
}

// 缓存格式支持检测结果
let formatSupportCache: ImageFormatSupport | null = null;

/**
 * 检测浏览器对各种图片格式的支持
 */
export const detectImageFormatSupport = async (): Promise<ImageFormatSupport> => {
  if (formatSupportCache) {
    return formatSupportCache;
  }

  const support: ImageFormatSupport = {
    avif: false,
    webp: false,
    jpeg: true,
    png: true,
  };

  // 检测 AVIF 支持
  try {
    const avifData = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
    support.avif = await checkImageFormatSupport(avifData);
  } catch {
    support.avif = false;
  }

  // 检测 WebP 支持
  try {
    const webpData = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
    support.webp = await checkImageFormatSupport(webpData);
  } catch {
    support.webp = false;
  }

  formatSupportCache = support;
  return support;
};

/**
 * 检查特定图片格式是否被支持
 */
const checkImageFormatSupport = (dataUrl: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
};

/**
 * 获取最佳图片格式
 * 优先级：AVIF > WebP > JPEG
 */
export const getBestImageFormat = async (): Promise<SupportedImageFormat> => {
  const support = await detectImageFormatSupport();

  if (support.avif) return 'avif';
  if (support.webp) return 'webp';
  return 'jpeg';
};

/**
 * 将 URL 转换为指定格式的 URL
 * 支持在 URL 后添加格式参数或通过 CDN 转换
 */
export const convertToFormat = (
  url: string,
  format: SupportedImageFormat,
  quality = 80
): string => {
  // 仅对可拼接查询参数的资源 URL 做格式优化，避免破坏 blob/data 等本地预览地址
  if (
    format === 'jpeg' ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('file:')
  ) {
    return url;
  }

  // 检测 URL 是否已经有查询参数
  const separator = url.includes('?') ? '&' : '?';

  // 对于 S3 或其他支持格式转换的 CDN，添加格式参数
  // 这里使用通用的 f= 参数，实际使用时可根据 CDN 提供商调整
  return `${url}${separator}f=${format}&q=${quality}`;
};

/**
 * 生成响应式图片 srcset
 * 支持多尺寸和格式
 */
export interface ResponsiveImageOptions {
  widths: number[];
  format?: SupportedImageFormat;
  quality?: number;
}

export const generateSrcSet = (
  baseUrl: string,
  options: ResponsiveImageOptions
): string => {
  const { widths, format = 'webp', quality = 80 } = options;

  return widths
    .map((width) => {
      const url = convertToFormat(baseUrl, format, quality);
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}w=${width} ${width}w`;
    })
    .join(', ');
};

/**
 * 检测元素是否在首屏（视口）内
 * 用于自动设置 fetchpriority="high"
 */
export const isInViewport = (
  element: Element | null,
  threshold = 0
): boolean => {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.top >= -threshold &&
    rect.left >= -threshold &&
    rect.bottom <= windowHeight + threshold &&
    rect.right <= windowWidth + threshold
  );
};

/**
 * 检测元素是否在首屏上方（需要优先加载）
 */
export const isAboveTheFold = (element: Element | null): boolean => {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;

  // 元素在视口内或上方，且距离顶部不超过视口高度
  return rect.top < windowHeight && rect.bottom > 0;
};

/**
 * 预加载关键图片
 */
export const preloadCriticalImage = (url: string, as: 'image' | 'fetch' = 'image'): void => {
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = as;
  link.href = url;

  if (as === 'image') {
    link.setAttribute('fetchpriority', 'high');
  }

  document.head.appendChild(link);
};

/**
 * 清除格式支持缓存（用于测试）
 */
export const clearFormatSupportCache = (): void => {
  formatSupportCache = null;
};
