import React, { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  Book,
  ChevronRight,
  Clock,
  ArrowLeft,
  Heart,
  Save,
  Share2,
  History,
  Link2,
  GitBranch,
  Network,
  MapPin,
  ThumbsDown,
  Pin,
  Edit3,
} from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useI18n } from '../../lib/i18n'
import { clsx } from 'clsx'
import { useToast } from '../../components/Toast'
import { useToggleInteraction } from '../../hooks/useToggleInteraction'
import { copyToClipboard, toAbsoluteInternalUrl } from '../../lib/copyLink'
import { apiGet, apiPost } from '../../lib/apiClient'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import { buildMiniRelationGraphData } from '../../lib/wikiRelationGraph'
import { getWikiRelationDisplayTitle } from '../../lib/wikiRelationDisplay'
import { getWikiSubmitButtonText } from '../../lib/wikiWriteText'
import WikiMarkdown from './WikiMarkdown'
import RelationGraph from '../../components/wiki/RelationGraph'
import type { RelationGraphData } from '../../components/wiki/RelationGraph'
import { RELATION_TYPE_LABELS } from '../../components/wiki/types'
import type { WikiItem, WikiRelationResolved, WikiRelationDisplayItem } from './types'
import { useWikiCategories } from '../../hooks/useWikiCategories'

const hasExpandableRelationGraph = (graph: RelationGraphData | null, currentSlug?: string) => {
  if (!graph || graph.edges.length === 0) return false
  return graph.nodes.some((node) => node.slug !== currentSlug)
}

const buildDirectRelationGraph = (
  page: WikiItem,
  relations: WikiRelationDisplayItem[]
): RelationGraphData | null => {
  if (relations.length === 0) return null

  const metadata = new Map(
    relations.map((relation) => [
      relation.targetSlug,
      {
        slug: relation.targetSlug,
        title: getWikiRelationDisplayTitle(relation),
        category: relation.targetCategory || '',
      },
    ])
  )

  return buildMiniRelationGraphData({
    relations,
    metadata,
    currentSlug: page.slug,
    currentTitle: page.title,
  })
}

const WikiPageView = () => {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [page, setPage] = useState<WikiItem | null>(null)
  const [loading, setLoading] = useState(true)
  const { user, isAdmin, isBanned } = useAuth()
  const { t } = useI18n()
  const { show } = useToast()
  const { getCategoryLabel, canEditCategory } = useWikiCategories()
  const [backlinks, setBacklinks] = useState<WikiItem[]>([])
  const [submittingReview, setSubmittingReview] = useState(false)
  const {
    toggleLike,
    toggleDislike,
    toggleFavorite,
    togglePin,
    liking,
    disliking,
    favoriting,
    pinning,
  } = useToggleInteraction({
    entity: page,
    setEntity: setPage,
    user,
    isBanned,
    isAdmin,
    apiBase: '/api/wiki',
    entityId: slug,
    toast: { show },
    t,
  })
  const [relationGraph, setRelationGraph] = useState<RelationGraphData | null>(null)
  const [resolvedRelations, setResolvedRelations] = useState<WikiRelationResolved[]>([])
  const [showGraph, setShowGraph] = useState(false)

  useEffect(() => {
    const fetchPage = async () => {
      setLoading(true)
      try {
        const data = await apiGet<{
          page: WikiItem
          backlinks: WikiItem[]
          relations: WikiRelationResolved[]
          relationGraph: RelationGraphData
        }>(`/api/wiki/${slug}`)
        setPage(data.page)
        setBacklinks(data.backlinks || [])
        setResolvedRelations((data.relations || []).filter((relation) => !relation.inferred))
        const nextRelationGraph = data.relationGraph || null
        setRelationGraph(nextRelationGraph)
        if (!hasExpandableRelationGraph(nextRelationGraph, slug)) {
          setShowGraph(false)
        }
        if (!data.page.content) {
          console.warn('[WikiPageView] API returned empty content:', {
            slug,
            hasContent: !!data.page.content,
            contentType: typeof data.page.content,
            contentLength: data.page.content?.length,
            pageKeys: Object.keys(data.page),
          })
        }
      } catch (e) {
        console.error('Error fetching page:', e)
      }
      setLoading(false)
    }
    fetchPage()
  }, [slug])

  if (loading)
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)] antique-page">
        {t('wiki.loading')}
      </div>
    )
  if (!page)
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)] antique-page">
        {t('wiki.notFound')}
      </div>
    )

  const isOwner = Boolean(user && page?.lastEditorUid === user.uid)
  const canEditPage = Boolean(!isBanned && (isOwner || isAdmin))
  const canEditPageCategory = canEditCategory(page.category, isAdmin)
  const displayedRelations: WikiRelationDisplayItem[] =
    resolvedRelations.length > 0 ? resolvedRelations : page.relations || []
  const directRelationGraph = buildDirectRelationGraph(page, displayedRelations)
  const expandableRelationGraph = hasExpandableRelationGraph(relationGraph, slug)
    ? relationGraph
    : directRelationGraph
  const canShowRelationGraph = hasExpandableRelationGraph(expandableRelationGraph, slug)
  const canSubmitReview = Boolean(
    !isBanned &&
    canEditPage &&
    canEditPageCategory &&
    page &&
    (page.status === 'draft' || page.status === 'rejected')
  )
  const submitButtonText = getWikiSubmitButtonText(t, isAdmin, submittingReview)

  const handleCopyPageLink = async () => {
    if (!slug) return
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/wiki/${slug}`))
    if (copied) {
      show(t('wiki.linkCopied'))
      return
    }
    show(t('wiki.linkCopyFailed'), { variant: 'error' })
  }

  const handleSubmitReview = async () => {
    if (!slug || submittingReview) return
    if (!canEditPageCategory) {
      show('该分类仅管理员可编辑', { variant: 'error' })
      return
    }
    if (!canSubmitReview) return
    setSubmittingReview(true)
    try {
      const data = await apiPost<{ page: WikiItem }>(`/api/wiki/${slug}/submit`)
      setPage((prev) => (prev ? { ...prev, ...data.page } : prev))
      if (data.page.status === 'published') {
        show(t('wiki.pagePublished'))
      } else {
        show(t('wiki.reviewSubmitted'))
      }
    } catch (error) {
      console.error('Submit wiki review failed:', error)
      show(t('wiki.reviewSubmitFailed'), { variant: 'error' })
    } finally {
      setSubmittingReview(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-60px)] antique-detail">
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 wiki-detail-page">
        {/* Breadcrumb */}
        <Link
          to={'/wiki'}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
        >
          <ArrowLeft size={18} /> {t('wiki.backToList')}
        </Link>

        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
              {page.title}
            </h1>
            <div className="flex flex-wrap gap-2">
              {canEditPage && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/edit`}
                  className="px-4 py-2 text-[0.9375rem] rounded theme-button-primary transition-all flex items-center gap-2"
                >
                  <Edit3 size={16} /> {t('wiki.edit')}
                </Link>
              )}
              {canEditPage && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/history`}
                  className="px-4 py-2 text-[0.9375rem] rounded theme-button-secondary transition-all flex items-center gap-2"
                >
                  <History size={16} /> {t('wiki.history')}
                </Link>
              )}
              {user && !isBanned && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/branches`}
                  className="px-4 py-2 text-[0.9375rem] rounded theme-button-secondary transition-all flex items-center gap-2"
                >
                  <GitBranch size={16} /> {t('wiki.branch')}
                </Link>
              )}
              <button
                onClick={handleCopyPageLink}
                className="px-4 py-2 text-[0.9375rem] rounded theme-button-secondary transition-all flex items-center gap-2"
                title={t('wiki.copyInternalLink')}
              >
                <Link2 size={16} /> {t('wiki.copy')}
              </button>
            </div>
          </div>
        </header>

        {/* Filter bar style info bar */}
        <div className="flex items-end justify-between border-b border-border mb-5">
          <div className="flex gap-5 items-center">
            <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]">
              {getCategoryLabel(page.category)}
            </span>
            {canSubmitReview && (
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="px-3 py-1 text-[0.8125rem] rounded theme-status-warning hover:opacity-90 disabled:opacity-50 transition-all self-center mb-1"
              >
                {submitButtonText}
              </button>
            )}
            {page.status === 'rejected' && page.reviewNote ? (
              <span className="text-[0.8125rem] theme-text-error self-center mb-1">
                {t('wiki.rejectedPrefix')}
                {page.reviewNote}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatDate(page.updatedAt, 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
          {/* Main Content */}
          <div>
            {/* Markdown Content */}
            <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
              <WikiMarkdown content={page.content} />
            </div>

            {/* Relation Graph */}
            {showGraph && canShowRelationGraph && expandableRelationGraph && (
              <div className="mt-12 pt-8 border-t border-border">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase flex items-center gap-2">
                    <Network size={14} className="text-brand-gold" /> {t('wiki.relationGraph')}
                  </h4>
                  <span className="text-xs text-text-muted">{t('wiki.graphClickHint')}</span>
                </div>
                <RelationGraph
                  graph={expandableRelationGraph}
                  currentSlug={slug || ''}
                  onNodeClick={(nodeSlug) => navigate(`/wiki/${nodeSlug}`)}
                />
              </div>
            )}

            {/* Relations List */}
            {displayedRelations.length > 0 && !showGraph && (
              <div className="mt-12 pt-8 border-t border-border">
                <h4 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-5 flex items-center gap-2">
                  <Book size={14} className="text-brand-gold" /> {t('wiki.relatedPages')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedRelations.map((relation, index: number) => (
                    <Link
                      key={`${relation.targetSlug}-${index}`}
                      to={`/wiki/${relation.targetSlug}`}
                      className="p-3 bg-surface border border-border rounded hover:border-brand-gold transition-all group"
                    >
                      <p className="text-xs text-brand-gold font-medium uppercase tracking-wider mb-1">
                        {relation.typeLabel || RELATION_TYPE_LABELS[relation.type] || relation.type}
                      </p>
                      <p className="font-medium text-text-primary group-hover:text-brand-gold group-hover:underline underline-offset-4 transition-colors">
                        {getWikiRelationDisplayTitle(relation)}
                      </p>
                      {relation.bidirectional && (
                        <span className="inline-block mt-1 text-[10px] text-text-muted">
                          {t('wiki.bidirectionalRelation')}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Backlinks */}
            {backlinks.length > 0 && (
              <div className="mt-12 pt-8 border-t border-border">
                <h4 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-5 flex items-center gap-2">
                  <ChevronRight size={14} className="text-brand-gold" /> {t('wiki.backlinks')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {backlinks.map((link) => (
                    <Link
                      key={link.id}
                      to={`/wiki/${link.slug}`}
                      className="p-3 bg-surface border border-border rounded hover:border-brand-gold transition-all group"
                    >
                      <p className="font-medium text-text-primary group-hover:text-brand-gold group-hover:underline underline-offset-4 transition-colors">
                        {link.title}
                      </p>
                      <p className="text-xs text-text-muted mt-1 truncate">{link.slug}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20">
            {/* Actions */}
            <div className="py-5 border-b border-border">
              <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                {t('wiki.interaction')}
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={toggleLike}
                  disabled={!user || liking}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.likedByMe
                      ? 'theme-button-danger border border-transparent'
                      : 'bg-surface border theme-button-danger-outline text-text-secondary',
                    (!user || liking) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={page.likedByMe ? t('wiki.unlike') : t('wiki.like')}
                >
                  <Heart size={15} /> {page.likesCount || 0}
                </button>
                <button
                  onClick={toggleDislike}
                  disabled={!user || disliking}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.dislikedByMe
                      ? 'theme-button-warning border border-transparent'
                      : 'bg-surface border theme-button-warning-outline text-text-secondary',
                    (!user || disliking) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={page.dislikedByMe ? t('wiki.undislike') : t('wiki.dislike')}
                >
                  <ThumbsDown size={15} /> {page.dislikesCount || 0}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={toggleFavorite}
                  disabled={!user || favoriting}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.favoritedByMe
                      ? 'bg-[var(--color-theme-accent)] text-white border border-transparent'
                      : 'bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold',
                    (!user || favoriting) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={page.favoritedByMe ? t('wiki.unfavorite') : t('wiki.favoritePage')}
                >
                  <Save size={15} /> {page.favoritedByMe ? t('wiki.favorited') : t('wiki.favorite')}
                </button>
                <button
                  onClick={handleCopyPageLink}
                  className="flex-1 px-3 py-2 rounded text-sm font-medium bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold transition-all flex items-center justify-center gap-1.5"
                  title={t('wiki.share')}
                >
                  <Share2 size={15} /> {t('wiki.share')}
                </button>
              </div>
              {isAdmin && (
                <button
                  onClick={togglePin}
                  disabled={pinning}
                  className={clsx(
                    'w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.isPinned
                      ? 'bg-[var(--color-theme-accent)] text-white border border-transparent'
                      : 'bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold',
                    pinning && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <Pin size={15} /> {page.isPinned ? t('wiki.pinned') : t('wiki.pin')}
                </button>
              )}
              {canShowRelationGraph && (
                <button
                  onClick={() => setShowGraph(!showGraph)}
                  className={clsx(
                    'w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    showGraph
                      ? 'bg-[var(--color-theme-accent)] text-white border border-transparent'
                      : 'bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold'
                  )}
                >
                  <Network size={15} />{' '}
                  {showGraph ? t('wiki.collapseGraph') : t('wiki.expandGraph')}
                </button>
              )}
            </div>

            {/* Status */}
            <div className="py-5 border-b border-border">
              <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                {t('wiki.status')}
              </h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.reviewStatus')}</span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
                      getStatusClassName(page.status)
                    )}
                  >
                    {getStatusText(page.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.editor')}</span>
                  <span className="text-text-primary font-medium">
                    {page.lastEditorName || t('wiki.anonymous')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.createdAt')}</span>
                  <span className="text-text-primary font-medium">
                    {formatDate(page.createdAt, 'yyyy-MM-dd')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.updatedAt')}</span>
                  <span className="text-text-primary font-medium">
                    {formatDate(page.updatedAt, 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
              </div>
            </div>

            {/* Tags */}
            {page.tags && page.tags.length > 0 && (
              <div className="py-5 border-b border-border">
                <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                  {t('wiki.tags')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {page.tags.map((tag: string) => (
                    <span
                      key={tag}
                      onClick={() => navigate(`/wiki?tag=${encodeURIComponent(tag)}`)}
                      className="cursor-pointer px-2 py-1 bg-surface border border-border text-text-secondary text-xs rounded hover:text-brand-gold hover:border-brand-gold transition-all"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Location */}
            {(page.locationDetail || page.locationName) && (
              <div className="py-5">
                <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                  {t('wiki.location')}
                </h3>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <MapPin size={14} className="text-brand-gold" />
                  <span>{page.locationDetail || page.locationName}</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

export default WikiPageView
