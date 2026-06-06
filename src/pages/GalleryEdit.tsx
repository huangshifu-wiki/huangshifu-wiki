import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../context/AuthContext'
import { CharacterCount } from '../components/CharacterCount'
import { LocationTagInput } from '../components/LocationTagInput'
import { PageSkeleton } from '../components/PageSkeleton'
import { SmartImage } from '../components/SmartImage'
import { useToast } from '../components/Toast'
import { apiGet, apiPatch, apiPost, apiUpload, invalidateApiCacheByPrefix } from '../lib/apiClient'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { splitTagsInput } from '../lib/contentUtils'
import { useI18n } from '../lib/i18n'
import { formatUploadLimitWithSize, UPLOAD_MAX_FILE_SIZE_BYTES } from '../lib/uploadLimits'
import { findExistingImageMapByMd5, getImagePreference } from '../services/imageService'
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

const toEditableImage = (image: GalleryImageItem): EditableGalleryImage => ({
  ...image,
  clientId: image.id,
})

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

const hasDraggedFiles = (event: Pick<React.DragEvent<HTMLElement>, 'dataTransfer'>) =>
  Array.from(event.dataTransfer?.types || []).includes('Files')

const GalleryEdit = () => {
  const { galleryId } = useParams()
  const isCreating = !galleryId
  const navigate = useNavigate()
  const { user, isAdmin, isBanned, loading: authLoading } = useAuth()
  const { show } = useToast()
  const { t } = useI18n()

  const [gallery, setGallery] = useState<GalleryItem | null>(null)
  const [draft, setDraft] = useState<GalleryDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMode, setSavingMode] = useState<'draft' | 'publish' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [pageDragDepth, setPageDragDepth] = useState(0)
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false)
  const [galleryAccessLoaded, setGalleryAccessLoaded] = useState(false)

  const addImagesInputRef = useRef<HTMLInputElement>(null)
  const addFolderInputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<GalleryDraft | null>(null)

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

  useEffect(
    () => () => {
      if (draftRef.current) {
        releasePendingImageUrls(draftRef.current.images)
      }
    },
    []
  )

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
    const fileList = event.target.files
    event.target.value = ''
    if (!fileList?.length) return
    if (isCreating && !draftRef.current?.title) {
      const firstPath =
        (fileList[0] as File & { webkitRelativePath?: string }).webkitRelativePath || ''
      const folderName = firstPath.split('/')[0]
      if (folderName) {
        applyDraft((prev) => (prev ? { ...prev, title: folderName } : prev))
      }
    }
    appendPendingFiles(fileList)
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

  const handleSave = async (mode: 'draft' | 'publish') => {
    const targetPublished = mode === 'publish'
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

    try {
      setSavingMode(mode)
      const pendingImages = currentDraft.images.filter(
        (image) => image.isPending && image.pendingFile
      )
      const assetIdByClientId = new Map<string, string>()
      const imageUrlByClientId = new Map<string, { url: string; name: string }>()

      if (pendingImages.length) {
        setUploading(true)
        const imageUrlByMd5 = new Map<string, { url: string; name: string }>()
        let sessionId: string | null = null

        const ensureSession = async () => {
          if (sessionId) return sessionId
          const sessionData = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {
            maxFiles: pendingImages.length,
          })
          sessionId = sessionData.session.id
          return sessionId
        }

        for (const image of pendingImages) {
          const file = image.pendingFile
          if (!file) continue

          const md5 = await calculateFileMd5Hex(file)
          const reusedImage = imageUrlByMd5.get(md5)
          if (reusedImage) {
            imageUrlByClientId.set(image.clientId, reusedImage)
            continue
          }

          const existing = await findExistingImageMapByMd5(md5)
          if (existing) {
            const imageRef = { url: existing.localUrl, name: image.name || file.name }
            imageUrlByMd5.set(md5, imageRef)
            imageUrlByClientId.set(image.clientId, imageRef)
            continue
          }

          const uploadResult = await uploadFileToSession(await ensureSession(), file)
          assetIdByClientId.set(image.clientId, uploadResult.asset.id)
          const uploadedImageRef = {
            url: uploadResult.asset.url,
            name: uploadResult.asset.fileName || image.name || file.name,
          }
          imageUrlByMd5.set(md5, uploadedImageRef)
          imageUrlByClientId.set(image.clientId, uploadedImageRef)
        }

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

      if (isCreating) {
        const created = await apiPost<GalleryCreateResponse>('/api/galleries', {
          title: currentDraft.title,
          description: currentDraft.description,
          tags: splitTagsInput(currentDraft.tagsText),
          locationCode: currentDraft.locationCode,
          locationDetail: currentDraft.locationName,
          images: imagesPayload.filter((image) => image && 'url' in image),
        })

        const createdId = created.gallery?.id
        if (!createdId) {
          throw new Error('Create gallery failed')
        }

        if (targetPublished || currentDraft.copyrightText.trim()) {
          await apiPatch<GalleryDetailResponse>(`/api/galleries/${createdId}`, {
            copyright: currentDraft.copyrightText.trim() || null,
            published: targetPublished,
          })
        }

        releasePendingImageUrls(currentDraft.images)
        invalidateApiCacheByPrefix('/api/galleries')
        show(t('gallery.changesSaved'))
        navigate(`/gallery/${createdId}`)
        return
      }

      const result = await apiPatch<GalleryDetailResponse>(`/api/galleries/${galleryId}`, {
        title: currentDraft.title,
        description: currentDraft.description,
        tags: splitTagsInput(currentDraft.tagsText),
        locationCode: currentDraft.locationCode,
        locationDetail: currentDraft.locationName,
        copyright: currentDraft.copyrightText.trim() || null,
        published: targetPublished,
        images: imagesPayload,
      })

      releasePendingImageUrls(currentDraft.images)
      setGallery(result.gallery)
      applyDraft(createDraftFromGallery(result.gallery))
      invalidateApiCacheByPrefix('/api/galleries')
      show(t('gallery.changesSaved'))
      navigate(`/gallery/${result.gallery.id}`)
    } catch (error) {
      console.error('Save gallery error:', error)
      show(t('gallery.saveFailed'), { variant: 'error' })
    } finally {
      setUploading(false)
      setSavingMode(null)
    }
  }

  const handleCancel = () => {
    navigate(galleryId ? `/gallery/${galleryId}` : '/gallery')
  }

  if (loading || authLoading || !galleryAccessLoaded) {
    return <PageSkeleton variant="gallery" />
  }

  if (!draft || (!isCreating && !gallery)) {
    return (
      <div className="min-h-[calc(100vh-60px)] bg-bg-primary">
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <button
            type="button"
            onClick={() => navigate('/gallery')}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={16} /> {t('gallery.backToList')}
          </button>
          <div className="mt-6 bg-surface rounded border border-border p-10 text-center text-text-muted italic tracking-[0.1em]">
            {t('gallery.notFound')}
          </div>
        </div>
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="min-h-[calc(100vh-60px)] bg-bg-primary">
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={16} /> 返回图集
          </button>
          <div className="mt-6 bg-surface rounded border border-border p-10 text-center text-text-muted italic tracking-[0.1em]">
            {isCreating ? '无权上传图集' : '无权编辑该图集'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {pageDragDepth > 0 ? (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-bg-primary/80 px-4">
          <div className="w-full max-w-3xl rounded border-2 border-dashed border-brand-gold bg-surface/95 px-8 py-12 text-center">
            <p className="text-lg font-bold text-text-primary">{t('gallery.dropToUpload')}</p>
            <p className="mt-2 text-sm text-text-muted">{t('gallery.dropHint')}</p>
          </div>
        </div>
      ) : null}

      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={handleCancel}
              className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
            >
              <ArrowLeft size={16} /> 返回图集
            </button>
            <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
              {isCreating ? '上传新图集' : '编辑图集'}
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              {isCreating
                ? '填写图集信息并加入图片，保存后进入图集详情。'
                : '调整图集信息、图片顺序和新增图片，保存后回到图集详情。'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-2 text-text-muted theme-icon-button-danger transition-colors"
            aria-label={t('gallery.cancelEdit')}
          >
            <X size={24} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave('publish')
          }}
          className="space-y-8"
        >
          <section className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="gallery-title"
                  className="text-xs font-bold uppercase tracking-widest text-text-muted"
                >
                  {t('gallery.titleLabel')} <span className="theme-text-error">*</span>
                </label>
                <CharacterCount current={draft.title.length} max={CONTENT_LIMITS.gallery.title} />
              </div>
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
                className="theme-input w-full px-4 py-3 rounded text-base"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="gallery-description"
                  className="text-xs font-bold uppercase tracking-widest text-text-muted"
                >
                  {t('gallery.descriptionLabel')}
                </label>
                <CharacterCount
                  current={draft.description.length}
                  max={CONTENT_LIMITS.gallery.description}
                />
              </div>
              <textarea
                id="gallery-description"
                value={draft.description}
                onChange={(event) =>
                  applyDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                }
                maxLength={CONTENT_LIMITS.gallery.description}
                placeholder={t('gallery.descriptionPlaceholder')}
                rows={4}
                className="theme-input w-full px-4 py-3 rounded text-base resize-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-2">
                <div className="flex min-h-5 items-center justify-between gap-3">
                  <label
                    htmlFor="gallery-tags"
                    className="text-xs font-bold uppercase tracking-widest text-text-muted"
                  >
                    {t('gallery.tagsLabel')}
                  </label>
                  <CharacterCount
                    current={draft.tagsText.length}
                    max={CONTENT_LIMITS.gallery.tag * CONTENT_LIMITS.gallery.tags}
                  />
                </div>
                <input
                  id="gallery-tags"
                  type="text"
                  value={draft.tagsText}
                  onChange={(event) =>
                    applyDraft((prev) => (prev ? { ...prev, tagsText: event.target.value } : prev))
                  }
                  maxLength={CONTENT_LIMITS.gallery.tag * CONTENT_LIMITS.gallery.tags}
                  placeholder={t('gallery.tagsPlaceholder')}
                  className="theme-input w-full px-4 py-3 rounded text-base"
                />
              </div>

              <div className="space-y-2">
                <div className="flex min-h-5 items-center justify-between gap-3">
                  <label
                    htmlFor="gallery-copyright"
                    className="text-xs font-bold uppercase tracking-widest text-text-muted"
                  >
                    {t('gallery.copyrightLabel')}
                  </label>
                  <CharacterCount
                    current={draft.copyrightText.length}
                    max={CONTENT_LIMITS.gallery.copyright}
                  />
                </div>
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
                  className="theme-input w-full px-4 py-3 rounded text-base"
                />
              </div>

              <div className="space-y-2">
                <div className="flex min-h-5 items-center justify-between gap-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
                    地点
                  </label>
                  <CharacterCount
                    current={draft.locationName?.length || 0}
                    max={CONTENT_LIMITS.gallery.locationDetail}
                  />
                </div>
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
                />
              </div>
            </div>
          </section>

          <section className="border-t border-border pt-7">
            <div className="mb-4">
              <div>
                <h2 className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]">
                  {t('gallery.imageCount', { count: draft.images.length })}
                </h2>
              </div>
            </div>

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

            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5">
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
                    'relative aspect-square cursor-grab overflow-hidden rounded group active:cursor-grabbing',
                    draggingIndex === index && 'opacity-60'
                  )}
                >
                  <SmartImage
                    src={image.url}
                    alt={image.name || ''}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteImage(index)}
                    className="absolute top-1.5 left-1.5 z-10 p-1 rounded bg-black/50 text-white hover:bg-[var(--color-error)]/80 transition-colors"
                    title={t('gallery.deleteImage')}
                  >
                    <Trash2 size={12} />
                  </button>
                  {image.isPending ? (
                    <span className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-theme-accent)] text-white">
                      {t('gallery.pendingUpload')}
                    </span>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={() => addImagesInputRef.current?.click()}
                disabled={uploading || Boolean(savingMode)}
                className="flex aspect-square items-center justify-center rounded border border-dashed border-brand-gold/40 bg-surface-alt text-brand-gold transition-colors hover:border-brand-gold hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed"
                title={uploading ? t('gallery.uploading') : t('gallery.addImages')}
              >
                <Plus size={24} />
              </button>
              <button
                type="button"
                onClick={() => addFolderInputRef.current?.click()}
                disabled={uploading || Boolean(savingMode)}
                className="flex aspect-square items-center justify-center rounded border border-dashed border-border bg-surface-alt text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-50 disabled:cursor-not-allowed"
                title="上传整个文件夹"
              >
                文件夹
              </button>
            </div>
          </section>

          <div className="pt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => void handleSave('draft')}
              disabled={Boolean(savingMode) || uploading}
              className="px-6 py-2.5 bg-surface-alt text-text-secondary border border-border rounded text-sm font-medium hover:border-brand-gold hover:text-brand-gold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={16} /> {savingMode === 'draft' ? t('gallery.saving') : '保存草稿'}
            </button>
            <button
              type="submit"
              disabled={Boolean(savingMode) || uploading}
              className="px-8 py-2.5 theme-button-primary rounded text-sm font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={16} /> {savingMode === 'publish' ? t('gallery.saving') : '发布'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default GalleryEdit
