import type { GalleryItem } from './entities';

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HomeFeedResponse {
  announcements: Array<{
    id: string;
    content: string;
    link?: string;
    createdAt: string;
  }>;
  hotPosts: Array<{
    id: string;
    title: string;
    section: string;
    commentsCount: number;
    likesCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  recentPosts: Array<{
    id: string;
    title: string;
    section: string;
    commentsCount: number;
    likesCount: number;
    updatedAt: string;
  }>;
}

export interface NotificationsResponse {
  notifications: Array<{
    id: string;
    type: 'reply' | 'like' | 'review_result';
    payload: Record<string, unknown>;
    isRead: boolean;
    createdAt: string;
  }>;
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

export interface UploadSessionResponse {
  session: {
    id: string;
    status: 'open' | 'finalized' | 'expired';
    maxFiles: number;
    uploadedFiles: number;
    expiresAt: string;
  };
}

export interface UploadFileResponse {
  session: {
    id: string;
    status: 'open' | 'finalized' | 'expired';
    uploadedFiles: number;
    maxFiles: number;
  };
  asset: {
    id: string;
    url: string;
    publicUrl?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    md5?: string;
  };
  tripleStorage?: {
    localUrl: string;
    s3Url?: string;
    externalUrl?: string;
  };
}

export interface GalleryCreateResponse {
  gallery: {
    id: string;
  };
}

export interface ImageStats {
  total: number;
  stats: {
    local: number;
    external: number;
    s3: number;
  };
}

export interface ImagePreference {
  strategy: 'local' | 's3' | 'external';
  fallback: boolean;
}

// ============================================================================
// 错误类型定义
// ============================================================================

export type ErrorType = 'NetworkError' | 'AuthError' | 'BusinessError' | 'ServerError';

export interface ApiErrorObject {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// 通用响应类型
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
}

// ============================================================================
// 认证相关类型
// ============================================================================

export interface AuthMeResponse {
  user: {
    uid: string;
    nickname: string;
    avatarUrl?: string;
    role: 'user' | 'admin' | 'super_admin';
    status: 'active' | 'banned' | 'pending';
    preferences?: Record<string, unknown>;
  } | null;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  nickname: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

// ============================================================================
// 用户相关类型
// ============================================================================

export interface UserUpdateRequest {
  nickname?: string;
  avatarUrl?: string;
  preferences?: Record<string, unknown>;
}

export interface UserResponse {
  user: {
    uid: string;
    nickname: string;
    avatarUrl?: string;
    role: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

// ============================================================================
// Wiki 相关类型
// ============================================================================

export interface WikiDetailResponse {
  wiki: {
    id: string;
    slug: string;
    title: string;
    category: string;
    content: string;
    summary?: string;
    tags?: string[];
    likes: number;
    dislikes: number;
    views: number;
    isPinned: boolean;
    status: 'draft' | 'pending' | 'approved' | 'rejected';
    createdAt: string;
    updatedAt: string;
    author?: UserResponse['user'];
  };
}

export interface WikiListResponse extends PaginatedResponse<WikiDetailResponse['wiki']> {}

// ============================================================================
// 帖子相关类型
// ============================================================================

export interface PostDetailResponse {
  post: {
    id: string;
    title: string;
    content: string;
    sectionId: string;
    authorId: string;
    likes: number;
    dislikes: number;
    commentsCount: number;
    views: number;
    isPinned: boolean;
    status: string;
    createdAt: string;
    updatedAt: string;
    author?: UserResponse['user'];
    section?: {
      id: string;
      name: string;
    };
  };
}

export interface PostListResponse extends PaginatedResponse<PostDetailResponse['post']> {}

// ============================================================================
// 音乐相关类型
// ============================================================================

export interface MusicListResponse {
  songs: Array<{
    id: string;
    docId: string;
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    playUrl?: string;
    duration?: number;
    createdAt: string;
  }>;
  total: number;
}

export interface MusicDetailResponse {
  song: {
    id: string;
    docId: string;
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    playUrl?: string;
    duration?: number;
    createdAt: string;
  };
}

export interface MusicPlayUrlResponse {
  playUrl: string;
}

// ============================================================================
// 画廊相关类型
// ============================================================================

export interface GalleryDetailResponse {
  gallery: GalleryItem;
}

export interface GalleryListResponse {
  galleries: GalleryItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface GalleryUploadResponse {
  urls: string[];
}

// ============================================================================
// 管理相关类型
// ============================================================================

export interface AdminBackup {
  filename: string;
  size: number;
  createdAt: string;
}

export interface AdminBackupsResponse {
  backups: AdminBackup[];
}

export interface AdminReviewQueueItem {
  id: string;
  type: 'wiki' | 'post' | 'gallery';
  title: string;
  author: UserResponse['user'];
  submittedAt: string;
}

export interface AdminReviewQueueResponse {
  items: AdminReviewQueueItem[];
  total: number;
}

// ============================================================================
// 文本语义搜索类型
// ============================================================================

export type TextSearchResult =
  | {
      sourceType: 'wiki'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { slug: string; title?: string; [key: string]: unknown }
    }
  | {
      sourceType: 'post'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { id: string; title?: string; [key: string]: unknown }
    }
  | {
      sourceType: 'music'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { id: string; title?: string; artist?: string; [key: string]: unknown }
    }
  | {
      sourceType: 'album'
      sourceId: string
      score: number
      chunkPreview: string
      entity: { id: string; title?: string; artist?: string; [key: string]: unknown }
    }

export interface TextSearchResponse {
  results: TextSearchResult[]
  total: number
  query: string
  minScore: number
}
