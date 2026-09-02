import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Calendar,
  Check,
  Clock,
  Edit3,
  Plus,
  Search,
  Trash2,
  User as UserIcon,
  X,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { TicketListingCard } from '../components/Tickets/TicketListingCard'
import { CharacterCount } from '../components/CharacterCount'
import MarkdownEditor from '../components/MarkdownEditor'
import MarkdownRenderer from '../components/MarkdownRenderer'
import {
  BookEditorActions,
  BookEditorHeader,
  BookEditorSection,
  BookEditorShell,
} from '../components/BookEditor'
import { SmartBackLink } from '../components/SmartBackLink'
import NotFound from './NotFound'
import { ListPageContentState, ListPageLoadingBoundary } from '../components/ListPageState'
import { RouteGuard } from '../components/RouteGuard'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  apiRequest,
  invalidateApiCacheByPrefix,
} from '../lib/apiClient'
import { getErrorMessage } from '../lib/errorHandler'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { formatDateTime } from '../lib/dateUtils'
import { getStatusClassName, getStatusText } from '../lib/contentUtils'
import type {
  TicketListingDetailResponse,
  TicketListingEventsResponse,
  TicketListingListResponse,
} from '../types/api'
import type {
  TicketListingEventOption,
  TicketListingItem,
  TicketListingSummary,
  TicketListingType,
} from '../types/entities'
import {
  Button,
  Field,
  Input,
  Select,
  SegmentedControl,
  Spinner,
  Textarea,
} from '@/src/components/ui'
import Pagination from '../components/Pagination'

const LIST_LIMIT = 20
const TICKET_TYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'offer', label: '出票' },
  { value: 'request', label: '收票' },
] as const
const EVENT_MODE_OPTIONS = [
  { value: 'linked', label: '关联站内活动' },
  { value: 'custom', label: '自定义活动' },
] as const

type EventMode = (typeof EVENT_MODE_OPTIONS)[number]['value']
type TicketFormData = {
  type: TicketListingType
  eventMode: EventMode
  eventId: string
  customEventName: string
  quantity: string
  ticketTier: string
  seat: string
  description: string
  contact: string
}

type TicketFormErrors = Partial<Record<keyof TicketFormData, string>> & { event?: string }

const emptyForm: TicketFormData = {
  type: 'offer',
  eventMode: 'linked',
  eventId: '',
  customEventName: '',
  quantity: '1',
  ticketTier: '',
  seat: '',
  description: '',
  contact: '',
}

function TicketListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, isBanned } = useAuth()
  const [listings, setListings] = useState<TicketListingSummary[]>([])
  const [events, setEvents] = useState<TicketListingEventOption[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')
  const page = Math.max(Number(searchParams.get('page')) || 1, 1)
  const type =
    searchParams.get('type') === 'offer' || searchParams.get('type') === 'request'
      ? searchParams.get('type')
      : 'all'
  const eventId = searchParams.get('eventId') || ''
  const q = searchParams.get('q') || ''

  useEffect(() => {
    setSearchInput(q)
  }, [q])

  useEffect(() => {
    const controller = new AbortController()
    void apiGet<TicketListingEventsResponse>(
      '/api/ticket-listings/events',
      { limit: LIST_LIMIT },
      undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setEvents(result.events)
      })
      .catch(() => {
        if (!controller.signal.aborted) setEvents([])
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void apiGet<TicketListingListResponse>(
      '/api/ticket-listings',
      {
        page,
        limit: LIST_LIMIT,
        type: type === 'all' ? undefined : type,
        eventId: eventId || undefined,
        q: q || undefined,
      },
      undefined,
      controller.signal
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setListings(result.listings)
        setTotalPages(result.totalPages)
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [eventId, page, q, retryNonce, type])

  const updateSearch = (changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      Object.entries(changes).forEach(([key, value]) => {
        if (!value) next.delete(key)
        else next.set(key, value)
      })
      if ('page' in changes) return next
      next.delete('page')
      return next
    })
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    updateSearch({ q: searchInput.trim() || null })
  }

  return (
    <ListPageLoadingBoundary
      variant="events"
      isInitialLoading={loading && listings.length === 0 && !error}
    >
      <div className="mobile-page-shell">
        <div className="mobile-page-container" aria-busy={loading || undefined}>
          <header className="mobile-page-header">
            <div className="mobile-page-titlebar">
              <div>
                <h1 className="mobile-page-title">盘票</h1>
                <p className="mt-2 text-sm text-text-muted">仅提供信息发布，不参与交易</p>
              </div>
              <div className="mobile-action-row">
                {loading && <Spinner size="sm" label="盘票刷新中" />}
                {user && !isBanned && (
                  <Link
                    to="/tickets/new"
                    data-pressable
                    className="theme-button-primary inline-flex items-center gap-2 rounded px-4 py-2 text-sm"
                  >
                    <Plus size={15} /> 发布盘票
                  </Link>
                )}
              </div>
            </div>
          </header>

          <div className="mb-6 space-y-3">
            <div className="flex flex-wrap gap-2">
              {TICKET_TYPE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={type === option.value ? 'primary' : 'secondary'}
                  aria-pressed={type === option.value}
                  onClick={() =>
                    updateSearch({ type: option.value === 'all' ? null : option.value })
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <form
              onSubmit={handleSearch}
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_auto]"
            >
              <Field label="关键词" controlId="ticket-search">
                <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <Input
                    id="ticket-search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    maxLength={CONTENT_LIMITS.event.title}
                    placeholder="搜索活动、票档或座位"
                    className="pl-9"
                  />
                </div>
              </Field>
              <Field label="活动筛选" controlId="ticket-event-filter">
                <Select
                  id="ticket-event-filter"
                  value={eventId}
                  onChange={(event) => updateSearch({ eventId: event.target.value || null })}
                >
                  <option value="">全部活动</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" className="self-end" leftIcon={<Search size={15} />}>
                搜索
              </Button>
            </form>
          </div>

          <ListPageContentState
            hasItems={listings.length > 0}
            error={error}
            onRetry={() => setRetryNonce((current) => current + 1)}
            empty={
              <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
                <Calendar size={48} className="mx-auto mb-6 text-border" />
                <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
                  暂无符合条件的盘票信息
                </p>
              </div>
            }
          >
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <TicketListingCard key={listing.id} listing={listing} />
                ))}
              </div>
              {totalPages > 1 && (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={(nextPage) => updateSearch({ page: String(nextPage) })}
                />
              )}
            </>
          </ListPageContentState>
        </div>
      </div>
    </ListPageLoadingBoundary>
  )
}

function TicketDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, isAdmin, isBanned } = useAuth()
  const { show } = useToast()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [listing, setListing] = useState<TicketListingItem | null>(null)
  const [error, setError] = useState<unknown | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  const loadControllerRef = useRef<AbortController | null>(null)

  const loadListing = () => {
    if (!slug) return
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setLoading(true)
    setError(null)
    void apiRequest<TicketListingDetailResponse>(`/api/ticket-listings/${slug}`, {
      method: 'GET',
      dedup: false,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setListing(result.listing)
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
  }

  useEffect(() => {
    loadListing()
    return () => loadControllerRef.current?.abort()
  }, [slug])

  if (loading) {
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container py-20 text-center">
          <Spinner label="盘票加载中" />
        </div>
      </div>
    )
  }
  if (error || !listing) {
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container py-20">
          <SmartBackLink
            fallbackTo="/tickets"
            fallbackLabel="返回盘票"
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          />
          <div className="mt-12 text-center">
            <p className="text-lg text-text-primary">无法加载盘票信息</p>
            <p className="mt-2 text-sm text-text-muted">
              {getErrorMessage(error, '信息不存在或已删除')}
            </p>
            <Button type="button" variant="secondary" className="mt-6" onClick={loadListing}>
              重试
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const canManage = Boolean(user && !isBanned && (user.uid === listing.authorUid || isAdmin))
  const handleDelete = async () => {
    const isOwner = user?.uid === listing.authorUid
    const reason = isOwner
      ? null
      : await dialog.prompt({
          title: '删除盘票信息',
          message: '请输入删除理由，作者会收到通知。',
          confirmText: '删除',
          variant: 'danger',
          multiline: true,
          maxLength: CONTENT_LIMITS.ticketListing.reviewNote,
          placeholder: '删除理由',
          onConfirm: async (value) => {
            if (value.trim()) return true
            show('删除理由不能为空', { variant: 'error' })
            return false
          },
        })
    if (!isOwner && !reason) return
    if (isOwner) {
      const confirmed = await dialog.confirm({
        title: '删除盘票信息',
        message: `确定删除“${listing.eventName}”的盘票信息吗？`,
        confirmText: '删除',
        variant: 'danger',
      })
      if (!confirmed) return
    }
    setDeleting(true)
    try {
      await apiDelete(`/api/ticket-listings/${listing.id}`, reason ? { reason: reason.trim() } : {})
      invalidateApiCacheByPrefix('/api/ticket-listings')
      show('盘票信息已删除', { variant: 'success' })
      navigate('/tickets')
    } catch (deleteError) {
      show(getErrorMessage(deleteError, '删除盘票信息失败'), { variant: 'error' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <BookEditorShell>
      <SmartBackLink
        fallbackTo="/tickets"
        fallbackLabel="返回盘票"
        className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
      />
      <BookEditorHeader
        title={listing.eventName || listing.customEventName || '盘票信息'}
        description="仅提供信息发布，不参与交易"
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link to={`/tickets/${listing.slug}/edit`}>
                  <Edit3 size={14} /> 编辑
                </Link>
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={deleting}
                loadingText="删除中..."
                onClick={handleDelete}
                leftIcon={<Trash2 size={14} />}
              >
                删除
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                'rounded border px-2 py-1 text-xs font-semibold',
                getStatusClassName(listing.status)
              )}
            >
              {listing.type === 'offer' ? '出票' : '收票'}
            </span>
            {listing.status && (
              <span
                className={clsx(
                  'rounded border px-2 py-1 text-xs',
                  getStatusClassName(listing.status)
                )}
              >
                {getStatusText(listing.status)}
              </span>
            )}
          </div>
          <BookEditorSection title="活动与票务信息" className="border-t-0 pt-0">
            <dl className="grid gap-4 text-sm text-text-secondary sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-muted">活动</dt>
                <dd className="mt-1 font-medium text-text-primary">
                  {listing.eventSlug ? (
                    <Link
                      className="text-brand-gold hover:underline"
                      to={`/events/${listing.eventSlug}`}
                    >
                      {listing.eventName}
                    </Link>
                  ) : (
                    listing.eventName
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">地点</dt>
                <dd className="mt-1 text-text-primary">{listing.eventLocation || '未填写'}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">数量</dt>
                <dd className="mt-1 text-text-primary">{listing.quantity}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">票档</dt>
                <dd className="mt-1 text-text-primary">{listing.ticketTier}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">座位</dt>
                <dd className="mt-1 text-text-primary">{listing.seat || '未填写'}</dd>
              </div>
            </dl>
          </BookEditorSection>

          <BookEditorSection title="描述">
            {listing.description ? (
              <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
                <MarkdownRenderer content={listing.description} />
              </div>
            ) : (
              <p className="text-sm italic text-text-muted">未填写描述</p>
            )}
          </BookEditorSection>
          <BookEditorSection title="联系方式">
            <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
              <MarkdownRenderer content={listing.contact} />
            </div>
          </BookEditorSection>
        </main>
        <aside className="space-y-5 text-sm text-text-muted">
          <div className="border-t border-[var(--book-ink-line)] pt-5">
            <p className="flex items-center gap-2">
              <UserIcon size={14} /> 发布者：
              <span className="text-text-primary">{listing.authorName}</span>
            </p>
            <p className="mt-2 flex items-center gap-2">
              <Clock size={14} /> 发布时间：
              <span className="text-text-primary">
                {formatDateTime(listing.createdAt, 'yyyy-MM-dd HH:mm')}
              </span>
            </p>
          </div>
          {listing.reviewNote && canManage && (
            <div className="rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-4">
              <p className="font-medium text-[var(--color-error)]">驳回原因</p>
              <p className="mt-2 whitespace-pre-wrap text-text-secondary">{listing.reviewNote}</p>
            </div>
          )}
        </aside>
      </div>
    </BookEditorShell>
  )
}

function EventPicker({
  value,
  selectedEvent,
  onChange,
}: {
  value: string
  selectedEvent: TicketListingEventOption | null
  onChange: (event: TicketListingEventOption | null) => void
}) {
  const [query, setQuery] = useState(selectedEvent?.title || '')
  const [events, setEvents] = useState<TicketListingEventOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setQuery(selectedEvent?.title || '')
  }, [selectedEvent?.id, selectedEvent?.title])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      void apiGet<TicketListingEventsResponse>(
        '/api/ticket-listings/events',
        { q: query.trim() || undefined, limit: LIST_LIMIT },
        undefined,
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted) setEvents(result.events)
        })
        .catch(() => {
          if (!controller.signal.aborted) setEvents([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [events])

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (selectedEvent) onChange(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => Math.min(current + 1, Math.max(events.length - 1, 0)))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => Math.max(current - 1, 0))
            }
            if (event.key === 'Enter' && events[activeIndex]) {
              event.preventDefault()
              onChange(events[activeIndex])
              setOpen(false)
            }
          }}
          placeholder="输入关键词查找站内活动"
          aria-label="搜索站内活动"
          aria-expanded={open}
          aria-controls="ticket-event-options"
          aria-activedescendant={
            events[activeIndex] ? `ticket-event-option-${events[activeIndex].id}` : undefined
          }
        />
        {selectedEvent && (
          <Button
            type="button"
            variant="ghost"
            aria-label="清除关联活动"
            onClick={() => onChange(null)}
          >
            <X size={16} />
          </Button>
        )}
      </div>
      {open && (
        <div
          id="ticket-event-options"
          role="listbox"
          className="absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded border border-border bg-surface p-1 shadow-lg"
        >
          {loading ? (
            <p className="p-3 text-sm text-text-muted">搜索中...</p>
          ) : events.length === 0 ? (
            <p className="p-3 text-sm text-text-muted">没有找到活动</p>
          ) : (
            events.map((event, index) => (
              <Button
                key={event.id}
                id={`ticket-event-option-${event.id}`}
                type="button"
                variant="ghost"
                size="sm"
                role="option"
                aria-selected={event.id === value || index === activeIndex}
                className="block h-auto w-full justify-start rounded px-3 py-2 text-left text-sm font-normal text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                onClick={() => {
                  onChange(event)
                  setOpen(false)
                }}
              >
                <span className="block font-medium">{event.title}</span>
                <span className="block text-xs text-text-muted">
                  {event.location || '未填写地点'}
                </span>
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function TicketEditorPage() {
  const { slug } = useParams<{ slug: string }>()
  const isEditing = Boolean(slug)
  const navigate = useNavigate()
  const { user, isAdmin, isBanned } = useAuth()
  const { show } = useToast()
  const [form, setForm] = useState<TicketFormData>(emptyForm)
  const [selectedEvent, setSelectedEvent] = useState<TicketListingEventOption | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown | null>(null)
  const [errors, setErrors] = useState<TicketFormErrors>({})

  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    void apiRequest<TicketListingDetailResponse>(`/api/ticket-listings/${slug}`, {
      method: 'GET',
      dedup: false,
      signal: controller.signal,
    })
      .then(({ listing }) => {
        if (controller.signal.aborted) return
        if (listing.authorUid !== user?.uid && !isAdmin) {
          setError(new Error('无权编辑该盘票信息'))
          return
        }
        setEditingId(listing.id)
        setForm({
          type: listing.type,
          eventMode: listing.eventId ? 'linked' : 'custom',
          eventId: listing.eventId || '',
          customEventName: listing.customEventName || '',
          quantity: String(listing.quantity),
          ticketTier: listing.ticketTier,
          seat: listing.seat,
          description: listing.description,
          contact: listing.contact,
        })
        if (listing.eventId && listing.eventSlug) {
          setSelectedEvent({
            id: listing.eventId,
            slug: listing.eventSlug,
            title: listing.eventName,
            location: listing.eventLocation || '',
            sortStart: null,
          })
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [isAdmin, slug, user?.uid])

  const setField = <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, event: undefined }))
  }

  const validate = (): TicketFormErrors => {
    const next: TicketFormErrors = {}
    const quantity = Number(form.quantity)
    if (form.eventMode === 'linked' && !form.eventId) next.event = '请选择一个站内活动'
    if (form.eventMode === 'custom' && !form.customEventName.trim())
      next.customEventName = '请填写自定义活动名称'
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > CONTENT_LIMITS.ticketListing.quantity
    )
      next.quantity = '数量必须是 1 到 10000 之间的整数'
    if (!form.ticketTier.trim()) next.ticketTier = '票档不能为空'
    if (!form.contact.trim()) next.contact = '联系方式不能为空'
    if (form.customEventName.length > CONTENT_LIMITS.ticketListing.customEventName)
      next.customEventName = `活动名称不能超过${CONTENT_LIMITS.ticketListing.customEventName}个字符`
    if (form.ticketTier.length > CONTENT_LIMITS.ticketListing.ticketTier)
      next.ticketTier = `票档不能超过${CONTENT_LIMITS.ticketListing.ticketTier}个字符`
    if (form.seat.length > CONTENT_LIMITS.ticketListing.seat)
      next.seat = `座位不能超过${CONTENT_LIMITS.ticketListing.seat}个字符`
    if (form.description.length > CONTENT_LIMITS.ticketListing.description)
      next.description = '描述内容过长'
    if (form.contact.length > CONTENT_LIMITS.ticketListing.contact)
      next.contact = '联系方式内容过长'
    return next
  }

  const submit = async (status: 'draft' | 'pending') => {
    if (!user || isBanned || saving) return
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      show(Object.values(nextErrors)[0] || '请检查表单', { variant: 'error' })
      return
    }
    if (isEditing && !editingId) {
      show('编辑对象尚未加载完成', { variant: 'error' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        type: form.type,
        eventId: form.eventMode === 'linked' ? form.eventId : undefined,
        customEventName: form.eventMode === 'custom' ? form.customEventName.trim() : undefined,
        quantity: Number(form.quantity),
        ticketTier: form.ticketTier.trim(),
        seat: form.seat.trim(),
        description: form.description.trim(),
        contact: form.contact.trim(),
        status,
      }
      const result = isEditing
        ? await apiPut<TicketListingDetailResponse>(`/api/ticket-listings/${editingId}`, payload)
        : await apiPost<TicketListingDetailResponse>('/api/ticket-listings', payload)
      invalidateApiCacheByPrefix('/api/ticket-listings')
      navigate(
        result.listing.status === 'draft'
          ? `/tickets/${result.listing.slug}/edit`
          : `/tickets/${result.listing.slug}`
      )
    } catch (saveError) {
      show(getErrorMessage(saveError, '保存盘票信息失败'), { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container py-20 text-center">
          <Spinner label="编辑器加载中" />
        </div>
      </div>
    )
  if (error)
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container py-20 text-center">
          <p className="text-text-primary">无法加载编辑内容</p>
          <p className="mt-2 text-sm text-text-muted">{getErrorMessage(error, '信息不存在')}</p>
        </div>
      </div>
    )

  return (
    <BookEditorShell>
      <BookEditorHeader
        title={isEditing ? '编辑盘票' : '发布盘票'}
        description="盘票只用于发布出票或收票信息，不提供支付、担保、撮合或站内交易。"
        backTo={isEditing && slug ? `/tickets/${slug}` : '/tickets'}
        backLabel="返回"
      />
      {isBanned && (
        <div className="mb-6 rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-4 text-sm text-[var(--color-error)]">
          账号已被封禁，无法提交盘票信息。
        </div>
      )}

      <form className="space-y-8" onSubmit={(event) => event.preventDefault()}>
        <BookEditorSection title="基本信息" className="border-t-0 pt-0">
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="出票或收票" required>
              <SegmentedControl
                value={form.type}
                options={[
                  { value: 'offer', label: '出票' },
                  { value: 'request', label: '收票' },
                ]}
                onValueChange={(value) => setField('type', value as TicketListingType)}
              />
            </Field>
            <Field label="活动来源" required error={errors.event}>
              <Select
                value={form.eventMode}
                onChange={(event) => {
                  setField('eventMode', event.target.value as EventMode)
                  setSelectedEvent(null)
                  setField('eventId', '')
                }}
              >
                {EVENT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-6">
            {form.eventMode === 'linked' ? (
              <Field
                label="站内活动"
                required
                error={errors.event}
                description={
                  selectedEvent
                    ? `已选择：${selectedEvent.title}`
                    : '输入关键词后从候选活动中选择。'
                }
              >
                <EventPicker
                  value={form.eventId}
                  selectedEvent={selectedEvent}
                  onChange={(event) => {
                    setSelectedEvent(event)
                    setField('eventId', event?.id || '')
                  }}
                />
              </Field>
            ) : (
              <Field label="自定义活动名称" required error={errors.customEventName}>
                <Input
                  value={form.customEventName}
                  onChange={(event) => setField('customEventName', event.target.value)}
                  maxLength={CONTENT_LIMITS.ticketListing.customEventName}
                />
                <CharacterCount
                  current={form.customEventName.length}
                  max={CONTENT_LIMITS.ticketListing.customEventName}
                />
              </Field>
            )}
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <Field label="数量" required error={errors.quantity}>
              <Input
                type="number"
                min={1}
                max={CONTENT_LIMITS.ticketListing.quantity}
                step={1}
                value={form.quantity}
                onChange={(event) => setField('quantity', event.target.value)}
              />
              <CharacterCount
                current={form.quantity.length}
                max={String(CONTENT_LIMITS.ticketListing.quantity).length}
              />
            </Field>
            <Field label="票档" required error={errors.ticketTier}>
              <Input
                value={form.ticketTier}
                onChange={(event) => setField('ticketTier', event.target.value)}
                maxLength={CONTENT_LIMITS.ticketListing.ticketTier}
              />
              <CharacterCount
                current={form.ticketTier.length}
                max={CONTENT_LIMITS.ticketListing.ticketTier}
              />
            </Field>
            <Field label="座位" error={errors.seat}>
              <Input
                value={form.seat}
                onChange={(event) => setField('seat', event.target.value)}
                maxLength={CONTENT_LIMITS.ticketListing.seat}
              />
              <CharacterCount current={form.seat.length} max={CONTENT_LIMITS.ticketListing.seat} />
            </Field>
          </div>
        </BookEditorSection>

        <BookEditorSection title="描述与联系方式">
          <Field label="描述" description="支持 Markdown，可留空。" error={errors.description}>
            <CharacterCount
              current={form.description.length}
              max={CONTENT_LIMITS.ticketListing.description}
            />
            <MarkdownEditor
              value={form.description}
              onChange={(value) => setField('description', value)}
              maxLength={CONTENT_LIMITS.ticketListing.description}
              height="320px"
              variant="book"
              ariaLabel="盘票描述"
            />
          </Field>
          <Field
            className="mt-6"
            label="联系方式"
            required
            description="请填写方便联系的方式，支持 Markdown。"
            error={errors.contact}
          >
            <CharacterCount
              current={form.contact.length}
              max={CONTENT_LIMITS.ticketListing.contact}
            />
            <Textarea
              value={form.contact}
              onChange={(event) => setField('contact', event.target.value)}
              maxLength={CONTENT_LIMITS.ticketListing.contact}
              rows={5}
              placeholder="例如：Markdown 联系方式"
            />
          </Field>
        </BookEditorSection>

        <BookEditorActions>
          <Button
            type="button"
            variant="secondary"
            disabled={saving || isBanned}
            onClick={() => void submit('draft')}
            leftIcon={<Check size={14} />}
          >
            保存草稿
          </Button>
          <Button
            type="button"
            disabled={saving || isBanned}
            loading={saving}
            loadingText="提交中..."
            onClick={() => void submit('pending')}
            leftIcon={<Check size={14} />}
          >
            {isAdmin ? '直接发布' : '提交审核'}
          </Button>
        </BookEditorActions>
      </form>
    </BookEditorShell>
  )
}

export const Tickets = () => (
  <Routes>
    <Route index element={<TicketListPage />} />
    <Route
      path="new"
      element={
        <RouteGuard title="发布盘票需要先登录">
          <TicketEditorPage />
        </RouteGuard>
      }
    />
    <Route
      path=":slug/edit"
      element={
        <RouteGuard title="编辑盘票需要先登录">
          <TicketEditorPage />
        </RouteGuard>
      }
    />
    <Route path=":slug" element={<TicketDetailPage />} />
    <Route path="*" element={<NotFound homePath="/tickets" homeLabel="返回盘票" />} />
  </Routes>
)

export default Tickets
