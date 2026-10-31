import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, Save, Send, Trash2 } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import MarkdownEditor from '../../components/MarkdownEditor'
import { CharacterCount } from '../../components/CharacterCount'
import { apiDelete, apiGet, apiPost, apiPut, invalidateApiCacheByPrefix } from '../../lib/apiClient'
import { getErrorMessage } from '../../lib/errorHandler'
import { useDialog } from '../../components/Dialog'
import { FormModal } from '../../components/Modal/FormModal'
import { useToast } from '../../components/Toast'
import { splitTagsInput } from '../../lib/contentUtils'
import { LocationTagInput } from '../../components/LocationTagInput'
import { useContentEditorNavigation } from '../../hooks/useContentEditorNavigation'
import { Button, LoadErrorState, TagInput } from '@/src/components/ui'
import { useTagSuggestions } from '../../hooks/useTagSuggestions'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { hasFormChanges } from '../../utils/formDirty'
import { useI18n } from '../../lib/i18n'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { validateMaxLength, validateRequiredText, validateTags } from '../../lib/clientValidation'
import {
  BookDangerZone,
  BookEditorActions,
  BookEditorSection,
  BookEditorShell,
  BookFormField,
  bookCompactInputClass,
  bookInputClass,
} from '../../components/BookEditor'
import type { PostItem, SectionItem } from '../../types/entities'
const PostEditor = () => {
  const { t } = useI18n()
  const { postId } = useParams()
  const isEditing = Boolean(postId)
  const missingPostMessage = t('forum.postNotExistOrNoPermission')
  const editPermissionMessage = t('forum.noEditPermission')
  const { user, isAdmin, isBanned, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const musicDocIdParam = searchParams.get('musicDocId')
  const [sections, setSections] = useState<SectionItem[]>([])
  const [formData, setFormData] = useState({
    title: '',
    section: '',
    content: '',
    tags: '',
    locationName: null as string | null,
    locationCode: null as string | null,
  })
  const [savingMode, setSavingMode] = useState<'draft' | 'pending' | null>(null)
  const [loadingPost, setLoadingPost] = useState(Boolean(postId))
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [editablePostAuthorUid, setEditablePostAuthorUid] = useState<string | null>(null)
  const [editablePostId, setEditablePostId] = useState<string | null>(null)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const { closeEditor, navigateAfterSave } = useContentEditorNavigation()
  const dialog = useDialog()
  const { show } = useToast()
  const tagSuggestions = useTagSuggestions('post')

  // 基线在默认版块/内容或编辑帖回填落定后建立，避免加载期误判为已修改
  const [baseline, setBaseline] = useState<typeof formData | null>(null)
  const isDirty = useMemo(
    () => baseline !== null && hasFormChanges(formData, baseline),
    [formData, baseline]
  )
  const guard = useUnsavedChangesGuard(isDirty)

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const data = await apiGet<{ sections: SectionItem[] }>('/api/sections')
        const fetchedSections = data.sections || []
        setSections(fetchedSections)

        let defaultSection = fetchedSections[0]?.id || ''

        if (musicDocIdParam) {
          defaultSection = 'music'
        }

        setFormData((prev) => ({
          ...prev,
          section: prev.section || defaultSection,
        }))
        setBaseline(
          (prev) =>
            prev ?? {
              title: '',
              section: defaultSection,
              content: '',
              tags: '',
              locationName: null,
              locationCode: null,
            }
        )
      } catch (error) {
        console.error('Error fetching sections:', error)
      }
    }

    fetchSections()
  }, [musicDocIdParam])

  const loadEditingPost = useCallback(async () => {
    if (!postId || authLoading) return

    setLoadingPost(true)
    setLoadError(null)
    try {
      const data = await apiGet<{ post: PostItem }>(`/api/posts/${postId}`)
      if (!data.post) {
        throw new Error(missingPostMessage)
      }
      if (data.post.authorUid !== user?.uid && !isAdmin) {
        throw new Error(editPermissionMessage)
      }

      setEditablePostAuthorUid(data.post.authorUid)
      setEditablePostId(data.post.id)
      const nextFormData = {
        title: data.post.title,
        section: data.post.section,
        content: data.post.content,
        tags: (data.post.tags || []).join(', '),
        locationName: data.post.locationDetail || data.post.locationName || null,
        locationCode: data.post.locationCode || null,
      }
      setFormData(nextFormData)
      setBaseline(nextFormData)
    } catch (error) {
      console.error('Error loading editable post:', error)
      setLoadError(error)
    } finally {
      setLoadingPost(false)
    }
  }, [authLoading, editPermissionMessage, isAdmin, missingPostMessage, postId, user?.uid])

  useEffect(() => {
    if (isEditing) void loadEditingPost()
  }, [isEditing, loadEditingPost])

  useEffect(() => {
    setDeleteReason('')
  }, [postId, editablePostAuthorUid])

  const handleSubmit = async (status: 'draft' | 'pending') => {
    if (
      !user ||
      loadingPost ||
      loadError ||
      baseline === null ||
      (isEditing && editablePostId === null)
    ) {
      return
    }
    if (isBanned) {
      show(t('forum.bannedCannotPost'), { variant: 'error' })
      return
    }
    const title = formData.title.trim()
    const section = formData.section.trim()
    const content = formData.content.trim()
    const tags = splitTagsInput(formData.tags)
    const validationError =
      validateRequiredText(title, 'title', '标题') ||
      validateRequiredText(section, 'section', '版块') ||
      validateRequiredText(content, 'content', '内容') ||
      validateMaxLength(section, 'section', '版块', CONTENT_LIMITS.post.section) ||
      validateMaxLength(content, 'content', '内容', CONTENT_LIMITS.post.content) ||
      validateTags(tags, 'tags', '标签', CONTENT_LIMITS.post.tags, CONTENT_LIMITS.post.tag) ||
      validateMaxLength(
        formData.locationCode,
        'locationCode',
        '地点编码',
        CONTENT_LIMITS.post.locationCode
      ) ||
      validateMaxLength(
        formData.locationName,
        'locationDetail',
        '地点详情',
        CONTENT_LIMITS.post.locationDetail
      )
    if (validationError) {
      show(validationError.message, { variant: 'error' })
      return
    }

    setSavingMode(status)
    let redirectTarget: string | null = null

    try {
      const payload: Record<string, unknown> = {
        title,
        section,
        content,
        tags,
        locationCode: formData.locationCode?.trim() || null,
        locationDetail: formData.locationName?.trim() || null,
        status,
      }

      if (!isEditing && musicDocIdParam) {
        payload.musicDocId = musicDocIdParam
      }

      const data =
        isEditing && editablePostId
          ? await apiPut<{ post: PostItem & { slug: string } }>(
              `/api/posts/${editablePostId}`,
              payload
            )
          : await apiPost<{ post: PostItem & { slug: string } }>('/api/posts', payload)

      const savedPost = data.post

      if (savedPost.status === 'published') {
        show(isEditing ? t('forum.postUpdated') : t('forum.postPublished'))
      } else if (savedPost.status === 'pending') {
        show(t('forum.reviewSubmitted'))
      } else if (savedPost.status === 'draft') {
        show(t('forum.draftSaved'))
      }

      invalidateApiCacheByPrefix('/api/posts')
      if (!isEditing && savedPost.status === 'draft') {
        redirectTarget = `/forum/${savedPost.slug}/edit`
      } else if (isEditing || savedPost.status === 'pending' || savedPost.status === 'published') {
        redirectTarget = `/forum/${savedPost.slug}`
      }
    } catch (error) {
      console.error('Error saving post:', error)
      show(
        getErrorMessage(
          error,
          status === 'draft'
            ? t('forum.saveDraftFailed')
            : t(isAdmin ? 'forum.publishFailed' : 'forum.submitReviewFailed')
        ),
        {
          variant: 'error',
        }
      )
    } finally {
      setSavingMode(null)
    }

    if (redirectTarget) {
      guard.markClean()
      navigateAfterSave(redirectTarget)
    }
  }
  const handleDelete = async () => {
    if (!postId || !isEditing || !editablePostAuthorUid || !editablePostId || isDeleting) return
    if (!user || (editablePostAuthorUid !== user.uid && !isAdmin)) return

    const isSelfDelete = editablePostAuthorUid === user.uid
    const reason = isSelfDelete ? null : deleteReason.trim()
    if (!isSelfDelete) {
      const reasonError = validateMaxLength(
        reason,
        'reason',
        '删除理由',
        CONTENT_LIMITS.post.reviewNote
      )
      if (reasonError) {
        show(reasonError.message, { variant: 'error' })
        return
      }
    }
    if (!isSelfDelete && !reason) {
      show('删除他人帖子必须填写删除理由', { variant: 'error' })
      return
    }

    const confirmed = await dialog.confirm({
      title: '删除帖子',
      message: t('forum.deletePostConfirm', { title: formData.title || postId }),
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      await apiDelete(`/api/posts/${editablePostId}`, reason ? { reason } : {})
      invalidateApiCacheByPrefix('/api/posts')
      show(t('forum.postDeleted'), { variant: 'success' })
      guard.markClean()
      navigateAfterSave('/forum')
    } catch (error) {
      show(getErrorMessage(error, t('forum.deletePostFailed')), {
        variant: 'error',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const submitButtonText =
    savingMode === 'pending'
      ? t(isAdmin ? 'forum.publishing' : 'forum.submitting')
      : t(isAdmin ? 'forum.publishPost' : 'forum.submitReview')
  const canManageEditablePost = Boolean(
    isEditing && editablePostAuthorUid && user && (editablePostAuthorUid === user.uid || isAdmin)
  )

  return (
    <FormModal
      open
      onClose={() => {
        if (savingMode || isDeleting) return
        closeEditor()
      }}
      title={isEditing ? t('forum.editPost') : t('forum.createPost')}
      subtitle={
        isEditing
          ? '调整帖子内容、板块和地点信息，保存后回到帖子详情。'
          : '写下你的讨论内容，可先保存草稿，也可以直接提交审核。'
      }
      loading={Boolean(savingMode) || isDeleting}
      maxWidth="max-w-6xl"
    >
      {loadingPost ? (
        <div role="status" className="py-12 text-center text-text-muted">
          正在加载帖子...
        </div>
      ) : loadError ? (
        <LoadErrorState error={loadError} onRetry={() => void loadEditingPost()} />
      ) : (
        <BookEditorShell embedded>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit('pending')
            }}
            className="space-y-7"
          >
            <BookEditorSection title="帖子信息" className="border-t-0 pt-0">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <BookFormField
                  label={t('forum.titleLabel')}
                  required
                  counter={
                    <CharacterCount
                      current={formData.title.length}
                      max={CONTENT_LIMITS.post.title}
                    />
                  }
                >
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    maxLength={CONTENT_LIMITS.post.title}
                    placeholder={t('forum.titlePlaceholder')}
                    className={bookInputClass}
                  />
                </BookFormField>

                <BookFormField label={t('forum.sectionLabel')} required>
                  <select
                    value={formData.section}
                    onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                    className={`${bookInputClass} appearance-none`}
                  >
                    {sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </select>
                </BookFormField>
              </div>
            </BookEditorSection>

            <BookEditorSection title="附加信息">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <BookFormField
                  label={t('forum.tagsLabel')}
                  htmlFor="forum-tags"
                  counter={
                    <CharacterCount
                      current={formData.tags.length}
                      max={CONTENT_LIMITS.post.tag * CONTENT_LIMITS.post.tags}
                    />
                  }
                >
                  <TagInput
                    id="forum-tags"
                    value={splitTagsInput(formData.tags)}
                    onChange={(tags) => setFormData({ ...formData, tags: tags.join(', ') })}
                    suggestions={tagSuggestions}
                    placeholder="输入标签后按回车添加"
                  />
                </BookFormField>

                <BookFormField label={t('forum.locationLabel')}>
                  <LocationTagInput
                    value={formData.locationName}
                    locationCode={formData.locationCode}
                    onChange={(name, code) => {
                      setFormData({
                        ...formData,
                        locationName: name,
                        locationCode: code,
                      })
                    }}
                    onClear={() => {
                      setFormData({
                        ...formData,
                        locationName: null,
                        locationCode: null,
                      })
                    }}
                    variant="book"
                  />
                </BookFormField>
              </div>
            </BookEditorSection>

            <BookEditorSection title="正文">
              <BookFormField
                label={t('forum.contentLabel')}
                required
                counter={
                  <CharacterCount
                    current={formData.content.length}
                    max={CONTENT_LIMITS.post.content}
                  />
                }
              >
                <MarkdownEditor
                  value={formData.content}
                  onChange={(content) =>
                    setFormData((prev) => (prev.content === content ? prev : { ...prev, content }))
                  }
                  height="400px"
                  placeholder={t('forum.contentPlaceholder')}
                  maxLength={CONTENT_LIMITS.post.content}
                  variant="book"
                />
              </BookFormField>
            </BookEditorSection>

            <BookEditorActions
              leading={
                canManageEditablePost ? (
                  <Button
                    variant="secondary"
                    className="mr-auto"
                    type="button"
                    onClick={() => setShowAdvancedOptions((value) => !value)}
                    aria-expanded={showAdvancedOptions}
                    aria-controls="post-advanced-options"
                  >
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                    />{' '}
                    {t('forum.advancedOptions')}
                  </Button>
                ) : null
              }
            >
              <Button
                variant="secondary"
                type="button"
                onClick={() => handleSubmit('draft')}
                disabled={Boolean(savingMode)}
              >
                <Save size={16} />{' '}
                {savingMode === 'draft' ? t('forum.saving') : t('forum.saveDraft')}
              </Button>
              <Button variant="primary" type="submit" disabled={Boolean(savingMode)}>
                <Send size={16} /> {submitButtonText}
              </Button>
            </BookEditorActions>
          </form>

          {canManageEditablePost && showAdvancedOptions && (
            <BookDangerZone
              id="post-advanced-options"
              title={t('forum.deleteZoneTitle')}
              description={t('forum.deleteZoneDescription')}
            >
              {editablePostAuthorUid !== user?.uid && (
                <label
                  htmlFor="post-delete-reason"
                  className="mt-4 block text-sm font-medium text-text-secondary"
                >
                  {t('forum.deleteReasonLabel')}
                  <span className="ml-1 theme-text-error" aria-hidden="true">
                    *
                  </span>
                  <textarea
                    id="post-delete-reason"
                    value={deleteReason}
                    onChange={(event) => setDeleteReason(event.target.value)}
                    maxLength={CONTENT_LIMITS.post.reviewNote}
                    rows={3}
                    className={`${bookCompactInputClass} mt-2 focus:border-danger`}
                  />
                </label>
              )}
              <Button
                variant="danger"
                className="mt-4"
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 size={16} />
                {isDeleting ? t('forum.deletingPost') : t('forum.deletePost')}
              </Button>
            </BookDangerZone>
          )}
        </BookEditorShell>
      )}
    </FormModal>
  )
}

export default PostEditor
