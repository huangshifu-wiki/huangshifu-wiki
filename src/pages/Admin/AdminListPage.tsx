import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  Book,
  CheckCircle,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquare,
  Music,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  invalidateApiCacheByPrefix,
} from '../../lib/apiClient'
import {
  DANGER_BUTTON_CLASSES,
  SUCCESS_BUTTON_CLASSES,
  WARNING_BUTTON_CLASSES,
} from '../../lib/buttonClasses'
import { formatDateTime } from '../../lib/dateUtils'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { formatMusicCredits } from '../../lib/musicCredits'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { SmartImage } from '../../components/SmartImage'
import { MusicImportModal } from '../../components/MusicImportModal'
import { SongFormModal } from '../../components/SongFormModal'
import Pagination from '../../components/Pagination'
import { usePagination } from '../../hooks/usePagination'
import type { ContentStatus } from '../../types/common'
import type { AdminDataItem } from '../../types/entities'

type ListType = 'wiki' | 'music' | 'posts' | 'galleries' | 'sections' | 'announcements'

type ColumnKey =
  | 'details'
  | 'status'
  | 'owner'
  | 'metrics'
  | 'relations'
  | 'tags'
  | 'media'
  | 'link'
  | 'order'
  | 'ids'
  | 'lifecycle'
  | 'actions'

type ListConfig = {
  title: string
  icon: React.ElementType
  apiPath: string
  columns: { key: ColumnKey; label: string; className?: string }[]
  hasCreate: boolean
}

type AdminListResponse = {
  data: AdminDataItem[]
  total?: number
}

const configMap: Record<ListType, ListConfig> = {
  wiki: {
    title: '百科管理',
    icon: Book,
    apiPath: 'wiki',
    columns: [
      { key: 'details', label: '页面', className: 'min-w-[280px]' },
      { key: 'status', label: '状态', className: 'min-w-[110px]' },
      { key: 'owner', label: '编辑者', className: 'min-w-[140px]' },
      { key: 'metrics', label: '数据', className: 'min-w-[180px]' },
      { key: 'tags', label: '标签/位置', className: 'min-w-[180px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: false,
  },
  music: {
    title: '音乐管理',
    icon: Music,
    apiPath: 'music',
    columns: [
      { key: 'details', label: '歌曲', className: 'min-w-[260px]' },
      { key: 'status', label: '平台', className: 'min-w-[130px]' },
      { key: 'relations', label: '专辑', className: 'min-w-[180px]' },
      { key: 'ids', label: '平台 ID', className: 'min-w-[220px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: false,
  },
  posts: {
    title: '帖子管理',
    icon: MessageSquare,
    apiPath: 'posts',
    columns: [
      { key: 'details', label: '帖子', className: 'min-w-[300px]' },
      { key: 'status', label: '状态', className: 'min-w-[110px]' },
      { key: 'owner', label: '作者', className: 'min-w-[140px]' },
      { key: 'metrics', label: '数据', className: 'min-w-[210px]' },
      { key: 'relations', label: '关联', className: 'min-w-[180px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: false,
  },
  galleries: {
    title: '图集管理',
    icon: ImageIcon,
    apiPath: 'galleries',
    columns: [
      { key: 'details', label: '图集', className: 'min-w-[280px]' },
      { key: 'status', label: '发布', className: 'min-w-[120px]' },
      { key: 'owner', label: '作者', className: 'min-w-[140px]' },
      { key: 'media', label: '图片/版权', className: 'min-w-[170px]' },
      { key: 'tags', label: '标签/位置', className: 'min-w-[180px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: false,
  },
  sections: {
    title: '版块管理',
    icon: Layers,
    apiPath: 'sections',
    columns: [
      { key: 'details', label: '版块', className: 'min-w-[260px]' },
      { key: 'order', label: '排序', className: 'min-w-[90px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: true,
  },
  announcements: {
    title: '公告管理',
    icon: Megaphone,
    apiPath: 'announcements',
    columns: [
      { key: 'details', label: '公告', className: 'min-w-[300px]' },
      { key: 'link', label: '链接', className: 'min-w-[200px]' },
      { key: 'status', label: '状态', className: 'min-w-[110px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: true,
  },
}

const contentStatuses = new Set<ContentStatus>(['draft', 'pending', 'published', 'rejected'])

const isContentStatus = (value: unknown): value is ContentStatus =>
  typeof value === 'string' && contentStatuses.has(value as ContentStatus)

const toText = (value: unknown, fallback = 'N/A') =>
  typeof value === 'string' && value.trim() ? value : fallback

const toOptionalText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const toNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const getTags = (item: AdminDataItem) =>
  Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : []

const getImages = (item: AdminDataItem) => (Array.isArray(item.images) ? item.images : [])

const getSources = (item: AdminDataItem) =>
  Array.isArray(item.sources)
    ? item.sources.filter(
        (source): source is { platform: string; sourceId: string; isPrimary?: boolean } =>
          source &&
          typeof source === 'object' &&
          typeof (source as { platform?: unknown }).platform === 'string' &&
          typeof (source as { sourceId?: unknown }).sourceId === 'string'
      )
    : []

const formatCount = (value: unknown) => toNumber(value).toLocaleString('zh-CN')

const renderBadge = (label: string, className = 'bg-surface-alt text-text-muted') => (
  <span
    className={clsx(
      'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium',
      className
    )}
  >
    {label}
  </span>
)

const renderKeyedBadge = (key: string, label: string, className?: string) => (
  <React.Fragment key={key}>{renderBadge(label, className)}</React.Fragment>
)

const renderContentStatus = (status: unknown) =>
  isContentStatus(status)
    ? renderBadge(getStatusText(status), getStatusClassName(status))
    : renderBadge(toText(status, '未知'))

const getItemHref = (type: ListType, item: AdminDataItem) => {
  if (type === 'wiki' && item.slug) return `/wiki/${item.slug}`
  if (type === 'posts' && item.id) return `/forum/${item.id}`
  if (type === 'galleries' && item.id) return `/gallery/${item.id}`
  if (type === 'music' && item.docId) return `/music/${item.docId}`
  return null
}

const renderDateBlock = (item: AdminDataItem) => {
  const reviewedAt = toOptionalText(item.reviewedAt)
  const deletionReason = toOptionalText(item.deletionReason)

  return (
    <div className="space-y-1 text-xs text-text-muted">
      <p>更新：{formatDateTime(item.updatedAt, 'N/A')}</p>
      <p>创建：{formatDateTime(item.createdAt, 'N/A')}</p>
      {reviewedAt && <p>审核：{formatDateTime(reviewedAt, 'N/A')}</p>}
      {item.deletedAt && (
        <p className="theme-text-error">删除：{formatDateTime(item.deletedAt, 'N/A')}</p>
      )}
      {item.deletedAt && deletionReason && (
        <p className="max-w-[220px] break-words theme-text-error">理由：{deletionReason}</p>
      )}
    </div>
  )
}

const renderTagsAndLocation = (item: AdminDataItem) => {
  const tags = getTags(item)
  return (
    <div className="space-y-2 text-xs">
      {tags.length > 0 ? (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {tags
            .slice(0, 4)
            .map((tag) => renderKeyedBadge(tag, tag, 'bg-surface-alt text-brand-gold'))}
          {tags.length > 4 && renderBadge(`+${tags.length - 4}`, 'bg-surface-alt text-text-muted')}
        </div>
      ) : (
        <span className="text-text-muted">无标签</span>
      )}
      <p className="truncate text-text-muted">
        {toOptionalText(item.locationName) || toOptionalText(item.locationDetail) || '未设置位置'}
      </p>
    </div>
  )
}

const renderDetails = (type: ListType, item: AdminDataItem, Icon: React.ElementType) => {
  const href = getItemHref(type, item)
  const title = toText(item.title || item.displayName || item.name || item.slug || item.id)
  const subtitle =
    type === 'music'
      ? [formatMusicCredits(item.artists, ''), item.album].filter(Boolean).join(' / ')
      : item.content?.slice(0, 80) || item.description?.slice(0, 80) || ''

  return (
    <div className="flex items-center gap-3">
      {type === 'galleries' ? (
        <SmartImage
          src={(getImages(item)[0] as { thumbnailUrl?: string } | undefined)?.thumbnailUrl || ''}
          alt=""
          className="h-11 w-11 rounded bg-surface-alt object-cover"
        />
      ) : type === 'music' ? (
        <SmartImage
          src={item.cover || ''}
          alt=""
          className="h-11 w-11 rounded bg-surface-alt object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded bg-surface-alt text-brand-gold">
          <Icon size={18} />
        </div>
      )}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          {href ? (
            <Link
              to={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-gold hover:underline"
            >
              {title}
            </Link>
          ) : (
            title
          )}
          {item.isPinned && renderBadge('置顶', 'theme-status-warning')}
          {item.isDeleted && renderBadge('已删除', 'theme-status-error')}
        </p>
        {subtitle && <p className="max-w-sm truncate text-xs text-text-muted">{subtitle}</p>}
        <p className="truncate text-[11px] text-text-muted">
          {type === 'wiki' && `slug: ${toText(item.slug)}`}
          {type === 'posts' && `ID: ${toText(item.id)}`}
          {type === 'galleries' && `ID: ${toText(item.id)}`}
          {type === 'music' && `docId: ${toText(item.docId)}`}
          {type === 'sections' && `ID: ${toText(item.id)}`}
          {type === 'announcements' && `ID: ${toText(item.id)}`}
        </p>
      </div>
    </div>
  )
}

const renderStatus = (type: ListType, item: AdminDataItem) => {
  if (item.isDeleted) return renderBadge('回收站', 'theme-status-error')
  if (type === 'announcements') {
    return renderBadge(
      item.active ? '启用中' : '已禁用',
      item.active ? 'theme-status-success' : 'bg-surface-alt text-text-muted'
    )
  }
  if (type === 'galleries') {
    const status = toOptionalText(item.status) as ContentStatus | null
    const published = status ? status === 'published' : Boolean(item.published)
    return (
      <div className="space-y-1">
        {status
          ? renderBadge(getStatusText(status), getStatusClassName(status))
          : renderBadge(
              published ? '已发布' : '未发布',
              published ? 'theme-status-success' : 'theme-status-warning'
            )}
        {toOptionalText(item.publishedAt) && (
          <p className="text-xs text-text-muted">
            {formatDateTime(toOptionalText(item.publishedAt))}
          </p>
        )}
      </div>
    )
  }
  if (type === 'music') {
    const sources = getSources(item)
    const primary = sources.find((source) => source.isPrimary) || sources[0]
    return (
      <div className="space-y-1 text-xs">
        {primary
          ? renderBadge(primary.platform, 'bg-surface-alt text-brand-gold')
          : renderBadge('无平台来源')}
        <p className="text-text-muted">来源：{sources.length}</p>
      </div>
    )
  }
  return renderContentStatus(item.status)
}

const renderOwner = (type: ListType, item: AdminDataItem) => {
  if (type === 'wiki') {
    return (
      <div className="space-y-1 text-xs">
        <p className="font-medium text-text-primary">{toText(item.lastEditorName, '匿名')}</p>
        <p className="text-text-muted">{toText(item.lastEditorUid)}</p>
      </div>
    )
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium text-text-primary">{toText(item.authorName, '匿名')}</p>
      <p className="text-text-muted">{toText(item.authorUid)}</p>
    </div>
  )
}

const renderMetrics = (type: ListType, item: AdminDataItem) => {
  if (type === 'wiki') {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>浏览 {formatCount(item.viewCount)}</span>
        <span>收藏 {formatCount(item.favoritesCount)}</span>
        <span>赞 {formatCount(item.likesCount)}</span>
        <span>踩 {formatCount(item.dislikesCount)}</span>
      </div>
    )
  }
  if (type === 'posts') {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>浏览 {formatCount(item.viewCount)}</span>
        <span>评论 {formatCount(item.commentsCount)}</span>
        <span>赞 {formatCount(item.likesCount)}</span>
        <span>热度 {toNumber(item.hotScore).toFixed(1)}</span>
      </div>
    )
  }
  return <span className="text-xs text-text-muted">N/A</span>
}

const renderRelations = (type: ListType, item: AdminDataItem) => {
  if (type === 'posts') {
    return (
      <div className="space-y-1 text-xs text-text-muted">
        <p>版块：{toText(item.section)}</p>
        <p>音乐：{toText(item.musicDocId, '未关联')}</p>
        <p>专辑：{toText(item.albumDocId, '未关联')}</p>
      </div>
    )
  }
  if (type === 'music') {
    return (
      <div className="space-y-1 text-xs text-text-muted">
        <p className="font-medium text-text-primary">{toText(item.album, '未设置专辑')}</p>
        <p>显示：{toText(item.displayAlbumMode, '默认')}</p>
        {toOptionalText(item.manualAlbumName) && (
          <p>手动：{toOptionalText(item.manualAlbumName)}</p>
        )}
      </div>
    )
  }
  return <span className="text-xs text-text-muted">N/A</span>
}

const renderExternalSources = (item: AdminDataItem) => {
  const sources = getSources(item)

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1 text-xs">
      {sources.length
        ? sources.map((source) =>
            renderKeyedBadge(
              `${source.platform}:${source.sourceId}`,
              `${source.platform}: ${source.sourceId}`,
              'bg-surface-alt text-brand-gold'
            )
          )
        : renderBadge('无外部来源')}
    </div>
  )
}

const renderMedia = (item: AdminDataItem) => (
  <div className="space-y-1 text-xs text-text-muted">
    <p>图片：{getImages(item).length}</p>
    <p className="truncate">版权：{toText(item.copyright, '未填写')}</p>
  </div>
)

const renderLink = (item: AdminDataItem) =>
  toOptionalText(item.link) ? (
    <a
      href={toOptionalText(item.link) || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-brand-gold hover:underline"
    >
      {toOptionalText(item.link)}
    </a>
  ) : (
    <span className="text-xs text-text-muted">无链接</span>
  )

const renderCell = (
  type: ListType,
  item: AdminDataItem,
  key: ColumnKey,
  Icon: React.ElementType
) => {
  if (key === 'details') return renderDetails(type, item, Icon)
  if (key === 'status') return renderStatus(type, item)
  if (key === 'owner') return renderOwner(type, item)
  if (key === 'metrics') return renderMetrics(type, item)
  if (key === 'relations') return renderRelations(type, item)
  if (key === 'tags') return renderTagsAndLocation(item)
  if (key === 'media') return renderMedia(item)
  if (key === 'link') return renderLink(item)
  if (key === 'order')
    return <span className="text-sm font-medium text-text-primary">{toNumber(item.order)}</span>
  if (key === 'ids') return renderExternalSources(item)
  if (key === 'lifecycle') return renderDateBlock(item)
  return null
}

const getAdminItemId = (item: AdminDataItem) => String(item.docId || item.id || item.uid || '')

export const AdminListPage = ({ type }: { type: ListType }) => {
  const cfg = configMap[type]
  const Icon = cfg.icon
  const [data, setData] = useState<AdminDataItem[]>([])
  const [musicTotal, setMusicTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pendingActions, setPendingActions] = useState<
    Record<string, 'delete' | 'restore' | 'permanentDelete'>
  >({})
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [batchDisplayOpen, setBatchDisplayOpen] = useState(false)
  const [batchDisplaySaving, setBatchDisplaySaving] = useState(false)
  const [musicImportOpen, setMusicImportOpen] = useState(false)
  const [songCreateOpen, setSongCreateOpen] = useState(false)
  const [batchDisplayForm, setBatchDisplayForm] = useState({
    displayAlbumMode: 'linked' as 'linked' | 'manual' | 'none',
    manualAlbumName: '',
    displayAlbumDocId: '',
  })
  const [showDeleted, setShowDeleted] = useState(false)
  const dialog = useDialog()
  const { show } = useToast()
  const [newItem, setNewItem] = useState<any>({})
  const isMusicList = type === 'music'
  const musicPagination = usePagination({ totalCount: musicTotal, defaultPageSize: 50 })

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await apiGet<AdminListResponse>(`/api/admin/${cfg.apiPath}`, {
        includeDeleted: showDeleted ? 'true' : undefined,
        page: isMusicList ? musicPagination.page : undefined,
        limit: isMusicList ? musicPagination.pageSize : undefined,
      })
      const nextData = result.data || []
      setData(nextData)
      if (isMusicList) {
        setMusicTotal(result.total ?? nextData.length)
      }
      setSelectedRowIds((prev) => {
        const rowIds = new Set(nextData.map(getAdminItemId))
        return new Set([...prev].filter((rowId) => rowIds.has(rowId)))
      })
    } catch (e) {
      console.error(e)
      setData([])
      if (isMusicList) {
        setMusicTotal(0)
      }
    } finally {
      setLoading(false)
    }
  }

  const setRowPendingAction = (
    id: string,
    action: 'delete' | 'restore' | 'permanentDelete' | null
  ) => {
    setPendingActions((prev) => {
      if (action) return { ...prev, [id]: action }

      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  useEffect(() => {
    fetchData()
  }, [
    type,
    showDeleted,
    isMusicList ? musicPagination.page : 1,
    isMusicList ? musicPagination.pageSize : 50,
  ])

  useEffect(() => {
    setSelectedRowIds(new Set())
    setBatchDisplayOpen(false)
    musicPagination.setPage(1)
  }, [type])

  const isSelectableList = isMusicList
  const selectedCount = selectedRowIds.size

  const handleToggleDeleted = () => {
    if (isMusicList) {
      musicPagination.setPage(1)
    }
    setShowDeleted((value) => !value)
  }

  const toggleSelectedRow = (rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const toggleAllRows = () => {
    const selectableIds = data.map(getAdminItemId).filter(Boolean)
    setSelectedRowIds((prev) =>
      prev.size === selectableIds.length ? new Set() : new Set(selectableIds)
    )
  }

  const handleBatchDisplaySubmit = async () => {
    if (type !== 'music' || !selectedRowIds.size || batchDisplaySaving) return
    if (
      batchDisplayForm.displayAlbumMode === 'manual' &&
      !batchDisplayForm.manualAlbumName.trim()
    ) {
      show('手动专辑名不能为空', { variant: 'error' })
      return
    }

    setBatchDisplaySaving(true)
    try {
      await apiPatch('/api/admin/music/batch-display', {
        songDocIds: [...selectedRowIds],
        displayAlbumMode: batchDisplayForm.displayAlbumMode,
        manualAlbumName:
          batchDisplayForm.displayAlbumMode === 'manual'
            ? batchDisplayForm.manualAlbumName.trim()
            : null,
        displayAlbumDocId:
          batchDisplayForm.displayAlbumMode === 'linked' &&
          batchDisplayForm.displayAlbumDocId.trim()
            ? batchDisplayForm.displayAlbumDocId.trim()
            : null,
      })
      show('歌曲展示信息已批量更新', { variant: 'success' })
      setSelectedRowIds(new Set())
      setBatchDisplayOpen(false)
      invalidateApiCacheByPrefix('/api/admin/music')
      await fetchData()
    } catch (error) {
      show(error instanceof Error ? error.message : '批量更新展示信息失败', { variant: 'error' })
    } finally {
      setBatchDisplaySaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const requiresReason = type === 'wiki' || type === 'posts' || type === 'galleries'
    const reasonInput = requiresReason
      ? await dialog.prompt({
          title: '删除理由',
          message: '删除理由（必填）',
          confirmText: '继续删除',
          variant: 'warning',
          multiline: true,
        })
      : ''
    if (reasonInput === null) return
    const trimmedReasonInput = reasonInput.trim()
    if (requiresReason && !trimmedReasonInput) {
      show('删除该内容必须填写删除理由', { variant: 'error' })
      return
    }
    const confirmed = await dialog.confirm({
      title: '删除内容',
      message: '确定要删除吗？删除后可在回收站恢复。',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) return

    const previousData = data
    const deletedAt = new Date().toISOString()
    setRowPendingAction(id, 'delete')
    show('正在删除...', { duration: 1200 })
    setData((prev) =>
      showDeleted
        ? prev.map((item) =>
            String(item.docId || item.id || item.uid || '') === id
              ? { ...item, isDeleted: true, deletedAt, deletionReason: trimmedReasonInput || null }
              : item
          )
        : prev.filter((item) => String(item.docId || item.id || item.uid || '') !== id)
    )
    try {
      const deletePath = `/api/admin/${cfg.apiPath}/${id}`
      if (trimmedReasonInput) {
        await apiDelete(deletePath, { reason: trimmedReasonInput })
      } else {
        await apiDelete(deletePath)
      }
      show('已删除', { variant: 'success' })
      invalidateApiCacheByPrefix(`/api/admin/${cfg.apiPath}`)
    } catch (e) {
      setData(previousData)
      show(e instanceof Error ? e.message : '删除失败', { variant: 'error' })
    } finally {
      setRowPendingAction(id, null)
    }
  }

  const handleRestore = async (id: string) => {
    const previousData = data
    setRowPendingAction(id, 'restore')
    show('正在恢复...', { duration: 1200 })
    try {
      await apiPost(`/api/admin/${cfg.apiPath}/${id}/restore`)
      setData((prev) =>
        prev.map((item) =>
          String(item.docId || item.id || item.uid || '') === id
            ? { ...item, isDeleted: false, deletedAt: null, deletedBy: null }
            : item
        )
      )
      show('已恢复', { variant: 'success' })
      invalidateApiCacheByPrefix(`/api/admin/${cfg.apiPath}`)
    } catch (e) {
      setData(previousData)
      show(e instanceof Error ? e.message : '恢复失败', { variant: 'error' })
    } finally {
      setRowPendingAction(id, null)
    }
  }

  const handlePermanentDelete = async (id: string) => {
    const confirmed = await dialog.confirm({
      title: '彻底删除',
      message: '确定要彻底删除吗？此操作不可恢复。',
      confirmText: '彻底删除',
      variant: 'danger',
    })
    if (!confirmed) return
    const previousData = data
    setRowPendingAction(id, 'permanentDelete')
    show('正在彻底删除...', { duration: 1200 })
    setData((prev) => prev.filter((item) => String(item.docId || item.id || item.uid || '') !== id))
    try {
      await apiDelete(`/api/admin/${cfg.apiPath}/${id}/permanent`)
      show('已彻底删除', { variant: 'success' })
      invalidateApiCacheByPrefix(`/api/admin/${cfg.apiPath}`)
    } catch (e) {
      setData(previousData)
      show(e instanceof Error ? e.message : '彻底删除失败', { variant: 'error' })
    } finally {
      setRowPendingAction(id, null)
    }
  }

  const handleCreate = async () => {
    try {
      if (type === 'sections') {
        await apiPost('/api/sections', {
          name: newItem.name?.trim(),
          description: newItem.description?.trim(),
          order: Number.isFinite(newItem.order) ? newItem.order : 0,
        })
      } else if (type === 'announcements') {
        await apiPost('/api/announcements', {
          content: newItem.content?.trim(),
          link: newItem.link?.trim() || null,
          active: newItem.active ?? true,
        })
      }
      setNewItem({})
      await fetchData()
      show('创建成功', { variant: 'success' })
    } catch (e) {
      show('创建失败', { variant: 'error' })
    }
  }

  const toggleAnnouncement = async (item: AdminDataItem) => {
    try {
      const result = await apiPatch<{ announcement: AdminDataItem }>(
        `/api/announcements/${item.id}`,
        {
          active: !item.active,
        }
      )
      setData((prev) =>
        prev.map((d) =>
          d.id === item.id ? { ...d, active: result.announcement?.active ?? !item.active } : d
        )
      )
      show('状态已更新', { variant: 'success' })
    } catch (e) {
      show('更新失败', { variant: 'error' })
    }
  }

  const renderActions = (item: AdminDataItem, rowId: string) => {
    const pendingAction = pendingActions[rowId]
    const isPending = Boolean(pendingAction)

    return (
      <div className="flex items-center justify-start gap-2">
        {pendingAction && (
          <button
            disabled
            className={pendingAction === 'restore' ? SUCCESS_BUTTON_CLASSES : DANGER_BUTTON_CLASSES}
          >
            <RefreshCw size={14} className="animate-spin" />
            {pendingAction === 'delete'
              ? '删除中...'
              : pendingAction === 'restore'
                ? '恢复中...'
                : '永久删除中...'}
          </button>
        )}
        {type === 'announcements' && !item.isDeleted && (
          <button
            onClick={() => toggleAnnouncement(item)}
            disabled={isPending}
            className={WARNING_BUTTON_CLASSES}
          >
            {item.active ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {item.active ? '禁用' : '启用'}
          </button>
        )}
        {!isPending && item.isDeleted ? (
          <>
            <button
              onClick={() => handleRestore(rowId)}
              disabled={isPending}
              className={SUCCESS_BUTTON_CLASSES}
            >
              <RotateCcw size={14} />
              恢复
            </button>
            <button
              onClick={() => handlePermanentDelete(rowId)}
              disabled={isPending}
              className={DANGER_BUTTON_CLASSES}
            >
              <Trash2 size={14} />
              永久删除
            </button>
          </>
        ) : !isPending ? (
          <button
            onClick={() => handleDelete(rowId)}
            disabled={isPending}
            className={DANGER_BUTTON_CLASSES}
          >
            <Trash2 size={14} />
            删除
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.12em] text-text-primary">
            <Icon size={24} className="text-brand-gold" /> {cfg.title}
          </h1>
          <div className="flex items-center gap-2">
            {type === 'music' && (
              <>
                <button
                  onClick={() => setSongCreateOpen(true)}
                  className="rounded theme-button-primary px-4 py-2 text-sm transition-all"
                >
                  <Plus size={14} className="mr-1 inline" /> 添加音乐
                </button>
                <button
                  onClick={() => setMusicImportOpen(true)}
                  className="rounded border border-border px-4 py-2 text-sm text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
                >
                  <Plus size={14} className="mr-1 inline" /> 导入音乐
                </button>
              </>
            )}
            <button
              onClick={handleToggleDeleted}
              className={clsx(
                'rounded border px-4 py-2 text-sm transition-all',
                showDeleted
                  ? 'border-brand-gold text-brand-gold bg-brand-gold/10'
                  : 'border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold'
              )}
            >
              <Ban size={14} className="mr-1 inline" /> 显示已删除
            </button>
            <button
              onClick={fetchData}
              className="rounded border border-border px-4 py-2 text-sm text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
            >
              <RefreshCw size={14} className="mr-1 inline" /> 刷新
            </button>
          </div>
        </div>

        {isSelectableList && (
          <div className="rounded border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">
                已选择 <span className="font-semibold text-brand-gold">{selectedCount}</span> 首歌曲
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAllRows}
                  disabled={!data.length}
                  className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedCount === data.length && data.length ? '取消全选' : '全选'}
                </button>
                <button
                  type="button"
                  onClick={() => setBatchDisplayOpen((value) => !value)}
                  disabled={!selectedCount}
                  className="rounded theme-button-secondary px-3 py-1.5 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                  批量更新展示
                </button>
              </div>
            </div>

            {batchDisplayOpen && selectedCount > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 md:grid-cols-[160px_1fr_1fr_auto]">
                <select
                  value={batchDisplayForm.displayAlbumMode}
                  onChange={(event) =>
                    setBatchDisplayForm((prev) => ({
                      ...prev,
                      displayAlbumMode: event.target.value as 'linked' | 'manual' | 'none',
                    }))
                  }
                  className="rounded border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:border-brand-gold focus:outline-none"
                >
                  <option value="linked">显示关联专辑</option>
                  <option value="manual">显示手动专辑</option>
                  <option value="none">不显示专辑</option>
                </select>
                <input
                  type="text"
                  value={batchDisplayForm.manualAlbumName}
                  onChange={(event) =>
                    setBatchDisplayForm((prev) => ({
                      ...prev,
                      manualAlbumName: event.target.value,
                    }))
                  }
                  disabled={batchDisplayForm.displayAlbumMode !== 'manual'}
                  maxLength={CONTENT_LIMITS.music.manualAlbumName}
                  placeholder="手动专辑名"
                  className="rounded border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:border-brand-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <input
                  type="text"
                  value={batchDisplayForm.displayAlbumDocId}
                  onChange={(event) =>
                    setBatchDisplayForm((prev) => ({
                      ...prev,
                      displayAlbumDocId: event.target.value,
                    }))
                  }
                  disabled={batchDisplayForm.displayAlbumMode !== 'linked'}
                  placeholder="展示专辑 docId（可选）"
                  className="rounded border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:border-brand-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleBatchDisplaySubmit()}
                  disabled={batchDisplaySaving}
                  className="rounded theme-button-primary px-4 py-2 text-sm transition-all disabled:cursor-wait disabled:opacity-50"
                >
                  {batchDisplaySaving ? '保存中...' : '保存'}
                </button>
              </div>
            )}
          </div>
        )}

        {cfg.hasCreate && (
          <div className="rounded border border-border bg-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Plus size={16} /> 新增
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              {type === 'sections' && (
                <>
                  <input
                    type="text"
                    placeholder="名称"
                    value={newItem.name || ''}
                    onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="描述"
                    value={newItem.description || ''}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
                  />
                  <input
                    type="number"
                    placeholder="排序"
                    value={newItem.order || 0}
                    onChange={(e) => setNewItem({ ...newItem, order: Number(e.target.value) })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
                  />
                </>
              )}
              {type === 'announcements' && (
                <>
                  <input
                    type="text"
                    placeholder="公告内容"
                    value={newItem.content || ''}
                    onChange={(e) => setNewItem({ ...newItem, content: e.target.value })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none md:col-span-2"
                  />
                  <input
                    type="text"
                    placeholder="跳转链接 (可选)"
                    value={newItem.link || ''}
                    onChange={(e) => setNewItem({ ...newItem, link: e.target.value })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
                  />
                </>
              )}
              <button
                onClick={handleCreate}
                className="rounded bg-brand-gold-dark px-5 py-2 text-sm font-medium text-white transition-all hover:bg-brand-gold"
              >
                添加
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-alt">
                  {isSelectableList && (
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      <input
                        type="checkbox"
                        checked={data.length > 0 && selectedCount === data.length}
                        onChange={toggleAllRows}
                        className="accent-brand-gold"
                        aria-label="选择全部歌曲"
                      />
                    </th>
                  )}
                  {cfg.columns.map((col) => (
                    <th
                      key={col.key}
                      className={clsx(
                        'px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted',
                        col.className
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  [1, 2, 3].map((i) => (
                    <tr key={i} className="animate-pulse">
                      <td
                        colSpan={cfg.columns.length + (isSelectableList ? 1 : 0)}
                        className="px-5 py-4"
                      >
                        <div className="h-6 rounded bg-surface-alt" />
                      </td>
                    </tr>
                  ))
                ) : data.length > 0 ? (
                  data.map((item) => {
                    const rowId = getAdminItemId(item)
                    return (
                      <tr
                        key={rowId}
                        className={clsx(
                          'transition-colors hover:bg-surface-alt',
                          item.isDeleted && 'opacity-70'
                        )}
                      >
                        {isSelectableList && (
                          <td className="px-5 py-4 align-top">
                            <input
                              type="checkbox"
                              checked={selectedRowIds.has(rowId)}
                              onChange={() => toggleSelectedRow(rowId)}
                              className="accent-brand-gold"
                              aria-label={`选择 ${toText(item.title || item.id || rowId)}`}
                            />
                          </td>
                        )}
                        {cfg.columns.map((col) => (
                          <td
                            key={col.key}
                            className={clsx(
                              'px-5 py-4 align-top',
                              col.key === 'actions' && 'text-left'
                            )}
                          >
                            {col.key === 'actions'
                              ? renderActions(item, rowId)
                              : renderCell(type, item, col.key, Icon)}
                          </td>
                        ))}
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={cfg.columns.length + (isSelectableList ? 1 : 0)}
                      className="px-5 py-16 text-center italic text-text-muted"
                    >
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {isMusicList && musicPagination.totalPages > 1 && (
            <Pagination
              page={musicPagination.page}
              totalPages={musicPagination.totalPages}
              onPageChange={musicPagination.handlePageChange}
              pageSize={musicPagination.pageSize}
              onPageSizeChange={musicPagination.handlePageSizeChange}
              showPageSizeSelector
            />
          )}
        </div>
      </div>
      {type === 'music' && (
        <>
          <SongFormModal
            open={songCreateOpen}
            onClose={() => setSongCreateOpen(false)}
            onSuccess={() => {
              setSongCreateOpen(false)
              invalidateApiCacheByPrefix('/api/admin/music')
              void fetchData()
            }}
            mode="create"
          />
          <MusicImportModal
            open={musicImportOpen}
            onClose={() => setMusicImportOpen(false)}
            onImported={() => {
              setMusicImportOpen(false)
              invalidateApiCacheByPrefix('/api/admin/music')
              void fetchData()
            }}
          />
        </>
      )}
    </>
  )
}

export default AdminListPage
