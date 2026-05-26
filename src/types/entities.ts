import type { ContentStatus, FavoriteTargetType, AdminRole, UserStatus, Platform } from './common';

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  email: string | null;
  role: AdminRole;
  status: UserStatus;
  banReason: string | null;
  bannedAt: string | null;
  level: number;
  bio: string;
}

export interface PlatformIds {
  neteaseId?: string | null;
  tencentId?: string | null;
  kugouId?: string | null;
  baiduId?: string | null;
  kuwoId?: string | null;
}

export interface SongItem {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  primaryPlatform?: Platform | null;
  lyric?: string | null;
  favoritedByMe?: boolean;
  platformIds?: PlatformIds;
  createdAt?: string;
}

export interface AlbumItem {
  docId?: string;
  id: string;
  title: string;
  artist: string;
  cover: string;
  description?: string | null;
  trackCount?: number;
  tracks?: unknown[];
}

export interface PostItem {
  id: string;
  title: string;
  section: string;
  content: string;
  tags?: string[];
  locationCode?: string | null;
  locationName?: string | null;
  locationDetail?: string | null;
  authorUid: string;
  status?: ContentStatus;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  likedByMe?: boolean;
  dislikedByMe?: boolean;
  favoritedByMe?: boolean;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  isPinned?: boolean;
  musicDocId?: string | null;
  albumDocId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentItem {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  content: string;
  parentId: string | null;
  replyToId?: string | null;
  replyToAuthorUid?: string | null;
  replyToAuthorName?: string | null;
  isDeleted: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedByName?: string | null;
  likesCount?: number;
  likedByMe?: boolean;
  createdAt: string;
  post?: { id: string; title: string; status: string } | null;
}

export interface SectionItem {
  id: string;
  name: string;
  description?: string;
  order: number;
}

export interface WikiItem {
  id: string;
  slug: string;
  title: string;
  category: string;
  content: string;
  tags?: string[];
  eventDate?: string | null;
  status?: ContentStatus;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  favoritesCount?: number;
  favoritedByMe?: boolean;
  likesCount?: number;
  dislikesCount?: number;
  likedByMe?: boolean;
  dislikedByMe?: boolean;
  isPinned?: boolean;
  lastEditorUid: string;
  lastEditorName: string;
  locationCode?: string | null;
  locationName?: string | null;
  locationDetail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryItem {
  id: string;
  title: string;
  description: string;
  authorUid: string;
  authorName: string;
  tags: string[];
  locationCode: string | null;
  locationName: string | null;
  locationDetail: string | null;
  copyright: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  images: GalleryImageItem[];
}

export interface GalleryImageItem {
  id: string;
  assetId: string | null;
  url: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface AnnouncementItem {
  id: string;
  content: string;
  link?: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: 'reply' | 'like' | 'review_result';
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface FavoriteItem {
  id: string;
  targetType: FavoriteTargetType;
  targetId: string;
  createdAt: string;
  target: {
    slug?: string;
    title?: string;
    id?: string;
    category?: string;
    status?: string;
    type?: string;
    section?: string;
    artist?: string;
    album?: string;
  } | null;
}

export interface HistoryItem {
  id: string;
  targetType: 'wiki' | 'post' | 'music';
  targetId: string;
  createdAt: string;
  target: {
    slug?: string;
    title?: string;
    id?: string;
    category?: string;
    status?: string;
    type?: string;
    section?: string;
    artist?: string;
    album?: string;
  } | null;
}

export interface ImageMap {
  id: string;
  md5: string;
  localUrl: string;
  externalUrl?: string;
  s3Url?: string;
  storageType?: 'local' | 's3' | 'external';
  blurhash?: string;
  thumbhash?: string;
  createdAt: string;
}

export interface EditLockItem {
  id: string;
  collection: string;
  recordId: string;
  userId: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface ReviewQueueItem {
  id: string;
  type: 'wiki' | 'posts';
  title?: string;
  slug?: string;
  status?: ContentStatus;
  authorUid?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ReviewQueueBucket {
  type: 'wiki' | 'posts';
  items: ReviewQueueItem[];
}

export interface AdminDataItem {
  id?: string;
  uid?: string;
  title?: string;
  slug?: string;
  displayName?: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  photoURL?: string;
  cover?: string;
  content?: string;
  description?: string;
  artist?: string;
  section?: string;
  category?: string;
  collection?: string;
  recordId?: string;
  userId?: string;
  username?: string;
  expiresAt?: string;
  active?: boolean;
  sensitiveWords?: string[];
  operatorName?: string;
  operatorUid?: string;
  targetName?: string;
  targetUid?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
