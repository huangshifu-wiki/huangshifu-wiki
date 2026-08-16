import React, { useEffect, useState } from 'react'

import { ExternalLink, Plus, Trash2 } from '@/src/components/icons'
import { apiPatch, apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import {
  getMusicPlatformLabel,
  getPlatformExternalUrl,
  isMusicPlatform,
  MUSIC_PLATFORM_OPTIONS,
} from '../lib/musicPlatformUrls'
import type { Platform } from '../types/common'
import type { AdminDataItem } from '../types/entities'
import type { DuplicateAlbumSourceWarning } from '../types/api'
import { useDialog } from './Dialog'
import { useToast } from './Toast'
import { BookEditorSection, BookFormField, bookCompactInputClass } from './BookEditor'
import { Button } from '@/src/components/ui'
import { FormModal } from './Modal/FormModal'

interface AlbumFormData {
  title: string
  artist: string
  releaseDate: string
  description: string
}

interface AlbumSourceDraft {
  key: string
  platform: Platform
  sourceId: string
  sourceUrl: string | null
  isPrimary: boolean
}

export interface AlbumFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  album: AdminDataItem | null
  onClose: () => void
  onSuccess: () => void
}

const emptyFormData: AlbumFormData = {
  title: '',
  artist: '',
  releaseDate: '',
  description: '',
}

const isAlbumSource = (
  value: unknown
): value is {
  id?: string
  platform: Platform
  sourceId: string
  sourceUrl?: string | null
  isPrimary?: boolean
} => {
  if (!value || typeof value !== 'object') return false
  if (!('platform' in value) || !('sourceId' in value)) return false
  return (
    typeof value.platform === 'string' &&
    isMusicPlatform(value.platform) &&
    typeof value.sourceId === 'string'
  )
}

const createSourceDraft = (key: string, platform: Platform): AlbumSourceDraft => ({
  key,
  platform,
  sourceId: '',
  sourceUrl: null,
  isPrimary: false,
})

const createEmptySources = (): AlbumSourceDraft[] =>
  MUSIC_PLATFORM_OPTIONS.map(({ value: platform }) =>
    createSourceDraft(`new-${platform}`, platform)
  )

const readSources = (album: AdminDataItem | null): AlbumSourceDraft[] => {
  const sourceItems = Array.isArray(album?.sources) ? album.sources : []
  const sources = sourceItems.flatMap((item, index) => {
    if (!isAlbumSource(item)) return []
    return [
      {
        key: item.id || `${item.platform}-${index}`,
        platform: item.platform,
        sourceId: item.sourceId,
        sourceUrl: item.sourceUrl || null,
        isPrimary: item.isPrimary === true,
      },
    ]
  })
  return sources.length ? sources : createEmptySources()
}

export const AlbumFormModal = ({ open, mode, album, onClose, onSuccess }: AlbumFormModalProps) => {
  const [formData, setFormData] = useState<AlbumFormData>({ ...emptyFormData })
  const [sources, setSources] = useState<AlbumSourceDraft[]>([])
  const [saving, setSaving] = useState(false)
  const { show } = useToast()
  const dialog = useDialog()
  const isEdit = mode === 'edit'

  useEffect(() => {
    if (!open) return
    setFormData(
      isEdit && album
        ? {
            title: String(album.title || ''),
            artist: String(album.artist || ''),
            releaseDate: typeof album.releaseDate === 'string' ? album.releaseDate : '',
            description: typeof album.description === 'string' ? album.description : '',
          }
        : { ...emptyFormData }
    )
    setSources(isEdit ? readSources(album) : createEmptySources())
    setSaving(false)
  }, [album, isEdit, open])

  const updateSource = (key: string, sourceId: string) => {
    setSources((previous) =>
      previous.map((source) =>
        source.key === key
          ? {
              ...source,
              sourceId,
              sourceUrl: source.sourceId.trim() === sourceId.trim() ? source.sourceUrl : null,
            }
          : source
      )
    )
  }

  const updateSourcePlatform = (key: string, platform: Platform) => {
    setSources((previous) =>
      previous.map((source) =>
        source.key === key ? { ...source, platform, sourceUrl: null } : source
      )
    )
  }

  const addSource = () => {
    setSources((previous) => [
      ...previous,
      createSourceDraft(`new-${Date.now()}-${previous.length}`, MUSIC_PLATFORM_OPTIONS[0].value),
    ])
  }

  const removeSource = (key: string) => {
    setSources((previous) => previous.filter((source) => source.key !== key))
  }

  const setPrimarySource = (key: string) => {
    setSources((previous) =>
      previous.map((source) => ({ ...source, isPrimary: source.key === key }))
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = formData.title.trim()
    if (!title) {
      show('请输入专辑标题', { variant: 'error' })
      return
    }
    const artist = formData.artist.trim()
    if (!artist) {
      show('请输入艺术家名称', { variant: 'error' })
      return
    }

    const normalizedSources = sources
      .map((source) => ({
        resourceType: 'album' as const,
        platform: source.platform,
        sourceId: source.sourceId.trim(),
        sourceUrl: source.sourceUrl,
        isPrimary: source.isPrimary,
      }))
      .filter((source) => source.sourceId)
    if (normalizedSources.length && !normalizedSources.some((source) => source.isPrimary)) {
      normalizedSources[0].isPrimary = true
    }

    setSaving(true)
    const payload = {
      title,
      artist,
      description: formData.description.trim() || null,
      releaseDate: formData.releaseDate.trim() || null,
      sources: normalizedSources,
    }
    try {
      let duplicateSources: DuplicateAlbumSourceWarning[] = []
      if (isEdit && album?.docId) {
        const result = await apiPatch<{ duplicates?: DuplicateAlbumSourceWarning[] }>(
          `/api/albums/${album.docId}`,
          payload
        )
        duplicateSources = result?.duplicates || []
      } else {
        const result = await apiPost<{ duplicates?: DuplicateAlbumSourceWarning[] }>(
          '/api/albums',
          payload
        )
        duplicateSources = result?.duplicates || []
      }
      invalidateMusicApiCaches()
      if (duplicateSources.length) {
        const message = duplicateSources
          .map(
            (duplicate) =>
              `${getMusicPlatformLabel(duplicate.platform)} ID ${duplicate.sourceId} 已被专辑「${duplicate.album.title}」使用，已保存为共享引用`
          )
          .join('；')
        const confirmed = await dialog.confirm({
          title: '平台ID重复提醒',
          message,
          confirmText: '知道了',
          cancelText: null,
          variant: 'info',
        })
        if (!confirmed) show(isEdit ? '专辑已更新' : '专辑已创建')
      } else {
        show(isEdit ? '专辑已更新' : '专辑已创建')
      }
      onSuccess()
      onClose()
    } catch (error) {
      show(error instanceof Error ? error.message : isEdit ? '更新专辑失败' : '创建专辑失败', {
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑专辑' : '添加专辑'}
      subtitle={isEdit ? '修改专辑基本信息和平台来源' : '手动创建新专辑'}
      onSubmit={handleSubmit}
      submitText={isEdit ? '保存' : '创建'}
      loading={saving}
      maxWidth="max-w-3xl"
    >
      <BookEditorSection title="基础信息" className="border-t-0 pt-0">
        <div className="space-y-4">
          <BookFormField label="专辑标题" htmlFor="album-form-title" required>
            <input
              id="album-form-title"
              type="text"
              value={formData.title}
              onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))}
              maxLength={CONTENT_LIMITS.album.title}
              placeholder="专辑名称"
              className={bookCompactInputClass}
            />
          </BookFormField>
          <BookFormField label="艺术家" htmlFor="album-form-artist" required>
            <input
              id="album-form-artist"
              type="text"
              value={formData.artist}
              onChange={(event) => setFormData((prev) => ({ ...prev, artist: event.target.value }))}
              maxLength={CONTENT_LIMITS.album.artist}
              placeholder="艺术家名称"
              className={bookCompactInputClass}
            />
          </BookFormField>
          <BookFormField label="发行日期" htmlFor="album-form-release-date">
            <input
              id="album-form-release-date"
              type="date"
              value={formData.releaseDate}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, releaseDate: event.target.value }))
              }
              className={bookCompactInputClass}
            />
          </BookFormField>
          <BookFormField label="专辑简介" htmlFor="album-form-description">
            <textarea
              id="album-form-description"
              value={formData.description}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, description: event.target.value }))
              }
              maxLength={CONTENT_LIMITS.album.description}
              placeholder="专辑简介（可选）"
              rows={5}
              className={`${bookCompactInputClass} resize-none`}
            />
          </BookFormField>
        </div>
      </BookEditorSection>
      <BookEditorSection title="平台来源">
        <div className="space-y-2">
          {sources.map((source, index) => {
            const platformOption = MUSIC_PLATFORM_OPTIONS.find(
              (option) => option.value === source.platform
            )
            const platformLabel = platformOption?.label || source.platform
            const sourceId = source.sourceId.trim()
            return (
              <div
                key={source.key}
                className="grid grid-cols-[7rem_minmax(0,1fr)_auto_auto] items-center gap-2"
              >
                <select
                  value={source.platform}
                  onChange={(event) => {
                    const option = MUSIC_PLATFORM_OPTIONS.find(
                      (item) => item.value === event.target.value
                    )
                    if (option) updateSourcePlatform(source.key, option.value)
                  }}
                  aria-label={`来源平台 ${index + 1}`}
                  className={bookCompactInputClass}
                >
                  {MUSIC_PLATFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={source.sourceId}
                  onChange={(event) => updateSource(source.key, event.target.value)}
                  maxLength={CONTENT_LIMITS.album.sourceId}
                  placeholder={`${platformLabel} 专辑来源 ID`}
                  aria-label={`${platformLabel}来源 ID ${index + 1}`}
                  className={bookCompactInputClass}
                />
                {sourceId ? (
                  <a
                    href={getPlatformExternalUrl(source.platform, sourceId) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded p-2 text-text-muted hover:text-brand-gold"
                    aria-label={`打开${platformLabel}`}
                  >
                    <ExternalLink size={15} />
                  </a>
                ) : (
                  <span className="h-8 w-8" />
                )}
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    <input
                      type="radio"
                      name="album-primary-source"
                      checked={source.isPrimary}
                      onChange={() => setPrimarySource(source.key)}
                    />
                    主来源
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSource(source.key)}
                    aria-label={`删除来源 ${index + 1}`}
                    leftIcon={<Trash2 size={14} />}
                  />
                </div>
              </div>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addSource}
            leftIcon={<Plus size={14} />}
          >
            添加平台来源
          </Button>
        </div>
      </BookEditorSection>
    </FormModal>
  )
}

export default AlbumFormModal
