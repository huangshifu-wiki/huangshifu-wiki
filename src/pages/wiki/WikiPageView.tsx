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

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[0.1em] text-text-primary">
    <span className="inline-block h-4 w-[3px] rounded-[1px] bg-brand-gold opacity-60" />
    {children}
  </h2>
)

const SidebarHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-4 text-center text-[0.8125rem] tracking-[0.14em] text-text-muted uppercase">
    {children}
  </h3>
)

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
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <div className="mb-6 h-4 w-24 animate-pulse rounded bg-surface-alt" />
          <div className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
            <div className="mb-4 h-10 w-2/3 animate-pulse rounded bg-surface-alt" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-alt" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className="h-5 animate-pulse rounded bg-surface-alt"
                style={{ width: `${94 - item * 10}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  if (!page)
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <Link
            to="/wiki"
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          >
            <ArrowLeft size={16} /> {t('wiki.backToList')}
          </Link>
          <div className="mt-8 border-y border-[var(--book-ink-line)] py-16 text-center text-[0.9375rem] tracking-[0.08em] text-text-muted">
            {t('wiki.notFound')}
          </div>
        </div>
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
    <div className="mobile-page-shell antique-detail text-[var(--color-text-antique)]">
      <div className="mobile-page-container wiki-detail-page">
        <Link
          to={'/wiki'}
          className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={18} /> {t('wiki.backToList')}
        </Link>

        <header className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
          <div className="mobile-page-titlebar items-start">
            <div className="min-w-0">
              <h1 className="mobile-page-title">{page.title}</h1>
            </div>
            <div className="mobile-action-row mt-1 justify-start sm:justify-end">
              {canEditPage && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/edit`}
                  data-pressable
                  className="inline-flex items-center gap-2 rounded border border-[rgba(138,109,47,0.25)] px-5 py-2 text-[0.875rem] text-brand-gold transition-all duration-300 hover:border-brand-gold hover:bg-brand-gold hover:text-white hover:shadow-[0_0_18px_rgba(138,109,47,0.15)]"
                >
                  <Edit3 size={14} /> {t('wiki.edit')}
                </Link>
              )}
              {canEditPage && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/history`}
                  data-pressable
                  className="inline-flex items-center gap-2 rounded border border-[var(--book-ink-line)] px-4 py-2 text-[0.875rem] text-text-secondary transition-all duration-300 hover:border-brand-gold/50 hover:text-brand-gold"
                >
                  <History size={14} /> {t('wiki.history')}
                </Link>
              )}
              {user && !isBanned && canEditPageCategory && (
                <Link
                  to={`/wiki/${slug}/branches`}
                  data-pressable
                  className="inline-flex items-center gap-2 rounded border border-[var(--book-ink-line)] px-4 py-2 text-[0.875rem] text-text-secondary transition-all duration-300 hover:border-brand-gold/50 hover:text-brand-gold"
                >
                  <GitBranch size={14} /> {t('wiki.branch')}
                </Link>
              )}
              <button
                onClick={handleCopyPageLink}
                className="inline-flex items-center gap-2 rounded border border-[var(--book-ink-line)] px-4 py-2 text-[0.875rem] text-text-secondary transition-all duration-300 hover:border-brand-gold/50 hover:text-brand-gold"
                title={t('wiki.copyInternalLink')}
              >
                <Link2 size={14} /> {t('wiki.copy')}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8125rem] text-text-muted">
            <span className="rounded-sm px-2 py-0.5 text-xs theme-tag">
              {getCategoryLabel(page.category)}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatDate(page.updatedAt, 'yyyy-MM-dd HH:mm')}
            </span>
            {canSubmitReview && (
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="rounded border border-[var(--book-ink-line)] px-3 py-1 text-[0.8125rem] text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold disabled:opacity-50"
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
        </header>

        <div className="mobile-detail-grid">
          <div>
            <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
              <WikiMarkdown content={page.content} />
            </div>

            {showGraph && canShowRelationGraph && expandableRelationGraph && (
              <div className="mt-12 border-t border-[var(--book-ink-line)] pt-8">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <SectionHeading>{t('wiki.relationGraph')}</SectionHeading>
                  <span className="text-xs text-text-muted">{t('wiki.graphClickHint')}</span>
                </div>
                <RelationGraph
                  graph={expandableRelationGraph}
                  currentSlug={slug || ''}
                  onNodeClick={(nodeSlug) => navigate(`/wiki/${nodeSlug}`)}
                />
              </div>
            )}

            {displayedRelations.length > 0 && !showGraph && (
              <div className="mt-12 border-t border-[var(--book-ink-line)] pt-8">
                <div className="mb-5">
                  <SectionHeading>{t('wiki.relatedPages')}</SectionHeading>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {displayedRelations.map((relation, index: number) => (
                    <Link
                      key={`${relation.targetSlug}-${index}`}
                      to={`/wiki/${relation.targetSlug}`}
                      className="group min-w-0 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] p-3 transition-all hover:border-brand-gold/50 hover:shadow-[0_10px_30px_rgba(72,53,25,0.08)]"
                    >
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-brand-gold">
                        {relation.typeLabel || RELATION_TYPE_LABELS[relation.type] || relation.type}
                      </p>
                      <p className="text-wrap-anywhere line-clamp-2 font-medium text-text-primary transition-colors group-hover:text-brand-gold">
                        {getWikiRelationDisplayTitle(relation)}
                      </p>
                      {relation.bidirectional && (
                        <span className="mt-1 inline-block text-[10px] text-text-muted">
                          {t('wiki.bidirectionalRelation')}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {backlinks.length > 0 && (
              <div className="mt-12 border-t border-[var(--book-ink-line)] pt-8">
                <div className="mb-5">
                  <SectionHeading>{t('wiki.backlinks')}</SectionHeading>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {backlinks.map((link) => (
                    <Link
                      key={link.id}
                      to={`/wiki/${link.slug}`}
                      className="group min-w-0 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] p-3 transition-all hover:border-brand-gold/50 hover:shadow-[0_10px_30px_rgba(72,53,25,0.08)]"
                    >
                      <p className="text-wrap-anywhere line-clamp-2 font-medium text-text-primary transition-colors group-hover:text-brand-gold">
                        {link.title}
                      </p>
                      <p className="mt-1 truncate text-xs text-text-muted">{link.slug}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="mobile-detail-aside">
            <div className="py-5">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={toggleLike}
                  disabled={!user || liking}
                  className={clsx(
                    'flex-1 rounded border px-3 py-2 text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.likedByMe
                      ? 'border-[color-mix(in_srgb,var(--color-error)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_6%,transparent)] text-[var(--color-error)]'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
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
                    'flex-1 rounded border px-3 py-2 text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.dislikedByMe
                      ? 'border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] text-[var(--color-warning)]'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                    (!user || disliking) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={page.dislikedByMe ? t('wiki.undislike') : t('wiki.dislike')}
                >
                  <ThumbsDown size={15} /> {page.dislikesCount || 0}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={toggleFavorite}
                  disabled={!user || favoriting}
                  className={clsx(
                    'flex-1 rounded border px-3 py-2 text-sm font-medium transition-all flex items-center justify-center gap-1.5',
                    page.favoritedByMe
                      ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                    (!user || favoriting) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={page.favoritedByMe ? t('wiki.unfavorite') : t('wiki.favoritePage')}
                >
                  <Save size={15} /> {page.favoritedByMe ? t('wiki.favorited') : t('wiki.favorite')}
                </button>
                <button
                  onClick={handleCopyPageLink}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--book-ink-line)] px-3 py-2 text-sm font-medium text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold"
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
                    'mt-2 flex w-full items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                    page.isPinned
                      ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
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
                    'mt-2 flex w-full items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                    showGraph
                      ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold'
                  )}
                >
                  <Network size={15} />{' '}
                  {showGraph ? t('wiki.collapseGraph') : t('wiki.expandGraph')}
                </button>
              )}
            </div>

            <div className="border-t border-[var(--book-ink-line)] py-5">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.reviewStatus')}</span>
                  <span
                    className={clsx(
                      'rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      getStatusClassName(page.status)
                    )}
                  >
                    {getStatusText(page.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.editor')}</span>
                  <span className="text-text-primary">
                    {page.lastEditorName || t('wiki.anonymous')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.createdAt')}</span>
                  <span className="text-text-primary">
                    {formatDate(page.createdAt, 'yyyy-MM-dd')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('wiki.updatedAt')}</span>
                  <span className="text-text-primary">
                    {formatDate(page.updatedAt, 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
              </div>
            </div>

            {page.tags && page.tags.length > 0 && (
              <div className="border-t border-[var(--book-ink-line)] py-5">
                <SidebarHeading>{t('wiki.tags')}</SidebarHeading>
                <div className="flex flex-wrap gap-2">
                  {page.tags.map((tag: string) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => navigate(`/wiki?tag=${encodeURIComponent(tag)}`)}
                      className="cursor-pointer rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-1 text-xs text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(page.locationDetail || page.locationName) && (
              <div className="border-t border-[var(--book-ink-line)] py-5">
                <SidebarHeading>{t('wiki.location')}</SidebarHeading>
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
