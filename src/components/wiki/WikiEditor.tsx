import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { useI18n } from '../../lib/i18n'
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  invalidateApiCache,
  invalidateApiCacheByPrefix,
} from '../../lib/apiClient'
import { normalizeWikiPageSlug } from '../../lib/wikiSlug'
import { metadataCache } from '../../lib/metadataCache'
import { getWikiSaveResultText } from '../../lib/wikiWriteText'
import { Trash2, X } from '@/src/components/icons'
import WikiEditorForm from './WikiEditorForm'
import WikiEditorRelationPanel from './WikiEditorRelationPanel'
import WikiEditorMetaSidebar from './WikiEditorMetaSidebar'
import type { WikiItemWithRelations, WikiRelationRecord } from './types'
import type { WikiPageMetadata } from '../../lib/wikiLinkParser'

const WikiEditor = () => {
  const { slug } = useParams()
  const isNew = !slug || slug === 'new'
  const navigate = useNavigate()
  const { user, isAdmin, isBanned } = useAuth()
  const { t } = useI18n()
  const dialog = useDialog()

  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    category: 'biography',
    content: '',
    tags: '',
    eventDate: '',
    relations: [] as WikiRelationRecord[],
    locationCode: '',
    locationName: '',
  })
  const [savingMode, setSavingMode] = useState<'draft' | 'pending' | null>(null)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const { show } = useToast()

  // 图谱预览状态（由子组件内部管理，此处保留 metadataMap）
  const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(new Map())

  useEffect(() => {
    if (!isNew) {
      const fetchPage = async () => {
        try {
          const response = await apiGet<{ page: WikiItemWithRelations }>(`/api/wiki/${slug}`)
          const data = response.page
          setFormData({
            title: data.title,
            slug: data.slug,
            category: data.category,
            content: data.content,
            tags: data.tags?.join(', ') || '',
            eventDate: data.eventDate || '',
            relations: (data.relations as WikiRelationRecord[]) || [],
            locationCode: data.locationCode || '',
            locationName: data.locationDetail || data.locationName || '',
          })
        } catch (error) {
          console.error('Error fetching wiki page for edit:', error)
        }
      }
      fetchPage()
    }
  }, [slug, isNew])

  // 加载关联元数据
  useEffect(() => {
    const loadMetadata = async () => {
      if (formData.relations.length === 0) return
      const slugs = formData.relations.map((r) => r.targetSlug)
      const metadata = await metadataCache.getBatch(slugs)
      setMetadataMap(metadata)
    }
    loadMetadata()
  }, [formData.relations])

  const handleRelationsChange = (relations: WikiRelationRecord[]) => {
    setFormData({ ...formData, relations })
  }

  const handleFormDataChange = useCallback(
    (partial: Partial<typeof formData> | ((prev: typeof formData) => typeof formData)) => {
      setFormData((prev) =>
        typeof partial === 'function' ? partial(prev) : { ...prev, ...partial }
      )
    },
    []
  )

  const handleSubmit = async (status: 'draft' | 'pending') => {
    if (!user) return
    if (isBanned) {
      show(t('wiki.bannedCannotEdit'), { variant: 'error' })
      return
    }

    if (formData.category === 'music' && !isAdmin) {
      show(t('wiki.musicCategoryAdminOnly'), { variant: 'error' })
      return
    }

    if (!formData.title.trim()) {
      show(t('wiki.titleRequired'), { variant: 'error' })
      return
    }
    if (!formData.category) {
      show(t('wiki.categoryRequired'), { variant: 'error' })
      return
    }
    if (!formData.content.trim()) {
      show(t('wiki.contentRequired'), { variant: 'error' })
      return
    }

    const pageSlug = normalizeWikiPageSlug(
      isNew ? formData.slug || formData.title : slug || formData.slug
    )

    if (!pageSlug) {
      show(t('wiki.slugRequired'), { variant: 'error' })
      return
    }

    setSavingMode(status)

    const pageData = {
      title: formData.title,
      slug: pageSlug,
      category: formData.category,
      content: formData.content,
      tags: formData.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t),
      eventDate: formData.eventDate,
      relations: formData.relations,
      locationCode: formData.locationCode || null,
      locationDetail: formData.locationName || null,
      status,
    }

    try {
      if (isNew) {
        const data = await apiPost<{ page: { status: string } }>('/api/wiki', pageData)
        show(getWikiSaveResultText(t, data.page.status as 'draft' | 'pending' | 'published'), {
          variant: 'success',
        })
        navigate(`/wiki/${pageSlug}`)
        return
      }

      const data = await apiPut<{ page: { status: string } }>(`/api/wiki/${pageSlug}`, pageData)
      show(getWikiSaveResultText(t, data.page.status as 'draft' | 'pending' | 'published'), {
        variant: 'success',
      })
      invalidateApiCache(`GET|/api/wiki/${pageSlug}|`)
      navigate(`/wiki/${pageSlug}`)
      return
    } catch (e) {
      console.error('Error saving wiki page:', e)
      show(e instanceof Error ? e.message : t('wiki.saveFailed'), { variant: 'error' })
    } finally {
      setSavingMode(null)
    }
  }

  const handleDelete = async () => {
    if (isNew || !isAdmin || isDeleting) return

    const pageSlug = normalizeWikiPageSlug(slug || formData.slug)
    if (!pageSlug) {
      show(t('wiki.slugRequired'), { variant: 'error' })
      return
    }

    const reason = deleteReason.trim()
    if (!reason) {
      show('删除 Wiki 必须填写删除理由', { variant: 'error' })
      return
    }

    const confirmed = await dialog.confirm({
      title: '删除 Wiki',
      message: t('wiki.deleteConfirm', { title: formData.title || pageSlug }),
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      await apiDelete(`/api/wiki/${pageSlug}`, { reason })
      invalidateApiCache(`GET|/api/wiki/${pageSlug}|`)
      invalidateApiCacheByPrefix('/api/wiki')
      show(t('wiki.deleteSuccess'), { variant: 'success' })
      navigate('/wiki')
    } catch (e) {
      console.error('Error deleting wiki page:', e)
      show(e instanceof Error ? e.message : t('wiki.deleteFailed'), { variant: 'error' })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
            {isNew ? t('wiki.createWiki') : t('wiki.editWiki')}
          </h1>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 text-text-muted theme-icon-button-danger transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit('pending')
          }}
          className="space-y-6"
        >
          <WikiEditorForm formData={formData} onFormDataChange={handleFormDataChange} />

          <WikiEditorRelationPanel
            relations={formData.relations}
            onRelationsChange={handleRelationsChange}
            currentPage={
              isNew
                ? null
                : {
                    slug: formData.slug,
                    title: formData.title,
                    category: formData.category,
                    content: formData.content,
                    tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()) : [],
                    description: '',
                  }
            }
            metadataMap={metadataMap}
            isNew={isNew}
            slug={slug}
            formDataTitle={formData.title}
          />

          <WikiEditorMetaSidebar
            savingMode={savingMode}
            isAdmin={isAdmin}
            onSubmit={handleSubmit}
            showAdvancedToggle={!isNew && isAdmin}
            showAdvancedOptions={showAdvancedOptions}
            onToggleAdvancedOptions={() => setShowAdvancedOptions((value) => !value)}
          />
        </form>

        {!isNew && isAdmin && showAdvancedOptions && (
          <section className="mt-4 flex justify-start text-left">
            <div
              id="wiki-advanced-options"
              className="max-w-[520px] rounded border border-danger/30 bg-surface/60 p-5"
            >
              <h2 className="text-base font-bold text-danger tracking-[0.08em]">
                {t('wiki.deleteZoneTitle')}
              </h2>
              <p className="mt-2 text-sm text-text-muted">{t('wiki.deleteZoneDescription')}</p>
              <label
                htmlFor="wiki-delete-reason"
                className="mt-4 block text-sm font-medium text-text-secondary"
              >
                {t('wiki.deleteReasonLabel')}
              </label>
              <textarea
                id="wiki-delete-reason"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                maxLength={1000}
                rows={3}
                className="mt-2 w-full rounded border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-danger"
              />
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="mt-4 inline-flex items-center gap-2 rounded border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={16} />
                {isDeleting ? t('wiki.deleting') : t('wiki.deleteWiki')}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default WikiEditor
