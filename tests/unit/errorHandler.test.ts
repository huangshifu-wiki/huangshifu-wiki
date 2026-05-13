import { describe, expect, it, vi } from 'vitest';

import {
  AppError,
  AuthError,
  getUserMessage,
  handleError,
  NetworkError,
  NotFoundError,
  PermissionError,
  ValidationError,
  BusinessError,
  ServerError,
  VectorSearchError,
  EmbeddingGenerationError,
} from '../../src/lib/errorHandler';

describe('errorHandler', () => {
  describe('AppError', () => {
    it('creates error with default values', () => {
      const error = new AppError('Test message');

      expect(error.message).toBe('Test message');
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.name).toBe('AppError');
    });

    it('creates error with custom values', () => {
      const error = new AppError('Custom', 'CUSTOM_CODE', 400, false);

      expect(error.message).toBe('Custom');
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.isOperational).toBe(false);
    });

    it('sets timestamp', () => {
      const error = new AppError('Test');
      expect(error.timestamp).toBeDefined();
    });
  });

  describe('NetworkError', () => {
    it('creates network error with default values', () => {
      const error = new NetworkError();

      expect(error.message).toBe('网络请求失败');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBe(0);
    });
  });

  describe('AuthError', () => {
    it('creates auth error', () => {
      const error = new AuthError();

      expect(error.message).toBe('认证失败');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('PermissionError', () => {
    it('creates permission error', () => {
      const error = new PermissionError();

      expect(error.message).toBe('权限不足');
      expect(error.code).toBe('PERMISSION_ERROR');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('NotFoundError', () => {
    it('creates not found error', () => {
      const error = new NotFoundError();

      expect(error.message).toBe('资源未找到');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ValidationError', () => {
    it('creates validation error', () => {
      const error = new ValidationError();

      expect(error.message).toBe('数据验证失败');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('handleError', () => {
    it('wraps AppError directly', () => {
      const appError = new AppError('Test');
      const result = handleError(appError);

      expect(result).toBe(appError);
    });

    it('wraps standard Error', () => {
      const error = new Error('Runtime error');
      const result = handleError(error);

      expect(result).toBeInstanceOf(AppError);
      expect(result.code).toBe('RUNTIME_ERROR');
    });

    it('wraps string error', () => {
      const result = handleError('String error');

      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('String error');
      expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('wraps unknown error', () => {
      const result = handleError({ code: 123 });

      expect(result).toBeInstanceOf(AppError);
    });
  });

  describe('getUserMessage', () => {
    it('returns AppError message for operational errors', () => {
      const error = new AppError('Test error', 'CODE', 500, true);
      expect(getUserMessage(error)).toBe('Test error');
    });

    it('returns system message for non-operational errors', () => {
      const error = new AppError('Test error', 'CODE', 500, false);
      expect(getUserMessage(error)).toBe('系统异常，请稍后重试');
    });

    it('returns Error message for standard errors', () => {
      const error = new Error('Standard error');
      expect(getUserMessage(error)).toBe('Standard error');
    });

    it('returns default message for unknown errors', () => {
      expect(getUserMessage(null)).toBe('未知错误，请稍后重试');
    });
  });

  describe('BusinessError', () => {
    it('creates business error with default values', () => {
      const error = new BusinessError();
      expect(error.message).toBe('业务错误');
      expect(error.code).toBe('BUSINESS_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('BusinessError');
    });

    it('creates business error with custom message', () => {
      const error = new BusinessError('库存不足');
      expect(error.message).toBe('库存不足');
      expect(error.code).toBe('BUSINESS_ERROR');
    });
  });

  describe('ServerError', () => {
    it('creates server error with default values', () => {
      const error = new ServerError();
      expect(error.message).toBe('服务器错误');
      expect(error.code).toBe('SERVER_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('ServerError');
    });

    it('creates server error with custom message', () => {
      const error = new ServerError('数据库连接失败');
      expect(error.message).toBe('数据库连接失败');
    });
  });

  describe('VectorSearchError', () => {
    it('creates vector search error with defaults', () => {
      const error = new VectorSearchError();
      expect(error.message).toBe('向量搜索服务不可用');
      expect(error.code).toBe('VECTOR_SEARCH_ERROR');
      expect(error.statusCode).toBe(503);
    });

    it('accepts optional details', () => {
      const error = new VectorSearchError('Qdrant down', 'connection refused');
      expect(error.details).toBe('connection refused');
    });
  });

  describe('EmbeddingGenerationError', () => {
    it('creates embedding error with defaults', () => {
      const error = new EmbeddingGenerationError();
      expect(error.message).toBe('文本嵌入生成失败');
      expect(error.code).toBe('EMBEDDING_GENERATION_ERROR');
      expect(error.statusCode).toBe(500);
    });

    it('accepts optional details', () => {
      const error = new EmbeddingGenerationError('model load failed', 'OOM');
      expect(error.details).toBe('OOM');
    });
  });
});