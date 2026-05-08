export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    statusCode: number = 500,
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NetworkError extends AppError {
  constructor(message: string = '网络请求失败') {
    super(message, 'NETWORK_ERROR', 0, true);
    this.name = 'NetworkError';
  }
}

export class AuthError extends AppError {
  constructor(message: string = '认证失败') {
    super(message, 'AUTH_ERROR', 401, true);
    this.name = 'AuthError';
  }
}

export class PermissionError extends AppError {
  constructor(message: string = '权限不足') {
    super(message, 'PERMISSION_ERROR', 403, true);
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = '资源未找到') {
    super(message, 'NOT_FOUND', 404, true);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string = '数据验证失败') {
    super(message, 'VALIDATION_ERROR', 400, true);
    this.name = 'ValidationError';
  }
}

export class BusinessError extends AppError {
  constructor(message: string = '业务错误') {
    super(message, 'BUSINESS_ERROR', 400, true);
    this.name = 'BusinessError';
  }
}

export class ServerError extends AppError {
  constructor(message: string = '服务器错误') {
    super(message, 'SERVER_ERROR', 500, true);
    this.name = 'ServerError';
  }
}

export class VectorSearchError extends AppError {
  constructor(message: string = '向量搜索服务不可用', public readonly details?: string) {
    super(message, 'VECTOR_SEARCH_ERROR', 503, true);
    this.name = 'VectorSearchError';
  }
}

export class EmbeddingGenerationError extends AppError {
  constructor(message: string = '文本嵌入生成失败', public readonly details?: string) {
    super(message, 'EMBEDDING_GENERATION_ERROR', 500, true);
    this.name = 'EmbeddingGenerationError';
  }
}

type ErrorContext = {
  component?: string;
  action?: string;
  userId?: string;
  [key: string]: unknown;
};

export function handleError(error: unknown, context?: ErrorContext): AppError {
  if (error instanceof AppError) {
    logError(error, context);
    return error;
  }

  if (error instanceof Error) {
    const appError = new AppError(
      error.message,
      'RUNTIME_ERROR',
      500,
      false,
    );
    appError.stack = error.stack;
    logError(appError, context);
    return appError;
  }

  const appError = new AppError(
    typeof error === 'string' ? error : '未知错误',
    'UNKNOWN_ERROR',
    500,
    false,
  );
  logError(appError, context);
  return appError;
}

function logError(error: AppError, context?: ErrorContext): void {
  const logData = {
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
    timestamp: error.timestamp,
    ...context,
  };

  if (error.isOperational) {
    console.warn('[AppError]', logData);
  } else {
    console.error('[AppError]', logData, error.stack);
  }
}

export function getUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (error.isOperational) {
      return error.message;
    }
    return '系统异常，请稍后重试';
  }

  if (error instanceof Error) {
    return error.message || '操作失败，请稍后重试';
  }

  return '未知错误，请稍后重试';
}

// ============================================================================
// API 错误分类和日志
// ============================================================================

export interface ApiErrorContext {
  url: string;
  method: string;
  statusCode?: number;
  requestBody?: unknown;
  responseData?: unknown;
}

/**
 * 根据 HTTP 状态码分类错误
 */
export function classifyError(status: number, data: unknown): AppError {
  const errorMessage = typeof data === 'object' && data && 'error' in data
    ? String((data as Record<string, unknown>).error)
    : `请求失败：${status}`;

  if (status === 401) {
    return new AuthError(errorMessage || '登录已过期，请重新登录');
  }

  if (status === 403) {
    return new PermissionError(errorMessage || '权限不足');
  }

  if (status === 404) {
    return new NotFoundError(errorMessage || '资源未找到');
  }

  if (status >= 400 && status < 500) {
    return new BusinessError(errorMessage || '请求失败');
  }

  if (status >= 500) {
    return new ServerError(errorMessage || '服务器繁忙，请稍后再试');
  }

  return new AppError(errorMessage, 'UNKNOWN_ERROR', status);
}

/**
 * 记录详细的 API 错误日志
 */
export function logApiError(error: Error, context: ApiErrorContext): void {
  const logData = {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    request: {
      url: context.url,
      method: context.method,
      statusCode: context.statusCode,
    },
    requestBody: context.requestBody,
    responseData: context.responseData,
    timestamp: new Date().toISOString(),
  };

  if (error instanceof AppError && error.isOperational) {
    console.warn('[API Error]', logData);
  } else {
    console.error('[API Error]', logData);
  }
}

/**
 * 全局认证错误回调
 * 当 API 返回 401/403 时调用，可用于触发全局登出或跳转
 */
type AuthErrorCallback = (error: AppError) => void;
let globalAuthErrorCallback: AuthErrorCallback | null = null;

export function setAuthErrorCallback(callback: AuthErrorCallback | null): void {
  globalAuthErrorCallback = callback;
}

export function getAuthErrorCallback(): AuthErrorCallback | null {
  return globalAuthErrorCallback;
}

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    return '网络连接失败，请检查网络设置';
  }

  if (error instanceof AuthError) {
    return '登录已过期，请重新登录';
  }

  if (error instanceof BusinessError) {
    return error.message;
  }

  if (error instanceof ServerError) {
    return '服务器繁忙，请稍后再试';
  }

  if (error instanceof AppError) {
    return error.isOperational ? error.message : '系统异常，请稍后重试';
  }

  if (error instanceof Error) {
    return error.message || '操作失败，请稍后重试';
  }

  return '未知错误，请稍后重试';
}
