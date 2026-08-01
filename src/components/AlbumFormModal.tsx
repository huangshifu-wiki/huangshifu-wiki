import React, { useEffect, useState } from 'react'

import { ExternalLink } from '@/src/components/icons'
import { apiPatch, apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import {
  getMusicPlatformLabel,
  getPlatformExternalUrl,
  MUSIC_PLATFORM_OPTIONS,
} from '../lib/musicPlatformUrls'
import type { Platform } from '../types/common'
import type { AdminDataItem } from '../types/entities'
import type { DuplicateAlbumSourceWarning } from '../types/api'
import { useDialog } from './Dialog'
import { useToast } from './Toast'
import { BookEditorSection, BookFormField, bookCompactInputClass } from './BookEditor'
import { FormModal } from './Modal/FormModal'

interface AlbumFormData {
  title: string
  artist: string
  releaseDate: string
  description: string
}

interface AlbumSourceDraft {
  platform: Platform
  sourceId: string
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
): value is { platform: Platform; sourceId: string; isPrimary?: boolean } => {
  if (!value || typeof value !== 'object') return false
  if (!('platform' in value) || !('sourceId' in value)) return false
  return (
    MUSIC_PLATFORM_OPTIONS.some((item) => item.value === value.platform) &&
    typeof value.sourceId === 'string'
  )
}

const readSources = (album: AdminDataItem | null): AlbumSourceDraft[] => {
  const sourceItems = Array.isArray(album?.sources) ? album.sources : []
  return MUSIC_PLATFORM_OPTIONS.flatMap(({ value: platform }) => {
    const source = sourceItems.find((item) => isAlbumSource(item) && item.platform === platform)
    return source
      ? [{ platform, sourceId: source.sourceId, isPrimary: source.isPrimary === true }]
      : []
  })
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
    setSources(isEdit ? readSources(album) : [])
    setSaving(false)
  }, [album, isEdit, open])

  const updateSource = (platform: Platform, sourceId: string) => {
    setSources((previous) => {
      const next = previous.filter((source) => source.platform !== platform)
      if (sourceId.trim()) next.push({ platform, sourceId, isPrimary: false })
      return next
    })
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
        sourceUrl: null,
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
        // Esc/遮罩关闭弹窗时仍要有成功反馈，避免误判保存失败而重复提交
        if (!confirmed) {
          show(isEdit ? '专辑已更新' : '专辑已创建')
        }
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
          {MUSIC_PLATFORM_OPTIONS.map(({ value: platform, label }) => {
            const sourceId = sources.find((source) => source.platform === platform)?.sourceId || ''
            return (
              <div
                key={platform}
                className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2"
              >
                <span className="text-sm text-text-secondary">{label}</span>
                <input
                  type="text"
                  value={sourceId}
                  onChange={(event) => updateSource(platform, event.target.value)}
                  maxLength={CONTENT_LIMITS.album.sourceId}
                  placeholder="输入专辑来源 ID"
                  className={bookCompactInputClass}
                />
                {sourceId.trim() ? (
                  <a
                    href={getPlatformExternalUrl(platform, sourceId.trim()) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded p-2 text-text-muted hover:text-brand-gold"
                    aria-label={`打开${label}`}
                  >
                    <ExternalLink size={15} />
                  </a>
                ) : (
                  <span className="h-8 w-8" />
                )}
              </div>
            )
          })}
        </div>
      </BookEditorSection>
    </FormModal>
  )
}

export default AlbumFormModal
