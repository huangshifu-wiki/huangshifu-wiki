import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  ArrowLeft,
  Calendar,
  Image as ImageIcon,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from '@/src/components/icons'
import MarkdownEditor from '../../components/MarkdownEditor'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SmartImage } from '../../components/SmartImage'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost, apiPut, invalidateApiCacheByPrefix } from '../../lib/apiClient'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import {
  EVENT_ALLOWED_IMAGE_TYPES,
  EVENT_IMAGE_ACCEPT,
  getEventCoverSrc,
  isEventTicketPrice,
} from '../../lib/eventFormat'
import { formatUploadLimitWithSize, UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'
import { uploadImageWithStrategy } from '../../services/imageService'
import type {
  AdminEventDetailResponse,
  EventDetailResponse,
  EventCreateResponse,
} from '../../types/api'
import type {
  EventExternalLink,
  EventItem,
  EventPosterItem,
  EventSaleTime,
  EventTicketPrice,
  EventTimeSlot,
} from '../../types/entities'

type EditablePoster = {
  clientId: string
  imageId?: string
  assetId?: string
  url: string
  name: string
}

type EditableTicketPrice = {
  description: string
  price: string
}

type JsonField = 'timeSlots' | 'ticketPrices' | 'saleTimes' | 'lineup' | 'externalLinks'

type JsonEditorState = {
  mode: 'form' | 'json'
}

type EventDraft = {
  title: string
  location: string
  content: string
  timeSlots: EventTimeSlot[]
  ticketPrices: EditableTicketPrice[]
  saleTimes: EventSaleTime[]
  lineup: string[]
  externalLinks: EventExternalLink[]
  coverAssetId: string | null
  coverUrl: string | null
  posters: EditablePoster[]
}

const JSON_FIELDS: JsonField[] = [
  'timeSlots',
  'ticketPrices',
  'saleTimes',
  'lineup',
  'externalLinks',
]

const createJsonEditorStates = (): Record<JsonField, JsonEditorState> =>
  Object.fromEntries(JSON_FIELDS.map((field) => [field, { mode: 'form' }])) as Record<
    JsonField,
    JsonEditorState
  >

const createEmptyTicketPrice = (): EditableTicketPrice => ({ description: '', price: '' })

const createEmptyDraft = (): EventDraft => ({
  title: '',
  location: '',
  content: '',
  timeSlots: [{ type: 'datetime', start: '', end: '' }],
  ticketPrices: [createEmptyTicketPrice()],
  saleTimes: [],
  lineup: [''],
  externalLinks: [],
  coverAssetId: null,
  coverUrl: null,
  posters: [],
})

const toEditablePoster = (poster: EventPosterItem): EditablePoster => ({
  clientId: poster.id,
  imageId: poster.id,
  assetId: poster.assetId || undefined,
  url: poster.url,
  name: poster.name,
})

const toEditableTicketPrice = (ticketPrice: unknown): EditableTicketPrice => {
  if (typeof ticketPrice === 'string') {
    return { description: ticketPrice, price: '' }
  }
  if (isEventTicketPrice(ticketPrice)) {
    return { description: ticketPrice.description || '', price: String(ticketPrice.price) }
  }
  return createEmptyTicketPrice()
}

const createDraftFromEvent = (event: EventItem): EventDraft => ({
  title: event.title,
  location: event.location || '',
  content: event.content || '',
  timeSlots: event.timeSlots.length ? event.timeSlots : [{ type: 'datetime', start: '', end: '' }],
  ticketPrices: event.ticketPrices.length
    ? event.ticketPrices.map(toEditableTicketPrice)
    : [createEmptyTicketPrice()],
  saleTimes: event.saleTimes,
  lineup: event.lineup.length ? event.lineup : [''],
  externalLinks: event.externalLinks,
  coverAssetId: event.coverAssetId,
  coverUrl: getEventCoverSrc(event),
  posters: event.posters.map(toEditablePoster),
})

const normalizeStringList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)

const toEventTicketPriceInput = (item: EditableTicketPrice): EventTicketPrice | null => {
  const description = item.description.trim()
  const price = item.price.trim()
  if (!description && !price) return null

  const numericPrice = Number(price)
  if (price === '' || !Number.isFinite(numericPrice) || numericPrice < 0) return null

  return {
    ...(description ? { description } : {}),
    price: numericPrice,
  }
}

const normalizeTicketPrices = (items: EditableTicketPrice[]) =>
  items
    .filter((item) => item.description.trim() || item.price.trim())
    .flatMap((item) => {
      const ticketPrice = toEventTicketPriceInput(item)
      return ticketPrice ? [ticketPrice] : []
    })

const hasInvalidTicketPrice = (items: EditableTicketPrice[]) =>
  items.some((item) => {
    const price = item.price.trim()
    if (!item.description.trim() && !price) return false
    return !toEventTicketPriceInput(item)
  })

const normalizeSaleTimes = (items: EventSaleTime[]) =>
  items
    .map((item) => ({ time: item.time.trim(), note: item.note?.trim() || undefined }))
    .filter((item) => item.time)

const normalizeExternalLinks = (items: EventExternalLink[]) =>
  items
    .map((item) => ({ label: item.label.trim(), url: item.url.trim() }))
    .filter((item) => item.label && item.url)

const normalizeTimeSlots = (items: EventTimeSlot[]) =>
  items
    .map((item) => ({
      type: item.type,
      start: item.start.trim(),
      end: item.end?.trim() || undefined,
    }))
    .filter((item) => item.start)

const stringifyJson = (value: unknown) => JSON.stringify(value, null, 2)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const jsonValueFromDraft = (draft: EventDraft, field: JsonField) => {
  if (field === 'ticketPrices') {
    return draft.ticketPrices
      .map((item) => {
        const ticketPrice = toEventTicketPriceInput(item)
        if (ticketPrice) return ticketPrice
        return {
          ...(item.description.trim() ? { description: item.description.trim() } : {}),
          price: item.price.trim(),
        }
      })
      .filter((item) => item.description || item.price !== '')
  }
  if (field === 'lineup') return normalizeStringList(draft.lineup)
  return draft[field]
}

const normalizeJsonTimeSlots = (value: unknown): EventTimeSlot[] => {
  if (!Array.isArray(value)) throw new Error('时间段必须是数组')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('时间段每一项必须是对象')
    const type = item.type === 'date' || item.type === 'datetime' ? item.type : null
    if (!type || typeof item.start !== 'string') {
      throw new Error('时间段必须包含 type 和 start')
    }
    return {
      type,
      start: item.start,
      ...(typeof item.end === 'string' && item.end ? { end: item.end } : {}),
    }
  })
}

const normalizeJsonTicketPrices = (value: unknown): EditableTicketPrice[] => {
  if (!Array.isArray(value)) throw new Error('票价必须是数组')
  if (value.length === 0) return [createEmptyTicketPrice()]
  return value.map((item) => {
    if (!isEventTicketPrice(item)) {
      throw new Error('票价 price 必须是非负数字')
    }
    return {
      description: item.description || '',
      price: String(item.price),
    }
  })
}

const normalizeJsonSaleTimes = (value: unknown): EventSaleTime[] => {
  if (!Array.isArray(value)) throw new Error('起售时间必须是数组')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.time !== 'string') {
      throw new Error('起售时间每一项必须包含 time')
    }
    return {
      time: item.time,
      ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
    }
  })
}

const normalizeJsonLineup = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('阵容必须是字符串数组')
  }
  return value.length ? value : ['']
}

const normalizeJsonExternalLinks = (value: unknown): EventExternalLink[] => {
  if (!Array.isArray(value)) throw new Error('外部链接必须是数组')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.label !== 'string' || typeof item.url !== 'string') {
      throw new Error('外部链接每一项必须包含 label 和 url')
    }
    return { label: item.label, url: item.url }
  })
}

const JSON_FIELD_NORMALIZERS = {
  timeSlots: (value: unknown) => ({ timeSlots: normalizeJsonTimeSlots(value) }),
  ticketPrices: (value: unknown) => ({ ticketPrices: normalizeJsonTicketPrices(value) }),
  saleTimes: (value: unknown) => ({ saleTimes: normalizeJsonSaleTimes(value) }),
  lineup: (value: unknown) => ({ lineup: normalizeJsonLineup(value) }),
  externalLinks: (value: unknown) => ({ externalLinks: normalizeJsonExternalLinks(value) }),
} satisfies Record<JsonField, (value: unknown) => Partial<EventDraft>>

const AdminEventEdit = () => {
  const { eventId } = useParams()
  const isCreating = !eventId
  const navigate = useNavigate()
  const { show } = useToast()
  const [draft, setDraft] = useState<EventDraft>(createEmptyDraft)
  const [loading, setLoading] = useState(!isCreating)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draggingPosterIndex, setDraggingPosterIndex] = useState<number | null>(null)
  const [jsonEditors, setJsonEditors] = useState(createJsonEditorStates)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const postersInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!eventId) {
      setDraft(createEmptyDraft())
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    apiGet<AdminEventDetailResponse>(`/api/admin/events/${eventId}`)
      .then((data) => {
        if (!cancelled) setDraft(createDraftFromEvent(data.item))
      })
      .catch((error) => {
        console.error('Fetch event for edit failed:', error)
        show('活动不存在或无法编辑', { variant: 'error' })
        navigate('/admin/events')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [eventId, navigate, show])

  const patchDraft = (patch: Partial<EventDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const openJsonEditor = (field: JsonField) => {
    setJsonEditors((prev) => ({
      ...prev,
      [field]: { mode: 'json' },
    }))
  }

  const closeJsonEditor = (field: JsonField) => {
    setJsonEditors((prev) => ({
      ...prev,
      [field]: { mode: 'form' },
    }))
  }

  const getJsonEditorText = (field: JsonField) => stringifyJson(jsonValueFromDraft(draft, field))

  const applyJsonEditor = (field: JsonField, text: string) => {
    try {
      const value = JSON.parse(text) as unknown
      patchDraft(JSON_FIELD_NORMALIZERS[field](value))
      setJsonEditors((prev) => ({
        ...prev,
        [field]: { mode: 'form' },
      }))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'JSON 格式无效'
    }
  }

  const uploadImageFile = async (file: File) => {
    if (!EVENT_ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error('请选择 jpg、png、gif、webp 或 bmp 图片')
    }
    if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
      throw new Error(`图片大小不能超过 ${formatUploadLimitWithSize()}`)
    }
    return uploadImageWithStrategy(file, { type: 'cover', reuseExisting: false })
  }

  const handleCoverChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const result = await uploadImageFile(file)
      patchDraft({ coverAssetId: result.assetId, coverUrl: result.url })
      show('封面已上传')
    } catch (error) {
      show(error instanceof Error ? error.message : '上传封面失败', { variant: 'error' })
    } finally {
      setUploading(false)
    }
  }

  const handlePostersChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    setUploading(true)
    try {
      const uploaded: EditablePoster[] = []
      for (const file of files) {
        const result = await uploadImageFile(file)
        uploaded.push({
          clientId: `asset-${result.assetId}-${Math.random().toString(36).slice(2, 8)}`,
          assetId: result.assetId,
          url: result.url,
          name: file.name,
        })
      }
      setDraft((prev) => ({ ...prev, posters: [...prev.posters, ...uploaded] }))
      show(`已上传 ${uploaded.length} 张海报`)
    } catch (error) {
      show(error instanceof Error ? error.message : '上传海报失败', { variant: 'error' })
    } finally {
      setUploading(false)
    }
  }

  const reorderPosters = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return

    const nextPosters = [...draft.posters]
    const [moved] = nextPosters.splice(fromIndex, 1)
    if (!moved) return
    nextPosters.splice(toIndex, 0, moved)
    patchDraft({ posters: nextPosters })
  }

  const handlePosterDragStart = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setDraggingPosterIndex(index)
  }

  const handlePosterDrop = (targetIndex: number) => {
    if (draggingPosterIndex === null) return

    const sourceIndex = draggingPosterIndex
    setDraggingPosterIndex(null)
    reorderPosters(sourceIndex, targetIndex)
  }

  const updateTimeSlot = (index: number, patch: Partial<EventTimeSlot>) => {
    const next = draft.timeSlots.map((slot, currentIndex) =>
      currentIndex === index
        ? {
            ...slot,
            ...patch,
            end: patch.type && patch.type !== slot.type ? '' : (patch.end ?? slot.end),
          }
        : slot
    )
    patchDraft({ timeSlots: next })
  }

  const save = async () => {
    if (!draft.title.trim()) {
      show('活动标题不能为空', { variant: 'error' })
      return
    }
    if (hasInvalidTicketPrice(draft.ticketPrices)) {
      show('票价必须填写有效的非负数字', { variant: 'error' })
      return
    }
    if (JSON_FIELDS.some((field) => jsonEditors[field].mode === 'json')) {
      show('请先应用或关闭 JSON 编辑内容', { variant: 'error' })
      return
    }

    const payload = {
      title: draft.title.trim(),
      location: draft.location.trim(),
      content: draft.content,
      timeSlots: normalizeTimeSlots(draft.timeSlots),
      ticketPrices: normalizeTicketPrices(draft.ticketPrices),
      saleTimes: normalizeSaleTimes(draft.saleTimes),
      lineup: normalizeStringList(draft.lineup),
      externalLinks: normalizeExternalLinks(draft.externalLinks),
      coverAssetId: draft.coverAssetId,
      posters: draft.posters.map((poster) =>
        poster.imageId ? { imageId: poster.imageId } : { assetId: poster.assetId }
      ),
    }

    setSaving(true)
    try {
      const result = isCreating
        ? await apiPost<EventCreateResponse>('/api/events', payload)
        : await apiPut<EventDetailResponse>(`/api/events/${eventId}`, payload)
      invalidateApiCacheByPrefix('/api/events')
      invalidateApiCacheByPrefix('/api/admin/events')
      show('活动已保存', { variant: 'success' })
      navigate(`/admin/events/${result.event.id}/edit`, { replace: true })
    } catch (error) {
      show(error instanceof Error ? error.message : '保存活动失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSkeleton />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/admin/events"
            className="mb-2 inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold"
          >
            <ArrowLeft size={16} />
            返回活动管理
          </Link>
          <h1 className="text-2xl font-bold tracking-[0.12em] text-text-primary">
            {isCreating ? '新增活动' : '编辑活动'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || uploading}
          className="rounded theme-button-primary px-4 py-2 text-sm transition-all disabled:cursor-wait disabled:opacity-60"
        >
          <Save size={14} className="mr-1 inline" />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Calendar size={16} className="text-brand-gold" />
              基本信息
            </h2>
            <div className="grid gap-4">
              <input
                value={draft.title}
                onChange={(event) => patchDraft({ title: event.target.value })}
                maxLength={CONTENT_LIMITS.event.title}
                placeholder="活动标题"
                className="rounded border border-border bg-surface-alt px-4 py-2 text-sm text-text-primary focus:border-brand-gold focus:outline-none"
              />
              <input
                value={draft.location}
                onChange={(event) => patchDraft({ location: event.target.value })}
                maxLength={CONTENT_LIMITS.event.location}
                placeholder="地点"
                className="rounded border border-border bg-surface-alt px-4 py-2 text-sm text-text-primary focus:border-brand-gold focus:outline-none"
              />
            </div>
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-text-primary">活动内容</h2>
            <MarkdownEditor
              value={draft.content}
              onChange={(content) => patchDraft({ content })}
              height="420px"
              placeholder="输入 Markdown 内容"
              maxLength={CONTENT_LIMITS.event.content}
            />
          </section>

          <JsonEditableSection
            title="时间段"
            field="timeSlots"
            state={jsonEditors.timeSlots}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          >
            <ListHeader
              title="时间段"
              onAdd={() =>
                patchDraft({
                  timeSlots: [...draft.timeSlots, { type: 'datetime', start: '', end: '' }],
                })
              }
            />
            <div className="space-y-3">
              {draft.timeSlots.map((slot, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[120px_1fr_1fr_auto]">
                  <select
                    value={slot.type}
                    onChange={(event) =>
                      updateTimeSlot(index, {
                        type: event.target.value as EventTimeSlot['type'],
                      })
                    }
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  >
                    <option value="datetime">日期时间</option>
                    <option value="date">仅日期</option>
                  </select>
                  <input
                    type={slot.type === 'date' ? 'date' : 'datetime-local'}
                    value={slot.start}
                    onChange={(event) => updateTimeSlot(index, { start: event.target.value })}
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <input
                    type={slot.type === 'date' ? 'date' : 'datetime-local'}
                    value={slot.end || ''}
                    onChange={(event) => updateTimeSlot(index, { end: event.target.value })}
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <IconButton
                    label="删除时间段"
                    onClick={() =>
                      patchDraft({
                        timeSlots: draft.timeSlots.filter(
                          (_, currentIndex) => currentIndex !== index
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </JsonEditableSection>

          <TicketPriceEditor
            values={draft.ticketPrices}
            onChange={(ticketPrices) => patchDraft({ ticketPrices })}
            field="ticketPrices"
            state={jsonEditors.ticketPrices}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          />
          <StringListEditor
            title="阵容"
            field="lineup"
            values={draft.lineup}
            placeholder="阵容成员"
            onChange={(lineup) => patchDraft({ lineup })}
            state={jsonEditors.lineup}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          />

          <JsonEditableSection
            title="起售时间"
            field="saleTimes"
            state={jsonEditors.saleTimes}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          >
            <ListHeader
              title="起售时间"
              onAdd={() => patchDraft({ saleTimes: [...draft.saleTimes, { time: '', note: '' }] })}
            />
            <div className="space-y-3">
              {draft.saleTimes.map((item, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    type="datetime-local"
                    value={item.time}
                    onChange={(event) =>
                      patchDraft({
                        saleTimes: draft.saleTimes.map((saleTime, currentIndex) =>
                          currentIndex === index
                            ? { ...saleTime, time: event.target.value }
                            : saleTime
                        ),
                      })
                    }
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <input
                    value={item.note || ''}
                    onChange={(event) =>
                      patchDraft({
                        saleTimes: draft.saleTimes.map((saleTime, currentIndex) =>
                          currentIndex === index
                            ? { ...saleTime, note: event.target.value }
                            : saleTime
                        ),
                      })
                    }
                    placeholder="备注，可选"
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <IconButton
                    label="删除起售时间"
                    onClick={() =>
                      patchDraft({
                        saleTimes: draft.saleTimes.filter(
                          (_, currentIndex) => currentIndex !== index
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </JsonEditableSection>

          <JsonEditableSection
            title="外部链接"
            field="externalLinks"
            state={jsonEditors.externalLinks}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          >
            <ListHeader
              title="外部链接"
              onAdd={() =>
                patchDraft({
                  externalLinks: [...draft.externalLinks, { label: '', url: '' }],
                })
              }
            />
            <div className="space-y-3">
              {draft.externalLinks.map((item, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={item.label}
                    onChange={(event) =>
                      patchDraft({
                        externalLinks: draft.externalLinks.map((link, currentIndex) =>
                          currentIndex === index ? { ...link, label: event.target.value } : link
                        ),
                      })
                    }
                    placeholder="链接名称"
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <input
                    value={item.url}
                    onChange={(event) =>
                      patchDraft({
                        externalLinks: draft.externalLinks.map((link, currentIndex) =>
                          currentIndex === index ? { ...link, url: event.target.value } : link
                        ),
                      })
                    }
                    placeholder="https://"
                    className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
                  />
                  <IconButton
                    label="删除链接"
                    onClick={() =>
                      patchDraft({
                        externalLinks: draft.externalLinks.filter(
                          (_, currentIndex) => currentIndex !== index
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </JsonEditableSection>
        </div>

        <aside className="space-y-5">
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ImageIcon size={16} className="text-brand-gold" />
              封面
            </h2>
            <div className="mb-3 aspect-[4/3] overflow-hidden rounded bg-surface-alt">
              {draft.coverUrl ? (
                <SmartImage
                  src={draft.coverUrl}
                  alt="封面"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">
                  暂无封面
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 rounded theme-button-secondary px-3 py-2 text-sm"
              >
                <Upload size={14} className="mr-1 inline" />
                上传
              </button>
              {draft.coverUrl && (
                <button
                  type="button"
                  onClick={() => patchDraft({ coverAssetId: null, coverUrl: null })}
                  className="rounded border border-border px-3 py-2 text-sm text-text-muted hover:text-brand-gold"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept={EVENT_IMAGE_ACCEPT}
              className="hidden"
              onChange={(event) => void handleCoverChange(event)}
            />
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <ImageIcon size={16} className="text-brand-gold" />
                海报
              </h2>
              <button
                type="button"
                onClick={() => postersInputRef.current?.click()}
                disabled={uploading}
                className="rounded theme-button-secondary px-3 py-1.5 text-xs"
              >
                <Upload size={13} className="mr-1 inline" />
                上传
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {draft.posters.map((poster, index) => (
                <div
                  key={poster.clientId}
                  draggable={!uploading}
                  onDragStart={(event) => handlePosterDragStart(event, index)}
                  onDragEnd={() => setDraggingPosterIndex(null)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    handlePosterDrop(index)
                  }}
                  className={clsx(
                    'group relative aspect-[3/4] cursor-grab overflow-hidden rounded bg-surface-alt active:cursor-grabbing',
                    draggingPosterIndex === index && 'opacity-60'
                  )}
                >
                  <SmartImage
                    src={poster.url}
                    alt={poster.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patchDraft({
                        posters: draft.posters.filter((_, currentIndex) => currentIndex !== index),
                      })
                    }
                    className="absolute right-1 top-1 rounded bg-surface/90 p-1 text-text-muted hover:text-brand-gold"
                    aria-label="删除海报"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            {!draft.posters.length && <p className="text-sm text-text-muted">暂无海报</p>}
            <input
              ref={postersInputRef}
              type="file"
              multiple
              accept={EVENT_IMAGE_ACCEPT}
              className="hidden"
              onChange={(event) => void handlePostersChange(event)}
            />
          </section>
        </aside>
      </div>
    </div>
  )
}

const ListHeader = ({ title, onAdd }: { title: string; onAdd: () => void }) => (
  <div className="mb-4 flex justify-end">
    <button
      type="button"
      onClick={onAdd}
      aria-label={`添加${title}`}
      className="rounded theme-button-secondary px-3 py-1.5 text-xs"
    >
      <Plus size={13} className="mr-1 inline" />
      添加
    </button>
  </div>
)

const IconButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded border border-border px-3 py-2 text-text-muted transition-colors hover:text-brand-gold"
    aria-label={label}
    title={label}
  >
    <Trash2 size={14} />
  </button>
)

const JsonEditableSection = ({
  title,
  field,
  state,
  getJsonText,
  onOpenJson,
  onCloseJson,
  onApplyJson,
  children,
}: {
  title: string
  field: JsonField
  state: JsonEditorState
  getJsonText: (field: JsonField) => string
  onOpenJson: (field: JsonField) => void
  onCloseJson: (field: JsonField) => void
  onApplyJson: (field: JsonField, text: string) => string | null
  children: React.ReactNode
}) => {
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const applyJson = () => {
    const error = onApplyJson(field, jsonText)
    setJsonError(error)
  }

  const openJson = () => {
    setJsonText(getJsonText(field))
    setJsonError(null)
    onOpenJson(field)
  }

  return (
    <section className="rounded border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {state.mode === 'json' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyJson}
              className="rounded theme-button-secondary px-3 py-1.5 text-xs"
            >
              应用 JSON
            </button>
            <button
              type="button"
              onClick={() => onCloseJson(field)}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-brand-gold"
            >
              表单
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openJson}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-brand-gold"
          >
            JSON
          </button>
        )}
      </div>
      {state.mode === 'json' ? (
        <div className="space-y-2">
          <textarea
            value={jsonText}
            onChange={(event) => {
              setJsonText(event.target.value)
              setJsonError(null)
            }}
            spellCheck={false}
            className="min-h-[180px] w-full rounded border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary focus:border-brand-gold focus:outline-none"
          />
          {jsonError && <p className="text-xs theme-text-error">{jsonError}</p>}
        </div>
      ) : (
        children
      )}
    </section>
  )
}

const TicketPriceEditor = ({
  values,
  onChange,
  field,
  state,
  getJsonText,
  onOpenJson,
  onCloseJson,
  onApplyJson,
}: {
  values: EditableTicketPrice[]
  onChange: (values: EditableTicketPrice[]) => void
  field: JsonField
  state: JsonEditorState
  getJsonText: (field: JsonField) => string
  onOpenJson: (field: JsonField) => void
  onCloseJson: (field: JsonField) => void
  onApplyJson: (field: JsonField, text: string) => string | null
}) => {
  const priceRefs = useRef<Array<HTMLInputElement | null>>([])
  const focusPrice = (index: number) => {
    window.requestAnimationFrame(() => priceRefs.current[index]?.focus())
  }
  const insertItem = (index: number) => {
    const next = [...values]
    next.splice(index, 0, { description: '', price: '' })
    onChange(next)
    focusPrice(index)
  }
  const updateItem = (index: number, patch: Partial<EditableTicketPrice>) => {
    onChange(
      values.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item))
    )
  }

  return (
    <JsonEditableSection
      title="票价"
      field={field}
      state={state}
      getJsonText={getJsonText}
      onOpenJson={onOpenJson}
      onCloseJson={onCloseJson}
      onApplyJson={onApplyJson}
    >
      <ListHeader title="票价" onAdd={() => insertItem(values.length)} />
      <div className="space-y-3">
        {values.map((value, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
            <input
              value={value.description}
              onChange={(event) => updateItem(index, { description: event.target.value })}
              maxLength={CONTENT_LIMITS.event.ticketPriceDescription}
              placeholder="描述，可选"
              className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
            />
            <input
              ref={(element) => {
                priceRefs.current[index] = element
              }}
              type="number"
              min="0"
              step="0.01"
              value={value.price}
              onChange={(event) => updateItem(index, { price: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                insertItem(index + 1)
              }}
              placeholder="价格"
              className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
            />
            <IconButton
              label="删除票价"
              onClick={() => onChange(values.filter((_, currentIndex) => currentIndex !== index))}
            />
          </div>
        ))}
      </div>
    </JsonEditableSection>
  )
}

const StringListEditor = ({
  title,
  field,
  values,
  placeholder,
  onChange,
  state,
  getJsonText,
  onOpenJson,
  onCloseJson,
  onApplyJson,
}: {
  title: string
  field: JsonField
  values: string[]
  placeholder: string
  onChange: (values: string[]) => void
  state: JsonEditorState
  getJsonText: (field: JsonField) => string
  onOpenJson: (field: JsonField) => void
  onCloseJson: (field: JsonField) => void
  onApplyJson: (field: JsonField, text: string) => string | null
}) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const focusInput = (index: number) => {
    window.requestAnimationFrame(() => inputRefs.current[index]?.focus())
  }
  const insertItem = (index: number) => {
    const next = [...values]
    next.splice(index, 0, '')
    onChange(next)
    focusInput(index)
  }
  const appendItem = () => insertItem(values.length)

  return (
    <JsonEditableSection
      title={title}
      field={field}
      state={state}
      getJsonText={getJsonText}
      onOpenJson={onOpenJson}
      onCloseJson={onCloseJson}
      onApplyJson={onApplyJson}
    >
      <ListHeader title={title} onAdd={appendItem} />
      <div className="space-y-3">
        {values.map((value, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              ref={(element) => {
                inputRefs.current[index] = element
              }}
              value={value}
              onChange={(event) =>
                onChange(
                  values.map((item, currentIndex) =>
                    currentIndex === index ? event.target.value : item
                  )
                )
              }
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                insertItem(index + 1)
              }}
              placeholder={placeholder}
              className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
            />
            <IconButton
              label={`删除${title}`}
              onClick={() => onChange(values.filter((_, currentIndex) => currentIndex !== index))}
            />
          </div>
        ))}
      </div>
    </JsonEditableSection>
  )
}

export default AdminEventEdit
