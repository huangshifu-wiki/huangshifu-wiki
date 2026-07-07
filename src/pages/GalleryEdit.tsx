import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Plus, Save, Send, Trash2, X } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useAuth } from '../context/AuthContext'
import { CharacterCount } from '../components/CharacterCount'
import {
  BookDangerZone,
  BookEditorActions,
  BookEditorHeader,
  BookEditorSection,
  BookEditorShell,
  BookEmptyState,
  BookFormField,
  bookCompactInputClass,
  bookInputClass,
  bookSecondaryButtonClass,
} from '../components/BookEditor'
import { LocationTagInput } from '../components/LocationTagInput'
import { PageSkeleton } from '../components/PageSkeleton'
import { SmartImage } from '../components/SmartImage'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiUpload,
  invalidateApiCacheByPrefix,
} from '../lib/apiClient'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { splitTagsInput } from '../lib/contentUtils'
import { useI18n } from '../lib/i18n'
import {
  shouldWaitForAnyGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
import { formatUploadLimitWithSize, UPLOAD_MAX_FILE_SIZE_BYTES } from '../lib/uploadLimits'
import { findExistingImageMapByMd5, getImagePreference } from '../services/imageService'
import { runInBatches } from '../utils/asyncBatch'
import { calculateFileMd5Hex } from '../utils/fileMd5'
import type {
  GalleryCreateResponse,
  GalleryDetailResponse,
  UploadFileResponse,
  UploadSessionResponse,
} from '../types/api'
import type { GalleryImageItem, GalleryItem } from '../types/entities'

type EditableGalleryImage = GalleryImageItem & {
  clientId: string
  pendingFile?: File
  isPending?: boolean
}

type GalleryDraft = {
  title: string
  description: string
  tagsText: string
  locationName: string | null
  locationCode: string | null
  copyrightText: string
  images: EditableGalleryImage[]
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']
const UPLOAD_BATCH_SIZE = 3

const toEditableImage = (image: GalleryImageItem): EditableGalleryImage => ({
  ...image,
  clientId: image.id,
})

const getThumbnailSrc = (image: Pick<GalleryImageItem, 'thumbnailUrl' | 'url'>) =>
  image.thumbnailUrl || image.url || ''

const createPendingImage = (file: File): EditableGalleryImage => ({
  clientId: `pending-${Math.random().toString(36).slice(2, 10)}`,
  assetId: null,
  id: '',
  url: URL.createObjectURL(file),
  name: file.name,
  mimeType: file.type || null,
  sizeBytes: file.size,
  pendingFile: file,
  isPending: true,
})

const releasePendingImageUrls = (images: EditableGalleryImage[]) => {
  images.forEach((image) => {
    if (image.isPending) {
      URL.revokeObjectURL(image.url)
    }
  })
}

const createDraftFromGallery = (gallery: GalleryItem): GalleryDraft => ({
  title: gallery.title || '',
  description: gallery.description || '',
  tagsText: gallery.tags.join(', '),
  locationName: gallery.locationDetail || gallery.locationName || null,
  locationCode: gallery.locationCode || null,
  copyrightText: gallery.copyright || '',
  images: gallery.images.map(toEditableImage),
})

const createEmptyDraft = (): GalleryDraft => ({
  title: '',
  description: '',
  tagsText: '',
  locationName: null,
  locationCode: null,
  copyrightText: '',
  images: [],
})

const getGalleryPublicId = (gallery: GalleryItem) => gallery.slug || gallery.id

const mergeServerImagesIntoDraft = (
  draft: GalleryDraft,
  serverImages: GalleryImageItem[]
): GalleryDraft => {
  const serverImagesById = new Map(serverImages.map((image) => [image.id, toEditableImage(image)]))

  return {
    ...draft,
    images: draft.images.map((image) => {
      if (image.isPending || !image.id) return image
      return serverImagesById.get(image.id) || image
    }),
  }
}

const hasDraggedFiles = (event: Pick<React.DragEvent<HTMLElement>, 'dataTransfer'>) =>
  Array.from(event.dataTransfer?.types || []).includes('Files')

const GalleryEdit = () => {
  const { galleryId } = useParams()
  const isCreating = !galleryId
  const navigate = useNavigate()
  const { user, isAdmin, isBanned, loading: authLoading } = useAuth()
  const { show } = useToast()
  const dialog = useDialog()
  const { t } = useI18n()

  const [gallery, setGallery] = useState<GalleryItem | null>(null)
  const [draft, setDraft] = useState<GalleryDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMode, setSavingMode] = useState<'draft' | 'pending' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [pageDragDepth, setPageDragDepth] = useState(0)
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false)
  const [galleryAccessLoaded, setGalleryAccessLoaded] = useState(false)

  const addImagesInputRef = useRef<HTMLInputElement>(null)
  const addFolderInputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<GalleryDraft | null>(null)
  const hasPendingThumbnails = shouldWaitForAnyGalleryThumbnail(gallery)

  const applyDraft = (
    updater: GalleryDraft | null | ((prev: GalleryDraft | null) => GalleryDraft | null)
  ) => {
    const previous = draftRef.current
    const next =
      typeof updater === 'function'
        ? (updater as (value: GalleryDraft | null) => GalleryDraft | null)(previous)
        : updater
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    const fetchGalleryAccess = async () => {
      try {
        const data = await apiGet<{ adminOnly: boolean }>('/api/config/gallery-access')
        setIsGalleryAdminOnly(Boolean(data.adminOnly))
      } catch (error) {
        console.error('Fetch gallery access error:', error)
        setIsGalleryAdminOnly(false)
      } finally {
        setGalleryAccessLoaded(true)
      }
    }

    fetchGalleryAccess()
  }, [])

  useEffect(() => {
    const fetchGallery = async () => {
      if (!galleryId) {
        setGallery(null)
        applyDraft((prev) => {
          if (prev) {
            releasePendingImageUrls(prev.images)
          }
          return createEmptyDraft()
        })
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        const data = await apiGet<GalleryDetailResponse>(`/api/galleries/${galleryId}`)
        setGallery(data.gallery)
        applyDraft((prev) => {
          if (prev) {
            releasePendingImageUrls(prev.images)
          }
          return createDraftFromGallery(data.gallery)
        })
      } catch (error) {
        console.error('Fetch editable gallery error:', error)
        setGallery(null)
        applyDraft(null)
      } finally {
        setLoading(false)
      }
    }

    fetchGallery()
  }, [galleryId])

  useEffect(() => {
    if (isCreating || !galleryId || !hasPendingThumbnails) return

    const abortController = new AbortController()
    let attempts = 0
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      attempts += 1
      try {
        const data = await apiGet<GalleryDetailResponse>(
          `/api/galleries/${galleryId}`,
          undefined,
          THUMBNAIL_POLL_DEDUP_OPTIONS,
          abortController.signal
        )
        if (!stopped) {
          setGallery((prev) => (prev ? { ...prev, images: data.gallery.images } : data.gallery))
          applyDraft((prev) =>
            prev ? mergeServerImagesIntoDraft(prev, data.gallery.images) : prev
          )
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Poll editable gallery thumbnails error:', error)
        }
      }

      if (!stopped && attempts < THUMBNAIL_POLL_MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)
      }
    }

    timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)

    return () => {
      stopped = true
      abortController.abort()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [galleryId, hasPendingThumbnails, isCreating])

  useEffect(
    () => () => {
      if (draftRef.current) {
        releasePendingImageUrls(draftRef.current.images)
      }
    },
    []
  )

  useEffect(() => {
    setDeleteReason('')
    setShowAdvancedOptions(false)
  }, [galleryId, gallery?.authorUid])

  const canManage = Boolean(
    user &&
    !isBanned &&
    (isCreating
      ? !isGalleryAdminOnly || isAdmin
      : gallery && (isAdmin || (!isGalleryAdminOnly && gallery.authorUid === user.uid)))
  )

  const uploadFileToSession = async (sessionId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    const preference = await getImagePreference()
    const useTripleStorage = preference.strategy === 's3' || preference.strategy === 'external'

    const url = new URL(`/api/uploads/sessions/${sessionId}/files`, window.location.origin)
    if (useTripleStorage) {
      url.searchParams.set('tripleStorage', 'true')
    }

    return apiUpload<UploadFileResponse>(url.toString(), formData)
  }

  const appendPendingFiles = (fileList: FileList | File[]) => {
    if (!draftRef.current || !canManage || uploading || savingMode) return

    const files = Array.from(fileList)
    const invalidFiles: string[] = []
    const validImages: EditableGalleryImage[] = []

    files.forEach((file) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        invalidFiles.push(`${file.name} (${t('gallery.unsupportedFileType')})`)
        return
      }
      if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
        invalidFiles.push(
          `${file.name} (${t('gallery.fileTooLarge', { maxSize: formatUploadLimitWithSize() })})`
        )
        return
      }
      validImages.push(createPendingImage(file))
    })

    if (invalidFiles.length) {
      show(
        `${t('gallery.filesCannotAdd')}${invalidFiles.slice(0, 3).join(', ')}${
          invalidFiles.length > 3 ? '...' : ''
        }`,
        { variant: 'error' }
      )
    }
    if (!validImages.length) return

    applyDraft((prev) => (prev ? { ...prev, images: [...prev.images, ...validImages] } : prev))
    show(t('gallery.imagesAdded', { count: validImages.length }))
  }

  const handleAddImages = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (isCreating && !draftRef.current?.title) {
      const firstPath =
        (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || ''
      const folderName = firstPath.split('/')[0]
      if (folderName) {
        applyDraft((prev) => (prev ? { ...prev, title: folderName } : prev))
      }
    }
    appendPendingFiles(files)
  }

  const handleDeleteImage = (index: number) => {
    const currentDraft = draftRef.current
    if (!currentDraft || !canManage) return

    const image = currentDraft.images[index]
    if (!image?.clientId) {
      show(t('gallery.cannotDeleteImage'), { variant: 'error' })
      return
    }

    if (image.isPending) {
      URL.revokeObjectURL(image.url)
    }

    applyDraft((prev) =>
      prev
        ? { ...prev, images: prev.images.filter((_, currentIndex) => currentIndex !== index) }
        : prev
    )
    show(image.isPending ? t('gallery.pendingImageRemoved') : t('gallery.markedForDeletion'))
  }

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const currentDraft = draftRef.current
    if (!currentDraft || !canManage || fromIndex === toIndex) return

    const nextImages = [...currentDraft.images]
    const [moved] = nextImages.splice(fromIndex, 1)
    if (!moved) return
    nextImages.splice(toIndex, 0, moved)

    applyDraft((prev) => (prev ? { ...prev, images: nextImages } : prev))
  }

  const onThumbDragStart = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setDraggingIndex(index)
  }

  const onThumbDrop = (targetIndex: number) => {
    if (draggingIndex === null) return
    const sourceIndex = draggingIndex
    setDraggingIndex(null)
    handleReorder(sourceIndex, targetIndex)
  }

  const handlePageDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || !hasDraggedFiles(event)) return
    event.preventDefault()
    setPageDragDepth((prev) => prev + 1)
  }

  const handlePageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || !hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handlePageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || !hasDraggedFiles(event)) return
    event.preventDefault()
    setPageDragDepth((prev) => Math.max(0, prev - 1))
  }

  const handlePageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || !hasDraggedFiles(event)) return
    event.preventDefault()
    setPageDragDepth(0)
    if (!event.dataTransfer.files?.length) return
    appendPendingFiles(event.dataTransfer.files)
  }

  const handleSave = async (status: 'draft' | 'pending') => {
    const currentDraft = draftRef.current
    if (!currentDraft || !canManage || savingMode || uploading) return
    if (!isCreating && (!gallery || !galleryId)) return
    if (!currentDraft.title.trim()) {
      show(t('gallery.titleLabel') + '不能为空', { variant: 'error' })
      return
    }
    if (currentDraft.images.length === 0) {
      show(t('gallery.atLeastOneImage'), { variant: 'error' })
      return
    }

    setSavingMode(status)
    let redirectTarget: string | null = null

    try {
      const pendingImages = currentDraft.images.filter(
        (image) => image.isPending && image.pendingFile
      )
      const assetIdByClientId = new Map<string, string>()
      const imageUrlByClientId = new Map<string, { url: string; name: string }>()

      if (pendingImages.length) {
        setUploading(true)
        const imageTaskByMd5 = new Map<
          string,
          Promise<{ imageRef: { url: string; name: string }; assetId?: string }>
        >()
        let sessionId: string | null = null
        let sessionPromise: Promise<string> | null = null

        const ensureSession = async () => {
          if (sessionId) return sessionId
          if (!sessionPromise) {
            sessionPromise = apiPost<UploadSessionResponse>('/api/uploads/sessions', {
              maxFiles: pendingImages.length,
            }).then((sessionData) => {
              sessionId = sessionData.session.id
              return sessionId
            })
          }
          return sessionPromise
        }

        const processPendingImage = async (image: EditableGalleryImage) => {
          const file = image.pendingFile
          if (!file) return

          const md5 = await calculateFileMd5Hex(file)
          let imageTask = imageTaskByMd5.get(md5)
          if (!imageTask) {
            imageTask = (async () => {
              const existing = await findExistingImageMapByMd5(md5)
              if (existing) {
                return {
                  imageRef: { url: existing.localUrl, name: image.name || file.name },
                }
              }

              const uploadResult = await uploadFileToSession(await ensureSession(), file)
              return {
                assetId: uploadResult.asset.id,
                imageRef: {
                  url: uploadResult.tripleStorage?.localUrl || uploadResult.asset.publicUrl,
                  name: uploadResult.asset.fileName || image.name || file.name,
                },
              }
            })()
            imageTaskByMd5.set(md5, imageTask)
          }

          const result = await imageTask
          if (result.assetId) {
            assetIdByClientId.set(image.clientId, result.assetId)
          }
          imageUrlByClientId.set(image.clientId, result.imageRef)
        }

        await runInBatches(pendingImages, UPLOAD_BATCH_SIZE, processPendingImage)

        if (sessionId) {
          await apiPost(`/api/uploads/sessions/${sessionId}/finalize`)
        }
      }

      const imagesPayload = currentDraft.images
        .map((image) =>
          image.isPending
            ? isCreating
              ? imageUrlByClientId.get(image.clientId)
              : assetIdByClientId.has(image.clientId)
                ? { assetId: assetIdByClientId.get(image.clientId) }
                : imageUrlByClientId.get(image.clientId)
            : { imageId: image.id }
        )
        .filter((image) => image && ('imageId' in image || 'assetId' in image || 'url' in image))
      const galleryMetadataPayload = {
        title: currentDraft.title,
        description: currentDraft.description,
        tags: splitTagsInput(currentDraft.tagsText),
        locationCode: currentDraft.locationCode,
        locationDetail: currentDraft.locationName,
        copyright: currentDraft.copyrightText.trim() || null,
        status,
      }

      if (isCreating) {
        const created = await apiPost<GalleryCreateResponse>('/api/galleries', {
          ...galleryMetadataPayload,
          images: imagesPayload.filter((image) => image && 'url' in image),
        })

        const savedGallery = created.gallery
        if (!savedGallery?.id) {
          throw new Error('Create gallery failed')
        }

        releasePendingImageUrls(currentDraft.images)
        if (savedGallery.status === 'published') {
          show(t('gallery.galleryPublished'))
        } else if (savedGallery.status === 'pending') {
          show(t('gallery.reviewSubmitted'))
        } else if (savedGallery.status === 'draft') {
          show(t('gallery.draftSaved'))
        }

        invalidateApiCacheByPrefix('/api/galleries')
        redirectTarget = `/gallery/${getGalleryPublicId(savedGallery)}`
      } else {
        if (!gallery?.id) {
          throw new Error('Gallery id missing')
        }
        const result = await apiPatch<GalleryDetailResponse>(`/api/galleries/${gallery.id}`, {
          ...galleryMetadataPayload,
          images: imagesPayload,
        })
        const savedGallery = result.gallery
        releasePendingImageUrls(currentDraft.images)
        setGallery(savedGallery)
        applyDraft(createDraftFromGallery(savedGallery))

        if (savedGallery.status === 'published') {
          show(t('gallery.galleryUpdated'))
        } else if (savedGallery.status === 'pending') {
          show(t('gallery.reviewSubmitted'))
        } else if (savedGallery.status === 'draft') {
          show(t('gallery.draftSaved'))
        }

        invalidateApiCacheByPrefix('/api/galleries')
        redirectTarget = `/gallery/${getGalleryPublicId(savedGallery)}`
      }
    } catch (error) {
      console.error('Save gallery error:', error)
      show(
        status === 'draft'
          ? t('gallery.saveDraftFailed')
          : t(isAdmin ? 'gallery.publishFailed' : 'gallery.submitReviewFailed'),
        { variant: 'error' }
      )
    } finally {
      setUploading(false)
      setSavingMode(null)
    }

    if (redirectTarget) {
      navigate(redirectTarget)
    }
  }

  const handleCancel = () => {
    navigate(gallery ? `/gallery/${getGalleryPublicId(gallery)}` : '/gallery')
  }

  const handleDelete = async () => {
    if (!galleryId || isCreating || !gallery || isDeleting) return
    if (!user || (gallery.authorUid !== user.uid && !isAdmin)) return

    const isSelfDelete = gallery.authorUid === user.uid
    const reason = isSelfDelete ? null : deleteReason.trim()
    if (!isSelfDelete && !reason) {
      show(t('gallery.deleteOtherReasonRequired'), { variant: 'error' })
      return
    }

    const confirmed = await dialog.confirm({
      title: t('gallery.deleteGalleryTitle'),
      message: t('gallery.deleteGalleryConfirm', { title: gallery.title || galleryId }),
      confirmText: t('gallery.delete'),
      variant: 'danger',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await apiDelete(`/api/galleries/${gallery.id}`, reason ? { reason } : {})
      invalidateApiCacheByPrefix('/api/galleries')
      show(t('gallery.galleryDeleted'), { variant: 'success' })
      navigate('/gallery')
    } catch (error) {
      console.error('Error deleting gallery:', error)
      show(error instanceof Error ? error.message : t('gallery.deleteGalleryFailed'), {
        variant: 'error',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  if (loading || authLoading || !galleryAccessLoaded) {
    return <PageSkeleton variant="gallery" />
  }

  if (!draft || (!isCreating && !gallery)) {
    return (
      <BookEditorShell>
        <button
          type="button"
          onClick={() => navigate('/gallery')}
          className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} /> {t('gallery.backToList')}
        </button>
        <BookEmptyState>{t('gallery.notFound')}</BookEmptyState>
      </BookEditorShell>
    )
  }

  if (!canManage) {
    return (
      <BookEditorShell>
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} /> 返回图集
        </button>
        <BookEmptyState>{isCreating ? '无权上传图集' : '无权编辑该图集'}</BookEmptyState>
      </BookEditorShell>
    )
  }

  const submitButtonText =
    savingMode === 'pending'
      ? t(isAdmin ? 'gallery.publishing' : 'gallery.submitting')
      : t(isAdmin ? 'gallery.publishGallery' : 'gallery.submitReview')

  return (
    <BookEditorShell
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {pageDragDepth > 0 ? (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg-antique)_82%,transparent)] px-4">
          <div className="w-full max-w-3xl rounded border-2 border-dashed border-brand-gold bg-[var(--book-panel-bg-strong)] px-8 py-12 text-center shadow-[var(--book-panel-shadow)]">
            <p className="text-lg font-bold text-text-primary">{t('gallery.dropToUpload')}</p>
            <p className="mt-2 text-sm text-text-muted">{t('gallery.dropHint')}</p>
          </div>
        </div>
      ) : null}

      <BookEditorHeader
        title={isCreating ? '上传新图集' : '编辑图集'}
        description={
          isCreating
            ? '填写图集信息并加入图片，保存后进入图集详情。'
            : '调整图集信息、图片顺序和新增图片，保存后回到图集详情。'
        }
        backTo={gallery ? `/gallery/${getGalleryPublicId(gallery)}` : '/gallery'}
        backLabel="返回图集"
        onClose={handleCancel}
        closeLabel={t('gallery.cancelEdit')}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave('pending')
        }}
        className="space-y-8"
      >
        <BookEditorSection title="图集信息" className="border-t-0 pt-0">
          <div className="space-y-6">
            <BookFormField
              label={t('gallery.titleLabel')}
              htmlFor="gallery-title"
              required
              counter={
                <CharacterCount current={draft.title.length} max={CONTENT_LIMITS.gallery.title} />
              }
            >
              <input
                id="gallery-title"
                type="text"
                required
                value={draft.title}
                onChange={(event) =>
                  applyDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                }
                maxLength={CONTENT_LIMITS.gallery.title}
                placeholder={t('gallery.titlePlaceholder')}
                className={bookInputClass}
              />
            </BookFormField>

            <BookFormField
              label={t('gallery.descriptionLabel')}
              htmlFor="gallery-description"
              counter={
                <CharacterCount
                  current={draft.description.length}
                  max={CONTENT_LIMITS.gallery.description}
                />
              }
            >
              <textarea
                id="gallery-description"
                value={draft.description}
                onChange={(event) =>
                  applyDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                }
                maxLength={CONTENT_LIMITS.gallery.description}
                placeholder={t('gallery.descriptionPlaceholder')}
                rows={4}
                className={`${bookInputClass} resize-none`}
              />
            </BookFormField>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <BookFormField
                label={t('gallery.tagsLabel')}
                htmlFor="gallery-tags"
                counter={
                  <CharacterCount
                    current={draft.tagsText.length}
                    max={CONTENT_LIMITS.gallery.tag * CONTENT_LIMITS.gallery.tags}
                  />
                }
              >
                <input
                  id="gallery-tags"
                  type="text"
                  value={draft.tagsText}
                  onChange={(event) =>
                    applyDraft((prev) => (prev ? { ...prev, tagsText: event.target.value } : prev))
                  }
                  maxLength={CONTENT_LIMITS.gallery.tag * CONTENT_LIMITS.gallery.tags}
                  placeholder={t('gallery.tagsPlaceholder')}
                  className={bookInputClass}
                />
              </BookFormField>

              <BookFormField
                label={t('gallery.copyrightLabel')}
                htmlFor="gallery-copyright"
                counter={
                  <CharacterCount
                    current={draft.copyrightText.length}
                    max={CONTENT_LIMITS.gallery.copyright}
                  />
                }
              >
                <input
                  id="gallery-copyright"
                  type="text"
                  value={draft.copyrightText}
                  onChange={(event) =>
                    applyDraft((prev) =>
                      prev ? { ...prev, copyrightText: event.target.value } : prev
                    )
                  }
                  maxLength={CONTENT_LIMITS.gallery.copyright}
                  placeholder={t('gallery.copyrightPlaceholder')}
                  className={bookInputClass}
                />
              </BookFormField>

              <BookFormField
                label="地点"
                counter={
                  <CharacterCount
                    current={draft.locationName?.length || 0}
                    max={CONTENT_LIMITS.gallery.locationDetail}
                  />
                }
              >
                <LocationTagInput
                  value={draft.locationName}
                  locationCode={draft.locationCode}
                  onChange={(name, code) => {
                    applyDraft((prev) =>
                      prev ? { ...prev, locationName: name, locationCode: code } : prev
                    )
                  }}
                  onClear={() => {
                    applyDraft((prev) =>
                      prev ? { ...prev, locationName: null, locationCode: null } : prev
                    )
                  }}
                  variant="book"
                />
              </BookFormField>
            </div>
          </div>
        </BookEditorSection>

        <BookEditorSection title={t('gallery.imageCount', { count: draft.images.length })}>
          <input
            ref={addImagesInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
            className="hidden"
            onChange={handleAddImages}
          />
          <input
            ref={addFolderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is required for folder upload support.
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={handleAddImages}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5">
            {draft.images.map((image, index) => (
              <div
                key={image.clientId || image.id}
                draggable={canManage}
                onDragStart={(event) => onThumbDragStart(event, index)}
                onDragOver={(event) => {
                  if (!canManage) return
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  onThumbDrop(index)
                }}
                className={clsx(
                  'group relative aspect-square cursor-grab overflow-hidden rounded border border-[var(--book-ink-line)]/60 bg-[var(--book-panel-bg)] active:cursor-grabbing',
                  draggingIndex === index && 'opacity-60'
                )}
              >
                {getThumbnailSrc(image) ? (
                  <SmartImage
                    src={getThumbnailSrc(image)}
                    alt={image.name || ''}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--book-panel-bg)] px-2 text-center text-xs text-text-muted">
                    {image.thumbnailStatus === 'failed' ? '缩略图生成失败' : '生成中...'}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteImage(index)}
                  className="absolute left-1.5 top-1.5 z-10 rounded bg-[var(--book-panel-bg-strong)] p-1 text-text-muted shadow-[0_6px_18px_rgba(42,37,32,0.08)] transition-colors hover:text-[var(--color-error)]"
                  title={t('gallery.deleteImage')}
                >
                  <Trash2 size={12} />
                </button>
                {image.isPending ? (
                  <span className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-0.5 rounded bg-[var(--book-panel-bg-strong)] px-1.5 py-0.5 text-[10px] text-brand-gold shadow-[0_6px_18px_rgba(42,37,32,0.08)]">
                    {t('gallery.pendingUpload')}
                  </span>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              onClick={() => addImagesInputRef.current?.click()}
              disabled={uploading || Boolean(savingMode)}
              className="flex aspect-square items-center justify-center rounded border border-dashed border-brand-gold/40 bg-[var(--book-panel-bg)] text-brand-gold transition-colors hover:border-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
              title={uploading ? t('gallery.uploading') : t('gallery.addImages')}
            >
              <Plus size={24} />
            </button>
            <button
              type="button"
              onClick={() => addFolderInputRef.current?.click()}
              disabled={uploading || Boolean(savingMode)}
              className="flex aspect-square items-center justify-center rounded border border-dashed border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-muted transition-colors hover:border-brand-gold/50 hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
              title="上传整个文件夹"
            >
              文件夹
            </button>
          </div>
        </BookEditorSection>

        <BookEditorActions
          leading={
            !isCreating && gallery ? (
              <button
                type="button"
                onClick={() => setShowAdvancedOptions((value) => !value)}
                aria-expanded={showAdvancedOptions}
                aria-controls="gallery-advanced-options"
                className="mr-auto flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                />{' '}
                {t('gallery.advancedOptions')}
              </button>
            ) : null
          }
        >
          <button
            type="button"
            onClick={() => void handleSave('draft')}
            disabled={Boolean(savingMode) || uploading}
            className={bookSecondaryButtonClass}
          >
            <Save size={16} />{' '}
            {savingMode === 'draft' ? t('gallery.saving') : t('gallery.saveDraft')}
          </button>
          <button
            type="submit"
            disabled={Boolean(savingMode) || uploading}
            className="inline-flex items-center justify-center gap-2 rounded px-8 py-2.5 text-sm font-medium theme-button-primary transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} /> {submitButtonText}
          </button>
        </BookEditorActions>
      </form>

      {!isCreating && gallery && showAdvancedOptions && (
        <BookDangerZone
          id="gallery-advanced-options"
          title={t('gallery.deleteZoneTitle')}
          description={t('gallery.deleteZoneDescription')}
        >
          {gallery.authorUid !== user?.uid && (
            <label
              htmlFor="gallery-delete-reason"
              className="mt-4 block text-sm font-medium text-text-secondary"
            >
              {t('gallery.deleteReasonLabel')}
              <textarea
                id="gallery-delete-reason"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                maxLength={CONTENT_LIMITS.gallery.reviewNote}
                rows={3}
                className={`${bookCompactInputClass} mt-2 focus:border-danger`}
              />
            </label>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="mt-4 inline-flex items-center gap-2 rounded border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={16} />
            {isDeleting ? t('gallery.deletingGallery') : t('gallery.deleteGallery')}
          </button>
        </BookDangerZone>
      )}
    </BookEditorShell>
  )
}

export default GalleryEdit
