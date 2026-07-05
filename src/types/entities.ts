import type { ContentStatus, FavoriteTargetType, AdminRole, UserStatus, Platform } from './common'

export interface UserProfile {
  uid: string
  publicId: string
  displayName: string
  photoURL: string
  email: string | null
  role: AdminRole
  status: UserStatus
  banReason: string | null
  bannedAt: string | null
  level: number
  signature: string
  bio: string
}

export interface MusicExternalSource {
  id: string
  resourceType: 'song' | 'album'
  platform: Platform
  sourceId: string
  sourceUrl?: string | null
  isPrimary: boolean
  createdAt?: string
  updatedAt?: string
}

export interface SongItem {
  docId: string
  slug?: string
  title: string
  artists: string[]
  lyricists?: string[]
  composers?: string[]
  arrangers?: string[]
  vocals?: string[]
  album: string
  displayAlbum?: {
    mode: 'linked' | 'manual' | 'none'
    albumDocId: string | null
    title: string
  }
  cover: string
  coverThumbnail?: string
  audioUrl: string
  releaseDate?: string | null
  durationMs?: number | null
  lyric?: string | null
  description?: string | null
  favoritedByMe?: boolean
  sources?: MusicExternalSource[]
  playable?: boolean
  createdAt?: string
}

export interface AlbumItem {
  docId?: string
  slug?: string
  title: string
  artist: string
  cover: string
  coverThumbnail?: string
  description?: string | null
  sources?: MusicExternalSource[]
  trackCount?: number
  tracks?: unknown[]
}

export interface PostItem {
  id: string
  slug?: string
  title: string
  section: string
  content: string
  mentionTargets?: MentionTarget[]
  tags?: string[]
  locationCode?: string | null
  locationName?: string | null
  locationDetail?: string | null
  authorUid: string
  authorPublicId?: string | null
  status?: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  likedByMe?: boolean
  dislikedByMe?: boolean
  favoritedByMe?: boolean
  likesCount: number
  dislikesCount: number
  commentsCount: number
  isPinned?: boolean
  musicDocId?: string | null
  albumDocId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CommentItem {
  id: string
  postId: string
  authorUid: string
  authorPublicId?: string | null
  authorName: string
  authorPhoto: string | null
  content: string
  mentionTargets?: MentionTarget[]
  parentId: string | null
  replyToId?: string | null
  replyToAuthorUid?: string | null
  replyToAuthorName?: string | null
  isDeleted: boolean
  deletedAt?: string | null
  deletedBy?: string | null
  deletedByName?: string | null
  deletionReason?: string | null
  likesCount?: number
  likedByMe?: boolean
  createdAt: string
  post?: { id: string; slug?: string; title: string; status: string } | null
}

export interface SectionItem {
  id: string
  name: string
  description?: string
  order: number
}

export interface WikiCategoryItem {
  id: string
  name: string
  description?: string
  order: number
  requiresAdminEdit: boolean
}

export interface WikiItem {
  id: string
  slug?: string
  title: string
  category: string
  content: string
  tags?: string[]
  eventDate?: string | null
  status?: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  favoritesCount?: number
  favoritedByMe?: boolean
  likesCount?: number
  dislikesCount?: number
  likedByMe?: boolean
  dislikedByMe?: boolean
  isPinned?: boolean
  lastEditorUid: string
  lastEditorName: string
  locationCode?: string | null
  locationName?: string | null
  locationDetail?: string | null
  createdAt: string
  updatedAt: string
}

export interface GalleryItem {
  id: string
  slug?: string
  title: string
  description: string
  authorUid: string
  authorPublicId?: string | null
  authorName: string
  tags: string[]
  locationCode: string | null
  locationName: string | null
  locationDetail: string | null
  copyright: string | null
  status?: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  published: boolean
  publishedAt: string | null
  likesCount?: number
  dislikesCount?: number
  favoritesCount?: number
  likedByMe?: boolean
  dislikedByMe?: boolean
  favoritedByMe?: boolean
  createdAt: string
  updatedAt: string
  images: GalleryImageItem[]
}

export type ThumbnailStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface GalleryImageItem {
  id: string
  assetId: string | null
  url: string
  originalUrl?: string | null
  thumbnailUrl?: string | null
  thumbnailStatus?: ThumbnailStatus | null
  name: string
  mimeType: string | null
  sizeBytes: number | null
}

export interface EventTimeSlot {
  type: 'date' | 'datetime'
  start: string
  end?: string
}

export interface EventSaleTime {
  time: string
  note?: string
}

export interface EventExternalLink {
  label: string
  url: string
}

export interface EventTicketPrice {
  description?: string
  price: number
}

export interface EventPosterItem extends Pick<
  GalleryImageItem,
  'id' | 'assetId' | 'url' | 'originalUrl' | 'thumbnailUrl' | 'thumbnailStatus' | 'name'
> {}

export interface EventItem {
  id: string
  slug: string
  title: string
  location: string
  content: string
  timeSlots: EventTimeSlot[]
  ticketPrices: unknown[]
  saleTimes: EventSaleTime[]
  lineup: string[]
  tags: string[]
  externalLinks: EventExternalLink[]
  relatedLinks: EventExternalLink[]
  sortStart: string | null
  sortEnd: string | null
  coverAssetId: string | null
  coverUrl: string | null
  coverName: string | null
  coverThumbnailUrl?: string | null
  coverThumbnailStatus?: ThumbnailStatus | null
  createdByUid: string
  createdByName: string | null
  updatedByUid: string | null
  updatedByName: string | null
  deletedAt?: string | null
  deletedBy?: string | null
  isDeleted?: boolean
  createdAt: string
  updatedAt: string
  posters: EventPosterItem[]
}

export interface AnnouncementItem {
  id: string
  content: string
  link?: string | null
  createdAt: string
}

export interface NotificationItem {
  id: string
  type: 'reply' | 'like' | 'review_result' | 'mention'
  payload: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

export interface MentionTarget {
  uid: string
  publicId: string
  displayName: string
  photoURL?: string | null
}

export interface FavoriteItem {
  id: string
  targetType: FavoriteTargetType
  targetId: string
  createdAt: string
  target: {
    slug?: string
    title?: string
    id?: string
    category?: string
    status?: string
    type?: string
    section?: string
    artists?: string[]
    album?: string
  } | null
}

export interface HistoryItem {
  id: string
  targetType: 'wiki' | 'post' | 'music'
  targetId: string
  createdAt: string
  target: {
    slug?: string
    title?: string
    id?: string
    category?: string
    status?: string
    type?: string
    section?: string
    artists?: string[]
    album?: string
  } | null
}

export interface ImageMap {
  id: string
  md5: string
  localUrl: string
  externalUrl?: string
  s3Url?: string
  storageType?: 'local' | 's3' | 'external'
  thumbnailUrl?: string
  blurhash?: string
  thumbhash?: string
  createdAt: string
}

export interface EditLockItem {
  id: string
  collection: string
  recordId: string
  userId: string
  username: string
  createdAt: string
  expiresAt: string
}

export interface ReviewQueueItem {
  id: string
  type: 'wiki' | 'posts'
  title?: string
  slug?: string
  status?: ContentStatus
  authorUid?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface ReviewQueueBucket {
  type: 'wiki' | 'posts'
  items: ReviewQueueItem[]
}

export interface AdminDataItem {
  id?: string
  docId?: string
  uid?: string
  title?: string
  slug?: string
  displayName?: string
  name?: string
  email?: string
  emailVerified?: boolean
  emailVerifiedAt?: string | null
  role?: string
  status?: string
  signature?: string
  bio?: string
  photoURL?: string
  cover?: string
  content?: string
  description?: string
  artist?: string
  artists?: string[]
  section?: string
  category?: string
  collection?: string
  recordId?: string
  userId?: string
  username?: string
  expiresAt?: string
  active?: boolean
  sensitiveWords?: string[]
  operatorName?: string
  operatorUid?: string
  targetName?: string
  targetUid?: string
  targetType?: string
  targetId?: string
  action?: string
  note?: string
  isDeleted?: boolean
  deletedAt?: string | null
  deletedBy?: string | null
  deletionReason?: string | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}
