import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
} from '../../lib/eventFormat'
import { formatUploadLimitWithSize, UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits'
import { normalizeWikiPageSlug } from '../../lib/wikiSlug'
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
  EventTimeSlot,
} from '../../types/entities'

type EditablePoster = {
  clientId: string
  imageId?: string
  assetId?: string
  url: string
  name: string
}

type EventDraft = {
  title: string
  slug: string
  location: string
  content: string
  timeSlots: EventTimeSlot[]
  ticketPrices: string[]
  saleTimes: EventSaleTime[]
  lineup: string[]
  externalLinks: EventExternalLink[]
  coverAssetId: string | null
  coverUrl: string | null
  posters: EditablePoster[]
}

const createEmptyDraft = (): EventDraft => ({
  title: '',
  slug: '',
  location: '',
  content: '',
  timeSlots: [{ type: 'datetime', start: '', end: '' }],
  ticketPrices: [''],
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

const createDraftFromEvent = (event: EventItem): EventDraft => ({
  title: event.title,
  slug: event.slug,
  location: event.location || '',
  content: event.content || '',
  timeSlots: event.timeSlots.length ? event.timeSlots : [{ type: 'datetime', start: '', end: '' }],
  ticketPrices: event.ticketPrices.length ? event.ticketPrices : [''],
  saleTimes: event.saleTimes,
  lineup: event.lineup.length ? event.lineup : [''],
  externalLinks: event.externalLinks,
  coverAssetId: event.coverAssetId,
  coverUrl: getEventCoverSrc(event),
  posters: event.posters.map(toEditablePoster),
})

const normalizeStringList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)

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

const AdminEventEdit = () => {
  const { eventId } = useParams()
  const isCreating = !eventId
  const navigate = useNavigate()
  const { show } = useToast()
  const [draft, setDraft] = useState<EventDraft>(createEmptyDraft)
  const [loading, setLoading] = useState(!isCreating)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  const derivedSlug = useMemo(
    () => normalizeWikiPageSlug(draft.slug || draft.title).replace(/^-+|-+$/g, ''),
    [draft.slug, draft.title]
  )

  const patchDraft = (patch: Partial<EventDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
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

    const payload = {
      title: draft.title.trim(),
      slug: derivedSlug,
      location: draft.location.trim(),
      content: draft.content,
      timeSlots: normalizeTimeSlots(draft.timeSlots),
      ticketPrices: normalizeStringList(draft.ticketPrices),
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
                value={draft.slug}
                onChange={(event) => patchDraft({ slug: event.target.value })}
                maxLength={CONTENT_LIMITS.event.slug}
                placeholder={`路径：${derivedSlug || '根据标题生成'}`}
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

          <section className="rounded border border-border bg-surface p-5">
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
          </section>

          <StringListEditor
            title="票价"
            values={draft.ticketPrices}
            placeholder="如：看台 280 / 内场 480"
            onChange={(ticketPrices) => patchDraft({ ticketPrices })}
          />
          <StringListEditor
            title="阵容"
            values={draft.lineup}
            placeholder="阵容成员"
            onChange={(lineup) => patchDraft({ lineup })}
          />

          <section className="rounded border border-border bg-surface p-5">
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
          </section>

          <section className="rounded border border-border bg-surface p-5">
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
          </section>
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
                  className="group relative aspect-[3/4] overflow-hidden rounded bg-surface-alt"
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
  <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
    <button
      type="button"
      onClick={onAdd}
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

const StringListEditor = ({
  title,
  values,
  placeholder,
  onChange,
}: {
  title: string
  values: string[]
  placeholder: string
  onChange: (values: string[]) => void
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
    <section className="rounded border border-border bg-surface p-5">
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
    </section>
  )
}

export default AdminEventEdit
