import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  BookDangerZone,
  BookEditorHeader,
  BookEditorShell,
  bookCompactInputClass,
} from '../../components/BookEditor'
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
import { getErrorMessage } from '../../lib/errorHandler'
import { validateMaxLength, validateRequiredText, validateTags } from '../../lib/clientValidation'
import { metadataCache } from '../../lib/metadataCache'
import { splitTagsInput } from '../../lib/contentUtils'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { useTagSuggestions } from '../../hooks/useTagSuggestions'
import { getWikiSaveResultText } from '../../lib/wikiWriteText'
import { Trash2 } from '@/src/components/icons'
import WikiEditorForm from './WikiEditorForm'
import WikiEditorRelationPanel from './WikiEditorRelationPanel'
import WikiEditorMetaSidebar from './WikiEditorMetaSidebar'
import type { WikiItemWithRelations, WikiRelationRecord } from './types'
import type { WikiPageMetadata } from '../../lib/wikiLinkParser'
import { useWikiCategories } from '../../hooks/useWikiCategories'
import { Button, Textarea } from '@/src/components/ui'

const WikiEditor = () => {
  const { slug } = useParams()
  const isNew = !slug || slug === 'new'
  const navigate = useNavigate()
  const { user, isAdmin, isBanned } = useAuth()
  const { t } = useI18n()
  const dialog = useDialog()
  const { categories, canEditCategory } = useWikiCategories()
  const tagSuggestions = useTagSuggestions('wiki')

  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    category: '',
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
    if (isNew && categories.length && !categories.some((item) => item.id === formData.category)) {
      setFormData((prev) => ({ ...prev, category: categories[0].id }))
    }
  }, [categories, formData.category, isNew])

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

    const tags = splitTagsInput(formData.tags)
    const validationError =
      validateRequiredText(formData.title, 'title', '标题') ||
      validateRequiredText(formData.category, 'category', '分类') ||
      validateRequiredText(formData.content, 'content', '内容') ||
      validateMaxLength(formData.title, 'title', '标题', CONTENT_LIMITS.wiki.title) ||
      validateMaxLength(formData.category, 'category', '分类', CONTENT_LIMITS.wiki.category) ||
      validateMaxLength(formData.content, 'content', '内容', CONTENT_LIMITS.wiki.content) ||
      validateTags(tags, 'tags', '标签', CONTENT_LIMITS.wiki.tags, CONTENT_LIMITS.wiki.tag) ||
      (formData.relations.length > CONTENT_LIMITS.wiki.relations
        ? { field: 'relations', message: `关系最多${CONTENT_LIMITS.wiki.relations}个` }
        : null) ||
      validateMaxLength(
        formData.locationCode,
        'locationCode',
        '地点编码',
        CONTENT_LIMITS.wiki.locationCode
      ) ||
      validateMaxLength(
        formData.locationName,
        'locationDetail',
        '地点详情',
        CONTENT_LIMITS.wiki.locationDetail
      )
    if (validationError) {
      show(validationError.message, { variant: 'error' })
      return
    }
    if (!canEditCategory(formData.category, isAdmin)) {
      show('该分类不可编辑或不存在', { variant: 'error' })
      return
    }

    setSavingMode(status)

    const pageData = {
      title: formData.title.trim(),
      category: formData.category.trim(),
      content: formData.content.trim(),
      tags,
      eventDate: formData.eventDate?.trim() || null,
      relations: formData.relations,
      locationCode: formData.locationCode?.trim() || null,
      locationDetail: formData.locationName?.trim() || null,
      status,
    }

    try {
      if (isNew) {
        const data = await apiPost<{ page: { slug: string; status: string } }>(
          '/api/wiki',
          pageData
        )
        show(getWikiSaveResultText(t, data.page.status as 'draft' | 'pending' | 'published'), {
          variant: 'success',
        })
        navigate(`/wiki/${data.page.slug}`)
        return
      }

      const pageSlug = slug || formData.slug
      const data = await apiPut<{ page: { slug: string; status: string } }>(
        `/api/wiki/${pageSlug}`,
        pageData
      )
      show(getWikiSaveResultText(t, data.page.status as 'draft' | 'pending' | 'published'), {
        variant: 'success',
      })
      invalidateApiCache(`GET|/api/wiki/${pageSlug}|`)
      navigate(`/wiki/${data.page.slug}`)
      return
    } catch (e) {
      console.error('Error saving wiki:', e)
      show(getErrorMessage(e, t('wiki.saveFailed')), { variant: 'error' })
    } finally {
      setSavingMode(null)
    }
    return
  }

  const handleDelete = async () => {
    if (isNew || !isAdmin || isDeleting) return

    const pageSlug = slug || formData.slug
    if (!pageSlug) {
      show(t('wiki.slugRequired'), { variant: 'error' })
      return
    }

    const reason = deleteReason.trim()
    if (!reason) {
      show('删除 Wiki 必须填写删除理由', { variant: 'error' })
      return
    }
    const reasonError = validateMaxLength(
      reason,
      'reason',
      '删除理由',
      CONTENT_LIMITS.wiki.reviewNote
    )
    if (reasonError) {
      show(reasonError.message, { variant: 'error' })
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
    <BookEditorShell>
      <BookEditorHeader
        title={isNew ? t('wiki.createWiki') : t('wiki.editWiki')}
        description={
          isNew
            ? '整理条目内容、地点和关联关系，保存后进入百科详情。'
            : '更新条目正文、元信息和关联关系，保存后回到百科详情。'
        }
        onClose={() => navigate(-1)}
        closeLabel={isNew ? t('wiki.createWiki') : t('wiki.editWiki')}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit('pending')
        }}
        className="space-y-7"
      >
        <WikiEditorForm
          formData={formData}
          categories={categories}
          tagSuggestions={tagSuggestions}
          onFormDataChange={handleFormDataChange}
        />

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
                  tags: splitTagsInput(formData.tags),
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
        <BookDangerZone
          id="wiki-advanced-options"
          title={t('wiki.deleteZoneTitle')}
          description={t('wiki.deleteZoneDescription')}
        >
          <label
            htmlFor="wiki-delete-reason"
            className="mt-4 block text-sm font-medium text-text-secondary"
          >
            {t('wiki.deleteReasonLabel')}
          </label>
          <Textarea
            id="wiki-delete-reason"
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            maxLength={1000}
            rows={3}
            className={`${bookCompactInputClass} mt-2 focus:border-danger`}
          />
          <Button
            type="button"
            variant="danger"
            onClick={handleDelete}
            loading={isDeleting}
            loadingText={t('wiki.deleting')}
            className="mt-4"
            leftIcon={<Trash2 size={16} />}
          >
            {t('wiki.deleteWiki')}
          </Button>
        </BookDangerZone>
      )}
    </BookEditorShell>
  )
}

export default WikiEditor
