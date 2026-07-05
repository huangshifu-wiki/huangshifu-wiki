import { Request } from 'express'
import type { ParamsFlatDictionary } from 'express-serve-static-core'
import type { ParsedQs } from 'qs'
import { JwtPayload } from 'jsonwebtoken'
import { Prisma, UserRole as PrismaUserRole } from '@prisma/client'
import type { WikiRelationType } from '../../lib/relationConstants'

type UserStatus = 'active' | 'banned'
type ContentStatus = 'draft' | 'pending' | 'published' | 'rejected'
type WikiBranchStatus = 'draft' | 'pending_review' | 'merged' | 'rejected' | 'conflict'
type WikiPullRequestStatus = 'open' | 'merged' | 'rejected'
type FavoriteTargetType = 'wiki' | 'post' | 'music' | 'gallery'
type ModerationTargetType = 'wiki' | 'post' | 'gallery' | 'comment'
type NotificationType = 'reply' | 'like' | 'review_result' | 'mention'
type BrowsingTargetType = 'wiki' | 'post' | 'music'
type PostSortType = 'latest' | 'hot' | 'recommended'

type MusicPlatform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo'
type DisplayAlbumMode = 'none' | 'linked' | 'manual'
type MusicExternalResourceType = 'song' | 'album'

type MusicExternalSourceRecord = {
  id: string
  resourceType: MusicExternalResourceType
  songDocId: string | null
  albumDocId: string | null
  platform: MusicPlatform
  sourceId: string
  sourceUrl: string | null
  isPrimary: boolean
  createdAt: Date
  updatedAt: Date
}

type WikiRelationRecord = {
  type: WikiRelationType
  targetSlug: string
  label?: string
  bidirectional: boolean
}

type WikiRelationResolved = WikiRelationRecord & {
  typeLabel: string
  targetTitle: string
  targetCategory: string
  inferred: boolean
  sourceSlug: string
  sourceTitle: string
}

type WikiRelationGraphNode = {
  slug: string
  title: string
  category: string
  depth: 0 | 1 | 2
  isCenter: boolean
}

type WikiRelationGraphEdge = {
  sourceSlug: string
  targetSlug: string
  type: WikiRelationType
  typeLabel: string
  label: string | null
  inferred: boolean
}

type MusicTrackWithRelations = {
  docId: string
  slug: string
  title: string
  artists: string[]
  lyricists: string[]
  composers: string[]
  arrangers: string[]
  vocals: string[]
  album: string
  audioUrl: string
  lyric: string | null
  description: string | null
  releaseDate: Date | null
  durationMs: number | null
  coverId: string | null
  coverAlbumDocId: string | null
  customPlatformLinks: Prisma.JsonValue | null
  displayAlbumMode: DisplayAlbumMode
  manualAlbumName: string | null
  createdAt: Date
  updatedAt: Date
  covers: Array<{
    id: string
    publicUrl: string
    thumbnailUrl: string | null
    isDefault: boolean
    sortOrder: number
  }>
  albumRelations: Array<{
    albumDocId: string
    discNumber: number
    trackOrder: number
    isDisplay: boolean
    album: {
      docId: string
      slug: string
      title: string
      artist: string
      releaseDate: Date | null
      coverId: string | null
      covers: Array<{
        id: string
        publicUrl: string
        thumbnailUrl: string | null
        isDefault: boolean
      }>
    }
  }>
  instrumentalLinks?: Array<{
    targetSongDocId: string
  }>
  externalSources: MusicExternalSourceRecord[]
}

interface PlayUrlCacheValue {
  platform: MusicPlatform
  sourceId: string
  url: string
  fetchedAt: number
  expiresAt: number
}

interface ImportSongInput {
  sourceId: string
  title: string
  artists: string[]
  album: string
  picId: string
  urlId: string
  lyricId: string
  cover: string
  sourceUrl: string
  isInstrumental?: boolean
}

type SongCustomPlatformLink = {
  label: string
  url: string
}

interface SessionJwtPayload extends JwtPayload {
  uid: string
  role: PrismaUserRole
  sessionVersion: string
}

interface WechatCodeSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

interface ApiUser {
  uid: string
  publicId: string
  email: string
  displayName: string
  photoURL: string | null
  wechatBound: boolean
  role: PrismaUserRole
  status: UserStatus
  banReason: string | null
  bannedAt: string | null
  emailVerified: boolean
  level: number
  signature: string
  bio: string
}

type AuthenticatedRequest = Request<ParamsFlatDictionary, any, any, ParsedQs> & {
  authUser?: ApiUser
}

type WikiResponseInput = {
  id: string
  slug: string
  title: string
  category: string
  content: string
  tags: unknown
  relations?: unknown
  eventDate: string | null
  locationCode?: string | null
  locationDetail?: string | null
  status: ContentStatus
  reviewNote: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  viewCount?: number
  favoritesCount: number
  isPinned: boolean
  likesCount: number
  dislikesCount: number
  deletedAt?: Date | null
  deletedBy?: string | null
  lastEditorUid: string
  lastEditor?: { displayName: string } | null
  createdAt: Date
  updatedAt: Date
  location?: { code: string; name: string; fullName: string } | null
}

type WikiRelationPageLite = {
  slug: string
  title: string
  category: string
  status: ContentStatus
  lastEditorUid: string
  relations: unknown
}

type WikiReverseRelationEntry = {
  sourcePage: WikiRelationPageLite
  relation: WikiRelationRecord
}

type WikiRelationBundle = {
  centerPage: WikiRelationPageLite
  relations: WikiRelationResolved[]
  graph: {
    nodes: WikiRelationGraphNode[]
    edges: WikiRelationGraphEdge[]
  }
}

type WikiBranchWithPage = {
  id: string
  pageSlug: string
  editorUid: string
  editorName: string
  status: WikiBranchStatus
  latestRevisionId: string | null
  createdAt: Date
  updatedAt: Date
  page?: {
    slug: string
    title: string
    category: string
  } | null
}

type WikiPullRequestWithRelations = {
  id: string
  branchId: string
  pageSlug: string
  title: string
  description: string | null
  status: WikiPullRequestStatus
  createdByUid: string
  createdByName: string
  reviewedBy: string | null
  reviewedAt: Date | null
  mergedAt: Date | null
  baseRevisionId: string | null
  conflictData: unknown
  createdAt: Date
  updatedAt: Date
  branch?: WikiBranchWithPage | null
  page?: {
    slug: string
    title: string
    category: string
  } | null
  comments?: {
    id: string
    prId: string
    authorUid: string
    authorName: string
    content: string
    createdAt: Date
  }[]
}

const WIKI_RELATION_SCAN_LIMIT = 800
const MUSIC_SECTION_ID = 'music'
const EDIT_LOCK_COLLECTION_ALLOWLIST = new Set([
  'songs',
  'albums',
  'galleries',
  'activities',
  'wiki',
  'posts',
])
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
])

export type {
  UserStatus,
  ContentStatus,
  WikiBranchStatus,
  WikiPullRequestStatus,
  WikiRelationType,
  FavoriteTargetType,
  ModerationTargetType,
  NotificationType,
  BrowsingTargetType,
  PostSortType,
  MusicPlatform,
  DisplayAlbumMode,
  WikiRelationRecord,
  WikiRelationResolved,
  WikiRelationGraphNode,
  WikiRelationGraphEdge,
  MusicTrackWithRelations,
  PlayUrlCacheValue,
  ImportSongInput,
  SongCustomPlatformLink,
  MusicExternalResourceType,
  MusicExternalSourceRecord,
  SessionJwtPayload,
  WechatCodeSessionResponse,
  ApiUser,
  AuthenticatedRequest,
  WikiResponseInput,
  WikiRelationPageLite,
  WikiReverseRelationEntry,
  WikiRelationBundle,
  WikiBranchWithPage,
  WikiPullRequestWithRelations,
}

export {
  WIKI_RELATION_SCAN_LIMIT,
  MUSIC_SECTION_ID,
  EDIT_LOCK_COLLECTION_ALLOWLIST,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
}
