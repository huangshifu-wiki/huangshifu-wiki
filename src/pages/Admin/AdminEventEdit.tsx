import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  ArrowLeft,
  Calendar,
  Image as ImageIcon,
  Loader2,
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
import { runInBatches } from '../../utils/asyncBatch'

type EditablePoster = {
  clientId: string
  imageId?: string
  assetId?: string
  url: string
  name: string
  uploadStatus?: UploadStatus
  progress?: number
  error?: string
  previewUrl?: string
}

type UploadStatus = 'uploading' | 'processing' | 'ready' | 'error'

type CoverUploadState = {
  previewUrl: string
  progress: number
  status: UploadStatus
  error?: string
}

type QueuedPosterUpload = {
  clientId: string
  file: File
  previewUrl: string
}

type PosterUploadResult = 'uploaded' | 'failed' | 'cancelled'
type PosterSaveInstruction = { imageId: string } | { assetId: string }

type EditableTicketPrice = {
  description: string
  price: string
}

type JsonField =
  | 'timeSlots'
  | 'ticketPrices'
  | 'saleTimes'
  | 'lineup'
  | 'externalLinks'
  | 'relatedLinks'

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
  relatedLinks: EventExternalLink[]
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
  'relatedLinks',
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
  relatedLinks: [],
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
  externalLinks: event.externalLinks || [],
  relatedLinks: event.relatedLinks || [],
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
  relatedLinks: (value: unknown) => ({ relatedLinks: normalizeJsonExternalLinks(value) }),
} satisfies Record<JsonField, (value: unknown) => Partial<EventDraft>>

const POSTER_UPLOAD_CONCURRENCY = 3

const isBusyUploadStatus = (status?: UploadStatus) =>
  status === 'uploading' || status === 'processing'

const toUploadProgress = (progress: number) => {
  const normalized = Math.max(1, Math.min(100, Math.round(progress)))
  return normalized >= 100 ? 95 : Math.min(normalized, 95)
}

const AdminEventEdit = () => {
  const { eventId } = useParams()
  const isCreating = !eventId
  const navigate = useNavigate()
  const { show } = useToast()
  const [draft, setDraft] = useState<EventDraft>(createEmptyDraft)
  const [loading, setLoading] = useState(!isCreating)
  const [saving, setSaving] = useState(false)
  const [coverUpload, setCoverUpload] = useState<CoverUploadState | null>(null)
  const [draggingPosterIndex, setDraggingPosterIndex] = useState<number | null>(null)
  const [jsonEditors, setJsonEditors] = useState(createJsonEditorStates)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const postersInputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef<Set<string>>(new Set())
  const coverUploadControllerRef = useRef<AbortController | null>(null)
  const posterUploadControllersRef = useRef<Map<string, AbortController>>(new Map())
  const cancelledPosterUploadsRef = useRef<Set<string>>(new Set())
  const unmountedRef = useRef(false)

  const createObjectUrl = (file: File) => {
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.add(url)
    return url
  }

  const revokeObjectUrl = (url?: string | null) => {
    if (!url || !objectUrlsRef.current.has(url)) return
    URL.revokeObjectURL(url)
    objectUrlsRef.current.delete(url)
  }

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      coverUploadControllerRef.current?.abort()
      posterUploadControllersRef.current.forEach((controller) => controller.abort())
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      objectUrlsRef.current.clear()
    }
  }, [])

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

  const updatePosterUpload = (clientId: string, patch: Partial<EditablePoster>) => {
    setDraft((prev) => ({
      ...prev,
      posters: prev.posters.map((poster) =>
        poster.clientId === clientId ? { ...poster, ...patch } : poster
      ),
    }))
  }

  const removePoster = (clientId: string) => {
    const controller = posterUploadControllersRef.current.get(clientId)
    if (controller) {
      controller.abort()
      posterUploadControllersRef.current.delete(clientId)
    }
    setDraft((prev) => {
      const removed = prev.posters.find((poster) => poster.clientId === clientId)
      if (isBusyUploadStatus(removed?.uploadStatus)) {
        cancelledPosterUploadsRef.current.add(clientId)
      }
      revokeObjectUrl(removed?.previewUrl)
      return {
        ...prev,
        posters: prev.posters.filter((poster) => poster.clientId !== clientId),
      }
    })
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

  const validateImageFile = (file: File) => {
    if (!EVENT_ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error('请选择 jpg、png、gif、webp 或 bmp 图片')
    }
    if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
      throw new Error(`图片大小不能超过 ${formatUploadLimitWithSize()}`)
    }
  }

  const uploadImageFile = async (
    file: File,
    options: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {}
  ) => {
    validateImageFile(file)
    return uploadImageWithStrategy(file, {
      type: 'cover',
      reuseExisting: false,
      onProgress: options.onProgress,
      signal: options.signal,
    })
  }

  const handleCoverChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    let previewUrl = ''
    let controller: AbortController | null = null
    try {
      validateImageFile(file)
      coverUploadControllerRef.current?.abort()
      if (coverUpload) revokeObjectUrl(coverUpload.previewUrl)
      previewUrl = createObjectUrl(file)
      controller = new AbortController()
      coverUploadControllerRef.current = controller
      setCoverUpload({ previewUrl, progress: 1, status: 'uploading' })

      const result = await uploadImageFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (
            !controller ||
            controller.signal.aborted ||
            coverUploadControllerRef.current !== controller ||
            unmountedRef.current
          ) {
            return
          }
          setCoverUpload((prev) =>
            prev?.previewUrl === previewUrl
              ? {
                  ...prev,
                  progress: toUploadProgress(progress),
                  status: progress >= 100 ? 'processing' : 'uploading',
                }
              : prev
          )
        },
      })
      if (
        controller.signal.aborted ||
        coverUploadControllerRef.current !== controller ||
        unmountedRef.current
      ) {
        revokeObjectUrl(previewUrl)
        return
      }
      setCoverUpload((prev) =>
        prev?.previewUrl === previewUrl ? { ...prev, progress: 100, status: 'ready' } : prev
      )
      patchDraft({ coverAssetId: result.assetId, coverUrl: result.url })
      window.setTimeout(() => {
        revokeObjectUrl(previewUrl)
        if (unmountedRef.current) return
        setCoverUpload((prev) => (prev?.previewUrl === previewUrl ? null : prev))
      }, 600)
      show('封面已上传')
    } catch (error) {
      if (
        !controller ||
        controller.signal.aborted ||
        coverUploadControllerRef.current !== controller ||
        unmountedRef.current
      ) {
        revokeObjectUrl(previewUrl)
        return
      }
      if (previewUrl) {
        setCoverUpload({
          previewUrl,
          progress: 0,
          status: 'error',
          error: error instanceof Error ? error.message : '上传封面失败',
        })
      }
      show(error instanceof Error ? error.message : '上传封面失败', { variant: 'error' })
    } finally {
      if (controller && coverUploadControllerRef.current === controller) {
        coverUploadControllerRef.current = null
      }
    }
  }

  const uploadPoster = async ({
    clientId,
    file,
    previewUrl,
  }: QueuedPosterUpload): Promise<PosterUploadResult> => {
    if (unmountedRef.current) {
      revokeObjectUrl(previewUrl)
      return 'cancelled'
    }
    if (cancelledPosterUploadsRef.current.delete(clientId)) {
      revokeObjectUrl(previewUrl)
      return 'cancelled'
    }

    const controller = new AbortController()
    posterUploadControllersRef.current.set(clientId, controller)
    try {
      const result = await uploadImageFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (
            controller.signal.aborted ||
            cancelledPosterUploadsRef.current.has(clientId) ||
            unmountedRef.current
          ) {
            return
          }
          updatePosterUpload(clientId, {
            progress: toUploadProgress(progress),
            uploadStatus: progress >= 100 ? 'processing' : 'uploading',
          })
        },
      })

      if (
        controller.signal.aborted ||
        unmountedRef.current ||
        cancelledPosterUploadsRef.current.delete(clientId)
      ) {
        revokeObjectUrl(previewUrl)
        return 'cancelled'
      }
      setDraft((prev) => ({
        ...prev,
        posters: prev.posters.map((poster) => {
          if (poster.clientId !== clientId) return poster
          return {
            ...poster,
            assetId: result.assetId,
            url: result.url,
            uploadStatus: 'ready',
            progress: 100,
            error: undefined,
            previewUrl: undefined,
          }
        }),
      }))
      revokeObjectUrl(previewUrl)
      return 'uploaded'
    } catch (error) {
      if (controller.signal.aborted) {
        cancelledPosterUploadsRef.current.delete(clientId)
        revokeObjectUrl(previewUrl)
        return 'cancelled'
      }
      if (unmountedRef.current) {
        cancelledPosterUploadsRef.current.delete(clientId)
        revokeObjectUrl(previewUrl)
        return 'cancelled'
      }
      cancelledPosterUploadsRef.current.delete(clientId)
      updatePosterUpload(clientId, {
        uploadStatus: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '上传海报失败',
      })
      return 'failed'
    } finally {
      cancelledPosterUploadsRef.current.delete(clientId)
      posterUploadControllersRef.current.delete(clientId)
    }
  }

  const uploadPosterQueue = async (items: QueuedPosterUpload[]) => {
    let successCount = 0
    let failedCount = 0

    await runInBatches(items, POSTER_UPLOAD_CONCURRENCY, async (item) => {
      const result = await uploadPoster(item)
      if (result === 'uploaded') {
        successCount += 1
      } else if (result === 'failed') {
        failedCount += 1
      }
    })

    if (unmountedRef.current) return
    if (successCount > 0 && failedCount === 0) {
      show(`已上传 ${successCount} 张海报`)
    } else if (successCount > 0 || failedCount > 0) {
      show(`海报上传完成：成功 ${successCount} 张，失败 ${failedCount} 张`, {
        variant: failedCount > 0 ? 'error' : 'success',
      })
    }
  }

  const handlePostersChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    const queued: QueuedPosterUpload[] = []
    const placeholders: EditablePoster[] = []
    const invalidMessages: string[] = []

    for (const file of files) {
      try {
        validateImageFile(file)
        const previewUrl = createObjectUrl(file)
        const clientId = `poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        cancelledPosterUploadsRef.current.delete(clientId)
        queued.push({ clientId, file, previewUrl })
        placeholders.push({
          clientId,
          url: previewUrl,
          previewUrl,
          name: file.name,
          uploadStatus: 'uploading',
          progress: 1,
        })
      } catch (error) {
        invalidMessages.push(`${file.name}: ${error instanceof Error ? error.message : '文件无效'}`)
      }
    }

    if (placeholders.length > 0) {
      setDraft((prev) => ({ ...prev, posters: [...prev.posters, ...placeholders] }))
      void uploadPosterQueue(queued)
    }

    if (invalidMessages.length > 0) {
      show(invalidMessages[0] || '部分图片无法上传', { variant: 'error' })
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
    const hasPendingUploads =
      isBusyUploadStatus(coverUpload?.status) ||
      draft.posters.some((poster) => isBusyUploadStatus(poster.uploadStatus))
    const hasFailedUploads =
      coverUpload?.status === 'error' ||
      draft.posters.some((poster) => poster.uploadStatus === 'error')
    const hasUnsavedPoster = draft.posters.some((poster) => !poster.imageId && !poster.assetId)

    if (hasPendingUploads) {
      show('请等待图片上传完成后再保存', { variant: 'error' })
      return
    }
    if (hasFailedUploads || hasUnsavedPoster) {
      show('请先删除或重新上传失败的图片', { variant: 'error' })
      return
    }
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
      relatedLinks: normalizeExternalLinks(draft.relatedLinks),
      coverAssetId: draft.coverAssetId,
      posters: draft.posters.flatMap<PosterSaveInstruction>((poster) => {
        if (poster.imageId) return [{ imageId: poster.imageId }]
        if (poster.assetId) return [{ assetId: poster.assetId }]
        return []
      }),
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

  const isCoverUploading = isBusyUploadStatus(coverUpload?.status)
  const hasPendingUploads =
    isCoverUploading || draft.posters.some((poster) => isBusyUploadStatus(poster.uploadStatus))
  const coverDisplayUrl =
    coverUpload && coverUpload.status !== 'error' ? coverUpload.previewUrl : draft.coverUrl

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
          disabled={saving || hasPendingUploads}
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

          <EventLinksEditor
            title="外部链接"
            deleteLabel="删除链接"
            field="externalLinks"
            values={draft.externalLinks}
            onChange={(externalLinks) => patchDraft({ externalLinks })}
            state={jsonEditors.externalLinks}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          />

          <EventLinksEditor
            title="其他相关链接"
            field="relatedLinks"
            deleteLabel="删除相关链接"
            values={draft.relatedLinks}
            onChange={(relatedLinks) => patchDraft({ relatedLinks })}
            state={jsonEditors.relatedLinks}
            getJsonText={getJsonEditorText}
            onOpenJson={openJsonEditor}
            onCloseJson={closeJsonEditor}
            onApplyJson={applyJsonEditor}
          />
        </div>

        <aside className="space-y-5">
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ImageIcon size={16} className="text-brand-gold" />
              封面
            </h2>
            <div className="relative mb-3 aspect-[4/3] overflow-hidden rounded bg-surface-alt">
              {coverDisplayUrl ? (
                <SmartImage
                  src={coverDisplayUrl}
                  alt="封面"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">
                  暂无封面
                </div>
              )}
              {coverUpload && coverUpload.status !== 'error' && (
                <UploadProgressOverlay
                  label={coverUpload.status === 'ready' ? '封面上传完成' : '封面上传中'}
                  progress={coverUpload.progress}
                  status={coverUpload.status}
                />
              )}
            </div>
            {coverUpload?.status === 'error' && (
              <UploadErrorMessage
                message={coverUpload.error || '封面上传失败'}
                onDismiss={() => {
                  revokeObjectUrl(coverUpload.previewUrl)
                  setCoverUpload(null)
                }}
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={saving || isCoverUploading}
                className="flex-1 rounded theme-button-secondary px-3 py-2 text-sm"
              >
                <Upload size={14} className="mr-1 inline" />
                {isCoverUploading ? '上传中...' : '上传'}
              </button>
              {draft.coverUrl && (
                <button
                  type="button"
                  onClick={() => {
                    coverUploadControllerRef.current?.abort()
                    coverUploadControllerRef.current = null
                    if (coverUpload) revokeObjectUrl(coverUpload.previewUrl)
                    setCoverUpload(null)
                    patchDraft({ coverAssetId: null, coverUrl: null })
                  }}
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
                disabled={saving}
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
                  draggable={!isBusyUploadStatus(poster.uploadStatus)}
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
                  {poster.uploadStatus && poster.uploadStatus !== 'ready' && (
                    <UploadProgressOverlay
                      label={
                        poster.uploadStatus === 'error'
                          ? '海报上传失败'
                          : poster.uploadStatus === 'processing'
                            ? '海报处理中'
                            : '海报上传中'
                      }
                      progress={poster.progress || 0}
                      status={poster.uploadStatus}
                      error={poster.error}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removePoster(poster.clientId)}
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

const UploadProgressOverlay = ({
  label,
  progress,
  status,
  error,
}: {
  label: string
  progress: number
  status: UploadStatus
  error?: string
}) => (
  <div className="absolute inset-x-0 bottom-0 bg-surface/90 p-2 text-xs text-text-primary backdrop-blur-sm">
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1 truncate">
        {isBusyUploadStatus(status) && <Loader2 size={12} className="shrink-0 animate-spin" />}
        <span className="truncate">{error || label}</span>
      </span>
      {status !== 'error' && <span className="shrink-0 tabular-nums">{progress}%</span>}
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-alt" role="progressbar">
      <div
        className={clsx(
          'h-full rounded-full transition-all',
          status === 'error' ? 'bg-red-500' : 'bg-brand-gold'
        )}
        style={{ width: `${status === 'error' ? 100 : progress}%` }}
      />
    </div>
  </div>
)

const UploadErrorMessage = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
  <div className="mb-3 flex items-center justify-between gap-2 rounded border theme-border-error-soft theme-bg-error-soft px-3 py-2 text-xs theme-text-error">
    <span className="min-w-0 break-words">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="shrink-0 rounded p-1 text-text-muted hover:text-brand-gold"
      aria-label="关闭上传错误"
    >
      <X size={12} />
    </button>
  </div>
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

const EventLinksEditor = ({
  title,
  field,
  values,
  deleteLabel,
  onChange,
  state,
  getJsonText,
  onOpenJson,
  onCloseJson,
  onApplyJson,
}: {
  title: string
  field: JsonField
  values: EventExternalLink[]
  deleteLabel: string
  onChange: (values: EventExternalLink[]) => void
  state: JsonEditorState
  getJsonText: (field: JsonField) => string
  onOpenJson: (field: JsonField) => void
  onCloseJson: (field: JsonField) => void
  onApplyJson: (field: JsonField, text: string) => string | null
}) => {
  const appendItem = () => onChange([...values, { label: '', url: '' }])
  const updateItem = (index: number, patch: Partial<EventExternalLink>) => {
    onChange(
      values.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item))
    )
  }

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
        {values.map((item, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={item.label}
              onChange={(event) => updateItem(index, { label: event.target.value })}
              placeholder="链接名称"
              className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
            />
            <input
              value={item.url}
              onChange={(event) => updateItem(index, { url: event.target.value })}
              placeholder="https://"
              className="rounded border border-border bg-surface-alt px-3 py-2 text-sm"
            />
            <IconButton
              label={deleteLabel}
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
