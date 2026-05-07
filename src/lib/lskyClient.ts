/**
 * Lsky Pro+ 图床系统 API 客户端
 *
 * 完整实现了 Lsky Pro+ 的 V1/V2 API，包括：
 * - 用户认证（登录、登出、注册）
 * - 图片上传（V1/V2 兼容）
 * - 图库管理（列表、详情、更新、删除、批量操作）
 * - 相册管理（CRUD 完整操作）
 *
 * @see https://docs.lsky.pro/
 */

// ============================================================================
// 类型定义
// ============================================================================

/** Lsky Pro API 配置接口 */
export interface LskyProConfig {
  /** API 基础地址 */
  baseUrl: string;
  /** 认证 Token（可选，也可通过 setToken 设置） */
  token?: string;
  /** 请求超时时间（毫秒），默认 30000 */
  timeout?: number;
}

/** Lsky Pro 统一响应格式 */
export interface LskyProResponse<T = unknown> {
  /** 是否成功 */
  status: boolean;
  /** 状态码 */
  code: number;
  /** 消息 */
  message: string;
  /** 响应数据 */
  data: T;
  /** 服务器时间戳 */
  time: number;
}

/** 登录参数 */
export interface LoginParams {
  /** 邮箱或用户名 */
  email: string;
  /** 密码 */
  password: number | string;
}

/** 登录响应数据 */
export interface LoginData {
  /** 认证 Token */
  token: string;
  /** Token 过期时间（秒） */
  expires_in: number;
}

/** 注册参数 */
export interface RegisterParams {
  /** 邮箱 */
  email: string;
  /** 密码 */
  password: number | string;
  /** 确认密码 */
  password_confirmation?: number | string;
  /** 用户名（可选） */
  name?: string;
}

/** 上传参数 */
export interface UploadParams {
  /** 文件 */
  file: File | Blob;
  /** 相册 ID（可选） */
  album_id?: number | string;
  /** 文件权限：0=公开, 1=私有, 2=密码保护（可选） */
  permission?: '0' | '1' | '2';
  /** 密码（当 permission=2 时需要） */
  key?: string;
  /** 策略 ID（可选） */
  strategy_id?: number | string;
}

/** V1 上传响应数据 */
export interface UploadV1Data {
  /** 图片 URL */
  url: string;
  /** 文件名 */
  filename: string;
  /** 图片信息 */
  info: {
    width: number;
    height: number;
    type: string;
  };
}

/** V2 上传响应数据 */
export interface UploadV2Data {
  /** 图片 ID */
  id: number;
  /** 图片 URL */
  url: string;
  /** 缩略图 URL */
  thumbnail_url?: string;
  /** 删除链接 */
  delete_url?: string;
  /** 文件名 */
  filename: string;
  /** 原始文件名 */
  origin_name: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mime_type: string;
  /** 图片信息 */
  info: {
    width: number;
    height: number;
    type: string;
  };
  /** 创建时间 */
  created_at: string;
  /** 相册 ID */
  album_id: number | null;
  /** 扩展信息 */
  extension_name: string;
  /** 状态 */
  status: number;
}

/** 图片数据模型 */
export interface Photo {
  /** 图片 ID */
  id: number;
  /** 图片 URL */
  url: string;
  /** 缩略图 URL */
  thumbnail_url?: string;
  /** 删除链接 */
  delete_url?: string;
  /** 文件名 */
  filename: string;
  /** 原始文件名 */
  origin_name: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mime_type: string;
  /** 存储策略 ID */
  strategy_id: number;
  /** 图片信息 */
  info: {
    width: number;
    height: number;
    type: string;
  };
  /** 用户 ID */
  user_id: number;
  /** 相册 ID */
  album_id: number | null;
  /** 文件权限：0=公开, 1=私有, 2=密码保护 */
  permission: number;
  /** 密码（当 permission=2 时） */
  key?: string;
  /** 阅读次数 */
  read_count: number;
  /** 扩展名称 */
  extension_name: string;
  /** 状态 */
  status: number;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/** 更新图片参数 */
export interface UpdatePhotoData {
  /** 相册 ID（可选） */
  album_id?: number | null;
  /** 文件权限（可选） */
  permission?: number;
  /** 密码（可选） */
  key?: string;
}

/** 批量更新图片参数 */
export interface BatchUpdatePhotosData {
  /** 要更新的图片 ID 数组 */
  ids: number[];
  /** 相册 ID（可选） */
  album_id?: number | null;
  /** 文件权限（可选） */
  permission?: number;
  /** 密码（可选） */
  key?: string;
}

/** 分页查询参数 */
export interface PaginationParams {
  /** 页码，默认 1 */
  page?: number;
  /** 每页数量，默认 15 */
  per_page?: number;
  /** 关键词搜索（可选） */
  keyword?: string;
  /** 排序字段（可选） */
  sort_by?: string;
  /** 排序方向：asc/desc（可选） */
  sort_direction?: 'asc' | 'desc';
  /** 状态筛选（可选） */
  status?: number;
  /** 相册 ID 筛选（可选） */
  album_id?: number;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  /** 当前页数据列表 */
  data: T[];
  /** 分页元信息 */
  meta: {
    /** 分页对象 */
    pagination: {
      /** 总记录数 */
      total: number;
      /** 当前页码 */
      current_page: number;
      /** 总页数 */
      last_page: number;
      /** 每页数量 */
      per_page: number;
      /** 从第几条开始 */
      from: number;
      /** 到第几条结束 */
      to: number;
    };
  };
}

/** 相册数据模型 */
export interface Album {
  /** 相册 ID */
  id: number;
  /** 相册名称 */
  name: string;
  /** 相册描述（可选） */
  description?: string | null;
  /** 相册状态：0=启用, 1=禁用 */
  status: number;
  /** 用户 ID */
  user_id: number;
  /** 图片数量 */
  photo_count: number;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/** 创建/更新相册参数 */
export interface AlbumData {
  /** 相册名称 */
  name: string;
  /** 相册描述（可选） */
  description?: string;
  /** 相册状态（可选），默认 0 */
  status?: number;
}

/** 自定义错误类 */
export class LskyProAPIError extends Error {
  /** HTTP 状态码 */
  statusCode: number;
  /** 业务错误码 */
  code: number;
  /** 错误数据 */
  data?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: number,
    data?: unknown
  ) {
    super(message);
    this.name = 'LskyProAPIError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;

    // 维护正确的原型链
    Object.setPrototypeOf(this, LskyProAPIError.prototype);
  }

  /** 判断是否为认证错误 */
  get isAuthError(): boolean {
    return this.statusCode === 401 || this.code === 40101 || this.code === 40102;
  }

  /** 判断是否为权限错误 */
  get isPermissionError(): boolean {
    return this.statusCode === 403 || this.code === 40301;
  }

  /** 判断是否为资源不存在错误 */
  get isNotFoundError(): boolean {
    return this.statusCode === 404 || this.code === 40401;
  }

  /** 判断是否为验证错误 */
  get isValidationError(): boolean {
    return this.statusCode === 422 || (this.code >= 42200 && this.code < 42300);
  }

  /** 判断是否为服务器错误 */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

// ============================================================================
// LskyProAPI 类
// ============================================================================

/**
 * Lsky Pro+ 图床 API 客户端
 *
 * @example
 * ```typescript
 * const api = new LskyProAPI({ baseUrl: 'https://your-lsky.com' });
 *
 * // 登录
 * const loginRes = await api.auth.login({ email: 'user@example.com', password: 123456 });
 *
 * // 上传图片
 * const uploadRes = await api.upload(fileInput.files[0]);
 * console.log(uploadRes.data.url);
 *
 * // 获取图片列表
 * const photos = await api.photos.list({ page: 1, per_page: 20 });
 * ```
 */
export class LskyProAPI {
  private baseUrl: string;
  private _token: string | undefined;
  private timeout: number;

  constructor(config: LskyProConfig) {
    if (!config.baseUrl) {
      throw new Error('LskyProAPI: baseUrl is required');
    }

    // 确保 baseUrl 以 / 结尾
    this.baseUrl = config.baseUrl.replace(/\/+$/, '') + '/';
    this._token = config.token;
    this.timeout = config.timeout ?? 30000; // 默认 30 秒超时
  }

  // ============================================================================
  // Token 管理
  // ============================================================================

  /**
   * 获取当前 Token
   */
  get token(): string | undefined {
    return this._token;
  }

  /**
   * 设置认证 Token
   * @param newToken - 新的 Token
   */
  setToken(newToken: string): void {
    this._token = newToken;
  }

  /**
   * 清除当前 Token
   */
  clearToken(): void {
    this._token = undefined;
  }

  // ============================================================================
  // 核心 HTTP 请求方法
  // ============================================================================

  /**
   * 构建完整 URL
   */
  private buildUrl(path: string): string {
    // 移除路径开头的 /
    const cleanPath = path.replace(/^\/+/, '');
    return `${this.baseUrl}${cleanPath}`;
  }

  /**
   * 构建请求头
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...(customHeaders || {}),
    };

    // 自动添加认证头
    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }

    return headers;
  }

  /**
   * 创建带超时的 AbortController
   */
  private createTimeoutController(): AbortController {
    const controller = new AbortController();
    
    // 设置超时
    setTimeout(() => {
      controller.abort();
    }, this.timeout);

    return controller;
  }

  /**
   * 通用请求方法
   * @param method - HTTP 方法
   * @param path - API 路径
   * @param options - 请求选项
   * @returns Promise<LskyProResponse<T>>
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      formData?: FormData;
      headers?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<LskyProResponse<T>> {
    const { body, query, formData, headers: customHeaders, timeout } = options;
    
    try {
      // 构建 URL 和查询参数
      let url = this.buildUrl(path);
      
      if (query && Object.keys(query).length > 0) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null && value !== '') {
            params.append(key, String(value));
          }
        }
        const queryString = params.toString();
        if (queryString) {
          url += `?${queryString}`;
        }
      }

      // 创建带超时的控制器
      const controller = this.createTimeoutController();
      const effectiveTimeout = timeout ?? this.timeout;
      
      // 覆盖默认超时
      setTimeout(() => controller.abort(), effectiveTimeout);

      // 构建请求选项
      const requestInit: RequestInit = {
        method,
        headers: this.buildHeaders(customHeaders),
        signal: controller.signal,
      };

      // 处理请求体
      if (formData) {
        requestInit.body = formData;
      } else if (body !== undefined) {
        requestInit.headers['Content-Type'] = 'application/json';
        requestInit.body = JSON.stringify(body);
      }

      // 发送请求
      const response = await fetch(url, requestInit);

      // 解析响应
      let responseData: LskyProResponse<T>;
      
      try {
        responseData = await response.json() as LskyProResponse<T>;
      } catch {
        throw new LskyProAPIError(
          'Failed to parse response as JSON',
          response.status,
          -1
        );
      }

      // 检查业务状态
      if (!responseData.status) {
        throw new LskyProAPIError(
          responseData.message || 'Request failed',
          response.status,
          responseData.code,
          responseData.data
        );
      }

      return responseData;
    } catch (error) {
      // 已经是自定义错误，直接抛出
      if (error instanceof LskyProAPIError) {
        throw error;
      }

      // 处理超时错误
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new LskyProAPIError(
          `Request timeout after ${this.timeout}ms`,
          408,
          40801
        );
      }

      // 处理网络错误
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new LskyProAPIError(
          'Network error: Unable to connect to server',
          0,
          0
        );
      }

      // 其他未知错误
      throw new LskyProAPIError(
        error instanceof Error ? error.message : 'Unknown error occurred',
        0,
        -1
      );
    }
  }

  // ============================================================================
  // 认证模块
  // ============================================================================

  /** 认证相关 API */
  readonly auth = {
    /**
     * 用户登录
     * @param params - 登录参数
     * @returns Promise<LoginData>
     *
     * @example
     * ```typescript
     * const result = await api.auth.login({
     *   email: 'user@example.com',
     *   password: 123456
     * });
     * console.log(result.data.token); // 保存 token
     * api.setToken(result.data.token);
     * ```
     */
    login: async (params: LoginParams): Promise<LskyProResponse<LoginData>> => {
      const response = await this.request<LoginData>('POST', '/api/v2/login', { body: params });

      // 自动保存 token
      if (response.data?.token) {
        this.setToken(response.data.token);
      }

      return response;
    },

    /**
     * 用户登出
     * @returns Promise<void>
     */
    logout: async (): Promise<LskyProResponse<null>> => {
      try {
        const response = await this.request<null>('POST', '/api/v2/logout');
        // 登出成功后清除本地 token
        this.clearToken();
        return response;
      } catch (error) {
        // 即使请求失败也清除本地 token
        this.clearToken();
        throw error;
      }
    },

    /**
     * 用户注册
     * @param params - 注册参数
     * @returns Promise<unknown>
     */
    register: async (params: RegisterParams): Promise<LskyProResponse<unknown>> => {
      return this.request<unknown>('POST', '/api/v2/register', { body: params });
    },
  };

  // ============================================================================
  // 图片上传模块
  // ============================================================================

  /**
   * 上传图片（V2 API）
   * @param file - 要上传的文件
   * @param options - 上传选项
   * @returns Promise<UploadV2Data>
   *
   * @example
   * ```typescript
   * // 基本上传
   * const result = await api.upload(fileInput.files[0]);
   * console.log(result.data.url);
   *
   * // 上传到指定相册
   * const result = await api.upload(file, { album_id: 1 });
   *
   * // 私有上传
   * const result = await api.upload(file, { permission: '1' });
   * ```
   */
  async upload(
    file: File | Blob,
    options?: Partial<Pick<UploadParams, 'album_id' | 'permission' | 'key' | 'strategy_id'>>
  ): Promise<LskyProResponse<UploadV2Data>> {
    const formData = new FormData();

    // 添加文件
    if (file instanceof File) {
      formData.append('file', file, file.name);
    } else {
      formData.append('file', file);
    }

    // 添加可选参数
    if (options?.album_id !== undefined) {
      formData.append('album_id', String(options.album_id));
    }
    if (options?.permission !== undefined) {
      formData.append('permission', options.permission);
    }
    if (options?.key !== undefined) {
      formData.append('key', options.key);
    }
    if (options?.strategy_id !== undefined) {
      formData.append('strategy_id', String(options.strategy_id));
    }

    return this.request<UploadV2Data>('POST', '/api/v2/upload', { formData });
  }

  /**
   * 上传图片（V1 API，兼容旧版）
   * @param file - 要上传的文件
   * @param token - 认证 Token（如果不使用实例的 token）
   * @returns Promise<UploadV1Data>
   */
  async uploadV1(
    file: File | Blob,
    token?: string
  ): Promise<LskyProResponse<UploadV1Data>> {
    const formData = new FormData();

    // 添加文件
    if (file instanceof File) {
      formData.append('file', file, file.name);
    } else {
      formData.append('file', file);
    }

    // 使用传入的 token 或实例的 token
    const effectiveToken = token || this._token;
    if (!effectiveToken) {
      throw new LskyProAPIError(
        'Token is required for V1 upload',
        401,
        40101
      );
    }

    // V1 使用不同的认证方式
    const headers: Record<string, string> = {};
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    return this.request<UploadV1Data>('POST', '/api/v1/upload', { formData, headers });
  }

  // ============================================================================
  // 图库管理模块
  // ============================================================================

  /** 图片管理 API */
  readonly photos = {
    /**
     * 获取图片列表（分页）
     * @param params - 分页和筛选参数
     * @returns Promise<PaginatedResponse<Photo>>
     *
     * @example
     * ```typescript
     * // 获取第一页
     * const result = await api.photos.list({ page: 1, per_page: 20 });
     * console.log(result.data.data); // 图片数组
     * console.log(result.data.meta.pagination.total); // 总数
     *
     * // 搜索图片
     * const result = await api.photos.list({ keyword: 'screenshot' });
     *
     * // 按相册筛选
     * const result = await api.photos.list({ album_id: 5 });
     * ```
     */
    list: async (
      params?: PaginationParams
    ): Promise<LskyProResponse<PaginatedResponse<Photo>>> => {
      return this.request<PaginatedResponse<Photo>>('GET', '/api/v2/user/photos', {
        query: {
          page: params?.page ?? 1,
          per_page: params?.per_page ?? 15,
          keyword: params?.keyword,
          sort_by: params?.sort_by,
          sort_direction: params?.sort_direction,
          status: params?.status,
          album_id: params?.album_id,
        },
      });
    },

    /**
     * 获取单个图片详情
     * @param id - 图片 ID
     * @returns Promise<Photo>
     */
    get: async (id: number): Promise<LskyProResponse<Photo>> => {
      return this.request<Photo>('GET', `/api/v2/user/photos/${id}`);
    },

    /**
     * 更新图片信息
     * @param id - 图片 ID
     * @param data - 更新数据
     * @returns Promise<Photo>
     *
     * @example
     * ```typescript
     * // 移动到其他相册
     * await api.photos.update(123, { album_id: 5 });
     *
     * // 设为私有
     * await api.photos.update(123, { permission: 1 });
     *
     * // 清除相册
     * await api.photos.update(123, { album_id: null });
     * ```
     */
    update: async (
      id: number,
      data: UpdatePhotoData
    ): Promise<LskyProResponse<Photo>> => {
      return this.request<Photo>('PUT', `/api/v2/user/photos/${id}`, { body: data });
    },

    /**
     * 删除图片
     * @param id - 图片 ID
     * @returns Promise<null>
     */
    delete: async (id: number): Promise<LskyProResponse<null>> => {
      return this.request<null>('DELETE', `/api/v2/user/photos/${id}`);
    },

    /**
     * 批量更新图片
     * @param data - 批量更新参数
     * @returns Promise<null>
     *
     * @example
     * ```typescript
     * // 批量移动到相册
     * await api.photos.batchUpdate({
     *   ids: [1, 2, 3],
     *   album_id: 5
     * });
     *
     * // 批量设为私有
     * await api.photos.batchUpdate({
     *   ids: [1, 2, 3],
     *   permission: 1
     * });
     * ```
     */
    batchUpdate: async (
      data: BatchUpdatePhotosData
    ): Promise<LskyProResponse<null>> => {
      return this.request<null>('PUT', '/api/v2/user/photos/batch', { body: data });
    },
  };

  // ============================================================================
  // 相册管理模块
  // ============================================================================

  /** 相册管理 API */
  readonly albums = {
    /**
     * 获取相册列表（分页）
     * @param params - 分页参数
     * @returns Promise<PaginatedResponse<Album>>
     *
     * @example
     * ```typescript
     * const result = await api.albums.list({ page: 1, per_page: 20 });
     * console.log(result.data.data); // 相册数组
     * ```
     */
    list: async (
      params?: Pick<PaginationParams, 'page' | 'per_page'>
    ): Promise<LskyProResponse<PaginatedResponse<Album>>> => {
      return this.request<PaginatedResponse<Album>>('GET', '/api/v2/user/albums', {
        query: {
          page: params?.page ?? 1,
          per_page: params?.per_page ?? 15,
        },
      });
    },

    /**
     * 获取单个相册详情
     * @param id - 相册 ID
     * @returns Promise<Album>
     */
    get: async (id: number): Promise<LskyProResponse<Album>> => {
      return this.request<Album>('GET', `/api/v2/user/albums/${id}`);
    },

    /**
     * 创建相册
     * @param data - 相册数据
     * @returns Promise<Album>
     *
     * @example
     * ```typescript
     * const result = await api.albums.create({
     *   name: '我的截图',
     *   description: '工作相关的截图'
     * });
     * console.log(result.data.id); // 新建相册 ID
     * ```
     */
    create: async (data: AlbumData): Promise<LskyProResponse<Album>> => {
      return this.request<Album>('POST', '/api/v2/user/albums', { body: data });
    },

    /**
     * 更新相册
     * @param id - 相册 ID
     * @param data - 更新数据
     * @returns Promise<Album>
     */
    update: async (
      id: number,
      data: Partial<AlbumData>
    ): Promise<LskyProResponse<Album>> => {
      return this.request<Album>('PUT', `/api/v2/user/albums/${id}`, { body: data });
    },

    /**
     * 删除相册
     * @param id - 相册 ID
     * @returns Promise<null>
     */
    delete: async (id: number): Promise<LskyProResponse<null>> => {
      return this.request<null>('DELETE', `/api/v2/user/albums/${id}`);
    },
  };
}

// ============================================================================
// 导出
// ============================================================================

// 默认导出类
export default LskyProAPI;

// 所有类型已在上方通过 export interface/export class 导出，无需重复导出
