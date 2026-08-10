import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Ban,
  Book,
  Calendar,
  CheckCircle,
  Edit3,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquare,
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
import { formatDateTime } from '../../lib/dateUtils'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { useScrollRestore } from '../../hooks/useScrollRestore'
import { SmartImage } from '../../components/SmartImage'
import type { ContentStatus } from '../../types/common'
import type { AdminDataItem } from '../../types/entities'
import { Button, Checkbox, LinkButton, LoadErrorState } from '@/src/components/ui'
import { PageSkeleton } from '@/src/components/PageSkeleton'

type ListType =
  | 'wiki'
  | 'wiki-categories'
  | 'posts'
  | 'galleries'
  | 'events'
  | 'sections'
  | 'announcements'

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
  | 'lifecycle'
  | 'permissions'
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

const WIKI_CATEGORIES_ADMIN_PATH = '/api/admin/wiki-categories'
const WIKI_CATEGORIES_PUBLIC_PATH = '/api/wiki/categories'

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
  'wiki-categories': {
    title: '百科分类',
    icon: Layers,
    apiPath: 'wiki-categories',
    columns: [
      { key: 'details', label: '分类', className: 'min-w-[260px]' },
      { key: 'order', label: '排序', className: 'min-w-[90px]' },
      { key: 'permissions', label: '权限', className: 'min-w-[140px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[240px] text-left' },
    ],
    hasCreate: true,
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
  events: {
    title: '活动管理',
    icon: Calendar,
    apiPath: 'events',
    columns: [
      { key: 'details', label: '活动', className: 'min-w-[280px]' },
      { key: 'status', label: '公开', className: 'min-w-[110px]' },
      { key: 'owner', label: '创建者', className: 'min-w-[140px]' },
      { key: 'media', label: '图片/地点', className: 'min-w-[170px]' },
      { key: 'tags', label: '标签', className: 'min-w-[180px]' },
      { key: 'lifecycle', label: '时间', className: 'min-w-[170px]' },
      { key: 'actions', label: '操作', className: 'min-w-[260px] text-left' },
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

const contentStatuses = ['draft', 'pending', 'published', 'rejected'] as const

const isContentStatus = (value: unknown): value is ContentStatus =>
  typeof value === 'string' && contentStatuses.some((status) => status === value)

const toText = (value: unknown, fallback = 'N/A') =>
  typeof value === 'string' && value.trim() ? value : fallback

const toOptionalText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const toNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const getTags = (item: AdminDataItem) =>
  Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : []

const getImages = (item: AdminDataItem) => (Array.isArray(item.images) ? item.images : [])

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
  if (type === 'posts' && item.slug) return `/forum/${item.slug}`
  if (type === 'galleries' && item.slug) return `/gallery/${item.slug}`
  if (type === 'events' && item.slug) return `/events/${item.slug}`
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
      {renderTagBadges(tags)}
      <p className="truncate text-text-muted">
        {toOptionalText(item.locationName) || toOptionalText(item.locationDetail) || '未设置位置'}
      </p>
    </div>
  )
}

const renderTagBadges = (tags: string[]) =>
  tags.length > 0 ? (
    <div className="flex max-w-[220px] flex-wrap gap-1 text-xs">
      {tags.slice(0, 4).map((tag) => renderKeyedBadge(tag, tag, 'bg-surface-alt text-brand-gold'))}
      {tags.length > 4 && renderBadge(`+${tags.length - 4}`, 'bg-surface-alt text-text-muted')}
    </div>
  ) : (
    <span className="text-xs text-text-muted">无标签</span>
  )

const renderDetails = (type: ListType, item: AdminDataItem, Icon: React.ElementType) => {
  const href = getItemHref(type, item)
  const title = toText(item.title || item.displayName || item.name || item.slug || item.id)
  const subtitle = item.content?.slice(0, 80) || item.description?.slice(0, 80) || ''

  return (
    <div className="flex items-center gap-3">
      {type === 'galleries' || type === 'events' ? (
        <SmartImage
          src={
            type === 'events'
              ? String(item.coverThumbnailUrl || item.coverUrl || '')
              : (getImages(item)[0] as { thumbnailUrl?: string } | undefined)?.thumbnailUrl || ''
          }
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
          {type === 'events' && `slug: ${toText(item.slug)}`}
          {type === 'sections' && `ID: ${toText(item.id)}`}
          {type === 'wiki-categories' && `ID: ${toText(item.id)}`}
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
  if (type === 'events') {
    return renderBadge('公开', 'theme-status-success')
  }
  if (type === 'galleries') {
    const status = isContentStatus(item.status) ? item.status : null
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
  if (type === 'events') {
    return (
      <div className="space-y-1 text-xs">
        <p className="font-medium text-text-primary">{toText(item.createdByName, '匿名')}</p>
        <p className="text-text-muted">{toText(item.createdByUid)}</p>
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
  return <span className="text-xs text-text-muted">N/A</span>
}

const renderMedia = (item: AdminDataItem) => (
  <div className="space-y-1 text-xs text-text-muted">
    {'posters' in item ? (
      <>
        <p>海报：{Array.isArray(item.posters) ? item.posters.length : 0}</p>
        <p className="truncate">地点：{toText(item.location, '未填写')}</p>
      </>
    ) : (
      <>
        <p>图片：{getImages(item).length}</p>
        <p className="truncate">版权：{toText(item.copyright, '未填写')}</p>
      </>
    )}
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
  if (key === 'tags')
    return type === 'events' ? renderTagBadges(getTags(item)) : renderTagsAndLocation(item)
  if (key === 'media') return renderMedia(item)
  if (key === 'link') return renderLink(item)
  if (key === 'order')
    return <span className="text-sm font-medium text-text-primary">{toNumber(item.order)}</span>
  if (key === 'permissions')
    return item.requiresAdminEdit
      ? renderBadge('仅管理员编辑', 'theme-status-warning')
      : renderBadge('开放协作', 'theme-status-success')
  if (key === 'lifecycle') return renderDateBlock(item)
  return null
}

const getAdminItemId = (item: AdminDataItem) => String(item.docId || item.id || item.uid || '')

const getWikiCategoryPayload = (item: AdminDataItem) => ({
  name: item.name?.trim(),
  description: item.description?.trim(),
  order: Number.isFinite(item.order) ? item.order : 0,
  requiresAdminEdit: Boolean(item.requiresAdminEdit),
})

const invalidateWikiCategoryCaches = () => {
  invalidateApiCacheByPrefix(WIKI_CATEGORIES_ADMIN_PATH)
  invalidateApiCacheByPrefix(WIKI_CATEGORIES_PUBLIC_PATH)
}

export const AdminListPage = ({ type }: { type: ListType }) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const cfg = configMap[type]
  const Icon = cfg.icon
  const [data, setData] = useState<AdminDataItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [pendingActions, setPendingActions] = useState<
    Record<string, 'delete' | 'restore' | 'permanentDelete'>
  >({})
  const [editingCategory, setEditingCategory] = useState<AdminDataItem | null>(null)
  const showDeleted = searchParams.get('includeDeleted') === 'true'
  const dialog = useDialog()
  const { show } = useToast()
  const saveScroll = useScrollRestore()
  const [newItem, setNewItem] = useState<any>({})

  const invalidateCurrentDataCaches = () => {
    if (type === 'wiki-categories') {
      invalidateWikiCategoryCaches()
      return
    }

    invalidateApiCacheByPrefix(`/api/admin/${cfg.apiPath}`)
  }

  const fetchData = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (silent) saveScroll()
    else {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const result = await apiGet<AdminListResponse>(`/api/admin/${cfg.apiPath}`, {
        includeDeleted: showDeleted ? 'true' : undefined,
      })
      setData(result.data || [])
      setLoadError(null)
    } catch (error) {
      console.error(error)
      setLoadError(error)
    } finally {
      if (!silent) setLoading(false)
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
    void fetchData()
  }, [type, showDeleted])

  const handleToggleDeleted = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (showDeleted) next.delete('includeDeleted')
      else next.set('includeDeleted', 'true')
      return next
    })
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
      invalidateCurrentDataCaches()
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
      invalidateCurrentDataCaches()
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
      invalidateCurrentDataCaches()
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
      } else if (type === 'wiki-categories') {
        await apiPost(WIKI_CATEGORIES_ADMIN_PATH, {
          id: newItem.id?.trim(),
          ...getWikiCategoryPayload(newItem),
        })
      } else if (type === 'announcements') {
        await apiPost('/api/announcements', {
          content: newItem.content?.trim(),
          link: newItem.link?.trim() || null,
          active: newItem.active ?? true,
        })
      }
      setNewItem({})
      invalidateCurrentDataCaches()
      show('创建成功', { variant: 'success' })
      await fetchData({ silent: true })
    } catch (e) {
      show('创建失败', { variant: 'error' })
    }
  }

  const handleUpdateWikiCategory = async () => {
    if (type !== 'wiki-categories' || !editingCategory?.id) return
    try {
      await apiPatch(`${WIKI_CATEGORIES_ADMIN_PATH}/${editingCategory.id}`, {
        ...getWikiCategoryPayload(editingCategory),
      })
      setEditingCategory(null)
      invalidateCurrentDataCaches()
      show('更新成功', { variant: 'success' })
      await fetchData({ silent: true })
    } catch (e) {
      show(e instanceof Error ? e.message : '更新失败', { variant: 'error' })
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
        {isPending && (
          <Button
            variant={pendingAction === 'restore' ? 'success' : 'danger'}
            soft
            size="sm"
            loading
          >
            {pendingAction === 'delete'
              ? '删除中...'
              : pendingAction === 'restore'
                ? '恢复中...'
                : '永久删除中...'}
          </Button>
        )}
        {type === 'announcements' && !item.isDeleted && (
          <Button
            onClick={() => toggleAnnouncement(item)}
            disabled={isPending}
            variant="warning"
            soft
            size="sm"
            leftIcon={item.active ? <CheckCircle size={14} /> : <XCircle size={14} />}
          >
            {item.active ? '禁用' : '启用'}
          </Button>
        )}
        {type === 'wiki-categories' && !item.isDeleted && !isPending && (
          <Button
            onClick={() => setEditingCategory(item)}
            variant="warning"
            soft
            size="sm"
            leftIcon={<Edit3 size={14} />}
          >
            编辑
          </Button>
        )}
        {type === 'events' && !item.isDeleted && !isPending && item.id && (
          <LinkButton
            to={`/admin/events/${item.id}/edit`}
            variant="warning"
            soft
            size="sm"
            leftIcon={<Edit3 size={14} />}
          >
            编辑
          </LinkButton>
        )}
        {!isPending && item.isDeleted ? (
          <>
            <Button
              onClick={() => handleRestore(rowId)}
              variant="success"
              soft
              size="sm"
              leftIcon={<RotateCcw size={14} />}
            >
              恢复
            </Button>
            <Button
              onClick={() => handlePermanentDelete(rowId)}
              variant="danger"
              soft
              size="sm"
              leftIcon={<Trash2 size={14} />}
            >
              永久删除
            </Button>
          </>
        ) : !isPending ? (
          <Button
            onClick={() => handleDelete(rowId)}
            variant="danger"
            soft
            size="sm"
            leftIcon={<Trash2 size={14} />}
          >
            删除
          </Button>
        ) : null}
      </div>
    )
  }

  if (loading && data.length === 0) {
    return <PageSkeleton variant="admin" />
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.12em] text-text-primary">
            <Icon size={24} className="text-brand-gold" /> {cfg.title}
          </h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {type === 'events' && (
              <Link
                to="/admin/events/new"
                data-pressable
                className="inline-flex items-center rounded theme-button-primary px-4 py-2 text-sm transition-all"
              >
                <Plus size={14} className="mr-1 inline" /> 新增活动
              </Link>
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
              onClick={() => void fetchData()}
              className="rounded border border-border px-4 py-2 text-sm text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
            >
              <RefreshCw size={14} className="mr-1 inline" /> 刷新
            </button>
          </div>
        </div>
        {loadError && data.length > 0 && (
          <LoadErrorState
            className="py-5"
            description="当前列表可能不是最新内容。"
            onRetry={() => void fetchData()}
          />
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
              {type === 'wiki-categories' && (
                <>
                  <input
                    type="text"
                    placeholder="分类 ID"
                    value={newItem.id || ''}
                    onChange={(e) => setNewItem({ ...newItem, id: e.target.value })}
                    className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
                  />
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
                  <div className="rounded border border-border bg-surface-alt px-4 py-2">
                    <Checkbox
                      checked={Boolean(newItem.requiresAdminEdit)}
                      onCheckedChange={(checked) =>
                        setNewItem({ ...newItem, requiresAdminEdit: checked === true })
                      }
                      label={<span className="text-text-secondary">仅管理员编辑</span>}
                    />
                  </div>
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

        {type === 'wiki-categories' && editingCategory && (
          <div className="rounded border border-border bg-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Edit3 size={16} /> 编辑分类
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_120px_160px_auto_auto]">
              <input
                type="text"
                value={editingCategory.name || ''}
                onChange={(event) =>
                  setEditingCategory({ ...editingCategory, name: event.target.value })
                }
                className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
              />
              <input
                type="text"
                value={editingCategory.description || ''}
                onChange={(event) =>
                  setEditingCategory({ ...editingCategory, description: event.target.value })
                }
                className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
              />
              <input
                type="number"
                value={toNumber(editingCategory.order)}
                onChange={(event) =>
                  setEditingCategory({ ...editingCategory, order: Number(event.target.value) })
                }
                className="rounded border border-border bg-surface-alt px-4 py-2 text-sm focus:border-brand-gold focus:outline-none"
              />
              <div className="rounded border border-border bg-surface-alt px-4 py-2">
                <Checkbox
                  checked={Boolean(editingCategory.requiresAdminEdit)}
                  onCheckedChange={(checked) =>
                    setEditingCategory({
                      ...editingCategory,
                      requiresAdminEdit: checked === true,
                    })
                  }
                  label={<span className="text-text-secondary">仅管理员编辑</span>}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleUpdateWikiCategory()}
                className="rounded theme-button-primary px-4 py-2 text-sm transition-all"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="rounded border border-border px-4 py-2 text-sm text-text-secondary transition-all hover:border-brand-gold hover:text-brand-gold"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-alt">
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
                {loadError && data.length === 0 ? (
                  <tr>
                    <td colSpan={cfg.columns.length}>
                      <LoadErrorState onRetry={() => void fetchData()} />
                    </td>
                  </tr>
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
                ) : loading ? (
                  [1, 2, 3].map((i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={cfg.columns.length} className="px-5 py-4">
                        <div className="h-6 rounded bg-surface-alt" />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={cfg.columns.length}
                      className="px-5 py-16 text-center italic text-text-muted"
                    >
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

export default AdminListPage
