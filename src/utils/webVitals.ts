/**
 * Web Vitals 性能监控工具函数
 * 用于在非 React 组件环境中初始化性能监控
 */

/**
 * Core Web Vitals 性能指标类型
 */
export interface WebVitalsMetrics {
  /** Largest Contentful Paint - 最大内容绘制时间 */
  lcp?: number;
  /** First Input Delay - 首次输入延迟 */
  fid?: number;
  /** Cumulative Layout Shift - 累积布局偏移 */
  cls?: number;
  /** First Contentful Paint - 首次内容绘制时间 */
  fcp?: number;
  /** Time to First Byte - 首字节时间 */
  ttfb?: number;
  /** Interaction to Next Paint - 交互到下一次绘制时间 (INP 替代 FID) */
  inp?: number;
}

/**
 * 性能指标上报选项
 */
export interface WebVitalsInitOptions {
  /** 是否在控制台输出性能指标（开发环境默认 true） */
  logToConsole?: boolean;
  /** 是否上报到分析端点 */
  reportToEndpoint?: boolean;
  /** 上报端点 URL */
  endpointUrl?: string;
  /** 自定义上报回调 */
  onReport?: (metrics: WebVitalsMetrics) => void;
  /** 采样率 (0-1)，用于控制上报频率 */
  sampleRate?: number;
}

/**
 * 检查是否支持 Performance Observer
 */
const isPerformanceObserverSupported = (): boolean => {
  return typeof window !== 'undefined' && 'PerformanceObserver' in window;
};

/**
 * 检查是否支持 Performance API
 */
const isPerformanceSupported = (): boolean => {
  return typeof window !== 'undefined' && 'performance' in window;
};

/**
 * 获取 CLS 值
 */
const observeCLS = (callback: (value: number) => void): (() => void) => {
  if (!isPerformanceObserverSupported()) {
    return () => {};
  }

  let clsValue = 0;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry as any).hadRecentInput) {
        clsValue += (entry as any).value;
      }
    }
    callback(clsValue);
  });

  try {
    observer.observe({ type: 'layout-shift', buffered: true } as any);
  } catch {
    try {
      observer.observe({ entryTypes: ['layout-shift'] });
    } catch {
      return () => {};
    }
  }

  return () => observer.disconnect();
};

/**
 * 获取 LCP 值
 */
const observeLCP = (callback: (value: number) => void): (() => void) => {
  if (!isPerformanceObserverSupported()) {
    return () => {};
  }

  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      callback(lastEntry.startTime);
    }
  });

  try {
    observer.observe({ type: 'largest-contentful-paint', buffered: true } as any);
  } catch {
    try {
      observer.observe({ entryTypes: ['largest-contentful-paint'] });
    } catch {
      return () => {};
    }
  }

  return () => observer.disconnect();
};

/**
 * 获取 FID 值
 */
const observeFID = (callback: (value: number) => void): (() => void) => {
  if (!isPerformanceObserverSupported()) {
    return () => {};
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const delay = (entry as any).processingStart - entry.startTime;
      callback(delay);
    }
  });

  try {
    observer.observe({ type: 'first-input', buffered: true } as any);
  } catch {
    try {
      observer.observe({ entryTypes: ['first-input'] });
    } catch {
      return () => {};
    }
  }

  return () => observer.disconnect();
};

/**
 * 获取 FCP 值
 */
const observeFCP = (callback: (value: number) => void): (() => void) => {
  if (!isPerformanceObserverSupported()) {
    return () => {};
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        callback(entry.startTime);
      }
    }
  });

  try {
    observer.observe({ type: 'paint', buffered: true } as any);
  } catch {
    try {
      observer.observe({ entryTypes: ['paint'] });
    } catch {
      return () => {};
    }
  }

  return () => observer.disconnect();
};

/**
 * 获取 TTFB 值
 */
const getTTFB = (callback: (value: number) => void): void => {
  if (!isPerformanceSupported()) {
    return;
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (navigation) {
    callback(navigation.responseStart - navigation.startTime);
  }
};

/**
 * 获取 INP (Interaction to Next Paint) 值
 */
const observeINP = (callback: (value: number) => void): (() => void) => {
  if (!isPerformanceObserverSupported()) {
    return () => {};
  }

  let maxDuration = 0;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if ((entry as any).interactionId) {
        const duration = entry.duration;
        if (duration > maxDuration) {
          maxDuration = duration;
          callback(maxDuration);
        }
      }
    }
  });

  try {
    observer.observe({ type: 'event', buffered: true, durationThreshold: 0 } as any);
  } catch {
    try {
      observer.observe({ entryTypes: ['event'] });
    } catch {
      return () => {};
    }
  }

  return () => observer.disconnect();
};

/**
 * 上报性能指标
 */
const reportMetrics = (
  metrics: WebVitalsMetrics,
  options: WebVitalsInitOptions
): void => {
  const { logToConsole, reportToEndpoint, endpointUrl, onReport, sampleRate = 1 } = options;

  if (Math.random() > sampleRate) {
    return;
  }

  if (logToConsole) {
    console.group('[Web Vitals] 性能指标报告');
    if (metrics.lcp !== undefined) {
      const rating = metrics.lcp < 2500 ? '✅ 良好' : metrics.lcp < 4000 ? '⚠️ 需改进' : '❌ 差';
      console.log(`LCP (最大内容绘制): ${metrics.lcp.toFixed(2)}ms ${rating}`);
    }
    if (metrics.fid !== undefined) {
      const rating = metrics.fid < 100 ? '✅ 良好' : metrics.fid < 300 ? '⚠️ 需改进' : '❌ 差';
      console.log(`FID (首次输入延迟): ${metrics.fid.toFixed(2)}ms ${rating}`);
    }
    if (metrics.cls !== undefined) {
      const rating = metrics.cls < 0.1 ? '✅ 良好' : metrics.cls < 0.25 ? '⚠️ 需改进' : '❌ 差';
      console.log(`CLS (累积布局偏移): ${metrics.cls.toFixed(4)} ${rating}`);
    }
    if (metrics.fcp !== undefined) {
      const rating = metrics.fcp < 1800 ? '✅ 良好' : metrics.fcp < 3000 ? '⚠️ 需改进' : '❌ 差';
      console.log(`FCP (首次内容绘制): ${metrics.fcp.toFixed(2)}ms ${rating}`);
    }
    if (metrics.ttfb !== undefined) {
      const rating = metrics.ttfb < 800 ? '✅ 良好' : metrics.ttfb < 1800 ? '⚠️ 需改进' : '❌ 差';
      console.log(`TTFB (首字节时间): ${metrics.ttfb.toFixed(2)}ms ${rating}`);
    }
    if (metrics.inp !== undefined) {
      const rating = metrics.inp < 200 ? '✅ 良好' : metrics.inp < 500 ? '⚠️ 需改进' : '❌ 差';
      console.log(`INP (交互到下一次绘制): ${metrics.inp.toFixed(2)}ms ${rating}`);
    }
    console.groupEnd();
  }

  if (onReport) {
    onReport(metrics);
  }

  if (reportToEndpoint && endpointUrl) {
    const data = JSON.stringify({
      metrics,
      url: window.location.href,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpointUrl, new Blob([data], { type: 'application/json' }));
    } else {
      fetch(endpointUrl, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch((e) => {
        console.warn('[webVitals] Failed to send metrics:', String(e))
      });
    }
  }
};

/**
 * 初始化 Web Vitals 性能监控
 *
 * 自动收集 Core Web Vitals 指标：
 * - LCP: Largest Contentful Paint (最大内容绘制)
 * - FID: First Input Delay (首次输入延迟)
 * - CLS: Cumulative Layout Shift (累积布局偏移)
 * - FCP: First Contentful Paint (首次内容绘制)
 * - TTFB: Time to First Byte (首字节时间)
 * - INP: Interaction to Next Paint (交互到下一次绘制)
 *
 * @example
 * ```ts
 * // 基础用法（仅控制台输出）
 * initWebVitals();
 *
 * // 自定义配置
 * initWebVitals({
 *   logToConsole: true,
 *   reportToEndpoint: true,
 *   endpointUrl: '/api/analytics/web-vitals',
 *   sampleRate: 0.5,
 * });
 * ```
 */
export const initWebVitals = (options: WebVitalsInitOptions = {}): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const isDev = import.meta.env.DEV;
  const mergedOptions: WebVitalsInitOptions = {
    logToConsole: isDev,
    reportToEndpoint: false,
    sampleRate: 1,
    ...options,
  };

  const metrics: WebVitalsMetrics = {};
  const reported = new Set<string>();
  const cleanupFns: (() => void)[] = [];

  // 收集 LCP
  cleanupFns.push(
    observeLCP((value) => {
      metrics.lcp = value;
      if (!reported.has('lcp')) {
        reported.add('lcp');
        reportMetrics({ lcp: value }, mergedOptions);
      }
    })
  );

  // 收集 FID
  cleanupFns.push(
    observeFID((value) => {
      metrics.fid = value;
      if (!reported.has('fid')) {
        reported.add('fid');
        reportMetrics({ fid: value }, mergedOptions);
      }
    })
  );

  // 收集 CLS
  cleanupFns.push(
    observeCLS((value) => {
      metrics.cls = value;
    })
  );

  // 收集 FCP
  cleanupFns.push(
    observeFCP((value) => {
      metrics.fcp = value;
      if (!reported.has('fcp')) {
        reported.add('fcp');
        reportMetrics({ fcp: value }, mergedOptions);
      }
    })
  );

  // 收集 TTFB
  getTTFB((value) => {
    metrics.ttfb = value;
    if (!reported.has('ttfb')) {
      reported.add('ttfb');
      reportMetrics({ ttfb: value }, mergedOptions);
    }
  });

  // 收集 INP
  cleanupFns.push(
    observeINP((value) => {
      metrics.inp = value;
      reportMetrics({ inp: value }, mergedOptions);
    })
  );

  // 页面卸载时报告最终的 CLS
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden' && metrics.cls !== undefined) {
      reportMetrics({ cls: metrics.cls }, mergedOptions);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 返回清理函数
  return () => {
    cleanupFns.forEach((fn) => fn());
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

export default initWebVitals;
