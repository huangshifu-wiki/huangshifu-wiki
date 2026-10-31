import React, { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
import {
  Clock,
  ArrowLeft,
  Heart,
  Save,
  Share2,
  History,
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
import { getErrorMessage } from '../../lib/errorHandler'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import {
  getDetailFallbackSeo,
  SEO_SITE_NAME,
  summarizeSeoText,
  toAbsoluteSeoUrl,
  useSeo,
} from '../../lib/seo'
import type { SeoMetadata } from '../../lib/seo'
import { buildMiniRelationGraphData } from '../../lib/wikiRelationGraph'
import { getWikiRelationDisplayTitle } from '../../lib/wikiRelationDisplay'
import { getWikiSubmitButtonText } from '../../lib/wikiWriteText'
import WikiMarkdown from './WikiMarkdown'
import { SmartBackLink } from '../../components/SmartBackLink'
import RelationGraph from '../../components/wiki/RelationGraph'
import type { RelationGraphData } from '../../components/wiki/RelationGraph'
import { RELATION_TYPE_LABELS } from '../../components/wiki/types'
import type { WikiItem, WikiRelationResolved, WikiRelationDisplayItem } from './types'
import { LinkButton, Button, LoadErrorState, Skeleton } from '@/src/components/ui'
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
  const location = useLocation()
  const [page, setPage] = useState<WikiItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
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

  // SEO 元数据：加载中/失败不可索引，成功且已发布才 index
  const wikiPagePath = `/wiki/${slug}`
  const wikiPageDescription = page
    ? summarizeSeoText(page.content, `${page.title}，黄诗扶 Wiki 百科资料。`)
    : ''
  const wikiSeoMetadata: SeoMetadata = page
    ? {
        title: `${page.title}｜${SEO_SITE_NAME}`,
        description: wikiPageDescription,
        canonicalPath: wikiPagePath,
        robots: page.status && page.status !== 'published' ? 'noindex,follow' : 'index,follow',
        ogType: 'article',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: page.title,
          description: wikiPageDescription,
          mainEntityOfPage: toAbsoluteSeoUrl(wikiPagePath),
          ...(page.createdAt ? { datePublished: page.createdAt } : {}),
          ...(page.updatedAt ? { dateModified: page.updatedAt } : {}),
        },
      }
    : loading
      ? getDetailFallbackSeo({ canonicalPath: wikiPagePath, title: SEO_SITE_NAME })
      : getDetailFallbackSeo({
          canonicalPath: wikiPagePath,
          title: `百科页面不存在｜${SEO_SITE_NAME}`,
          description: '当前百科页面不存在或尚未发布。',
        })
  useSeo(wikiSeoMetadata)

  const fetchPage = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiGet<{
        page: WikiItem
        backlinks: WikiItem[]
        relations: WikiRelationResolved[]
        relationGraph: RelationGraphData
      }>(`/api/wiki/${slug}`, undefined, { staleTime: 0, swr: false })
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
    } catch (error) {
      console.error('Error fetching page:', error)
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchPage()
  }, [slug, user?.uid])

  if (loading && !page)
    return (
      <div className="mobile-page-shell antique-detail" role="status" aria-label="加载中">
        <div className="mobile-page-container">
          <Skeleton className="mb-6 h-4 w-24" />
          <div className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
            <Skeleton className="mb-4 h-10 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-5" style={{ width: `${94 - item * 10}%` }} />
            ))}
          </div>
        </div>
      </div>
    )

  if (!page)
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <SmartBackLink
            fallbackTo="/wiki"
            fallbackLabel={t('wiki.backToList')}
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          />
          {loadError ? (
            <LoadErrorState error={loadError} className="mt-8" onRetry={() => void fetchPage()} />
          ) : (
            <div className="mt-8 border-y border-[var(--book-ink-line)] py-16 text-center text-[0.9375rem] tracking-[0.08em] text-text-muted">
              {t('wiki.notFound')}
            </div>
          )}
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
      show(getErrorMessage(error, t('wiki.reviewSubmitFailed')), { variant: 'error' })
    } finally {
      setSubmittingReview(false)
    }
  }

  return (
    <div
      className="mobile-page-shell antique-detail text-[var(--color-text-antique)]"
      aria-busy={loading}
    >
      <div className="mobile-page-container wiki-detail-page">
        <SmartBackLink
          fallbackTo="/wiki"
          fallbackLabel={t('wiki.backToList')}
          icon={<ArrowLeft size={18} />}
          className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        />
        {loadError && (
          <LoadErrorState error={loadError} className="mb-6" onRetry={() => void fetchPage()} />
        )}

        <header className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
          <div className="mobile-page-titlebar items-start">
            <div className="min-w-0">
              <h1 className="mobile-page-title">{page.title}</h1>
            </div>
            <div className="mobile-action-row mt-1 justify-start sm:justify-end">
              {canEditPage && canEditPageCategory && (
                <LinkButton
                  variant="secondary"
                  to={`/wiki/${slug}/edit`}
                  state={{ editorBackground: location }}
                  data-pressable
                >
                  <Edit3 size={14} /> {t('wiki.edit')}
                </LinkButton>
              )}
              {canEditPage && canEditPageCategory && (
                <LinkButton variant="secondary" to={`/wiki/${slug}/history`} data-pressable>
                  <History size={14} /> {t('wiki.history')}
                </LinkButton>
              )}
              {user && !isBanned && canEditPageCategory && (
                <LinkButton variant="secondary" to={`/wiki/${slug}/branches`} data-pressable>
                  <GitBranch size={14} /> {t('wiki.branch')}
                </LinkButton>
              )}
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
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={handleSubmitReview}
                disabled={submittingReview}
              >
                {submitButtonText}
              </Button>
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
                <Button
                  variant={page.likedByMe ? 'danger' : 'secondary'}
                  aria-pressed={page.likedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleLike}
                  disabled={!user || liking}
                  title={page.likedByMe ? t('wiki.unlike') : t('wiki.like')}
                >
                  <Heart size={15} /> {page.likesCount || 0}
                </Button>
                <Button
                  variant={page.dislikedByMe ? 'warning' : 'secondary'}
                  aria-pressed={page.dislikedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleDislike}
                  disabled={!user || disliking}
                  title={page.dislikedByMe ? t('wiki.undislike') : t('wiki.dislike')}
                >
                  <ThumbsDown size={15} /> {page.dislikesCount || 0}
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant={page.favoritedByMe ? 'primary' : 'secondary'}
                  aria-pressed={page.favoritedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleFavorite}
                  disabled={!user || favoriting}
                  title={page.favoritedByMe ? t('wiki.unfavorite') : t('wiki.favoritePage')}
                >
                  <Save size={15} /> {page.favoritedByMe ? t('wiki.favorited') : t('wiki.favorite')}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  type="button"
                  onClick={handleCopyPageLink}
                  title={t('wiki.share')}
                >
                  <Share2 size={15} /> {t('wiki.share')}
                </Button>
              </div>
              {isAdmin && (
                <Button
                  variant={page.isPinned ? 'primary' : 'secondary'}
                  aria-pressed={page.isPinned}
                  className="mt-2 w-full"
                  type="button"
                  onClick={togglePin}
                  disabled={pinning}
                >
                  <Pin size={15} /> {page.isPinned ? t('wiki.pinned') : t('wiki.pin')}
                </Button>
              )}
              {canShowRelationGraph && (
                <Button
                  variant={showGraph ? 'primary' : 'secondary'}
                  aria-pressed={showGraph}
                  className="mt-2 w-full"
                  type="button"
                  onClick={() => setShowGraph(!showGraph)}
                >
                  <Network size={15} />{' '}
                  {showGraph ? t('wiki.collapseGraph') : t('wiki.expandGraph')}
                </Button>
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
                    <Link
                      key={tag}
                      to={`/wiki?tag=${encodeURIComponent(tag)}`}
                      className="cursor-pointer rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-1 text-xs text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold"
                    >
                      {tag}
                    </Link>
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
