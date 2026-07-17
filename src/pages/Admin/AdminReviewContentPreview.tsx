import { useState } from 'react'
import { Clock, MapPin, Tag, User as UserIcon } from '@/src/components/icons'
import { clsx } from 'clsx'
import { Lightbox } from '../../components/Lightbox'
import MarkdownRenderer from '../../components/MarkdownRenderer'
import { SmartImage } from '../../components/SmartImage'
import WikiMarkdown from '../wiki/WikiMarkdown'
import { formatDate, formatDateTime } from '../../lib/dateUtils'
import type { AdminReviewQueueMergedItem } from '../../types/api'
import { useWikiCategories } from '../../hooks/useWikiCategories'
import { Button } from '@/src/components/ui'

type AdminReviewContentPreviewProps = {
  item: AdminReviewQueueMergedItem
}

const formatDateValue = (value: string | undefined, pattern: string) =>
  value ? formatDate(value, pattern) : 'N/A'

const WikiCategoryLabel = ({ category }: { category?: string }) => {
  const { getCategoryLabel } = useWikiCategories()

  return <>{category ? getCategoryLabel(category) : '百科'}</>
}

const getContentLabel = (item: AdminReviewQueueMergedItem) => {
  if (item.reviewType === 'wiki') {
    return <WikiCategoryLabel category={item.category} />
  }

  if (item.reviewType === 'gallery') {
    return '图集'
  }

  return item.sectionName || item.section || '帖子'
}

const getAuthorLabel = (item: AdminReviewQueueMergedItem) => {
  if (item.reviewType === 'wiki') {
    return item.lastEditorName || item.lastEditorUid || '匿名'
  }

  return item.authorName || item.authorUid || '匿名'
}

const getReviewTypeLabel = (item: AdminReviewQueueMergedItem) => {
  if (item.reviewType === 'wiki') return '百科'
  if (item.reviewType === 'gallery') return '图集'
  return '帖子'
}

const renderTags = (tags: string[] | undefined) => {
  if (!tags?.length) return null

  return (
    <div className="py-5 border-b border-border">
      <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
        标签
      </h3>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-surface border border-border text-text-secondary text-xs rounded"
          >
            <Tag size={11} />
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

const renderLocation = (item: AdminReviewQueueMergedItem, border = false) => {
  if (!item.locationDetail && !item.locationName) return null

  return (
    <div className={clsx('py-5', border && 'border-b border-border')}>
      <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
        地点
      </h3>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <MapPin size={14} className="text-brand-gold" />
        <span>{item.locationDetail || item.locationName}</span>
      </div>
    </div>
  )
}

const renderSidebar = (item: AdminReviewQueueMergedItem) => (
  <aside className="lg:sticky lg:top-20">
    <div className="py-5 border-b border-border">
      <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
        信息
      </h3>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-text-muted">{item.reviewType === 'wiki' ? '编辑者' : '作者'}</span>
          <span className="text-text-primary font-medium text-right">{getAuthorLabel(item)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">创建</span>
          <span className="text-text-primary font-medium">
            {formatDateValue(item.createdAt, 'yyyy-MM-dd')}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">更新</span>
          <span className="text-text-primary font-medium">
            {formatDateValue(item.updatedAt, 'yyyy-MM-dd HH:mm')}
          </span>
        </div>
      </div>
    </div>

    {renderTags(item.tags)}
    {renderLocation(item)}
  </aside>
)

const renderArticlePreview = (item: AdminReviewQueueMergedItem) => (
  <>
    <header className="mb-7">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
          {item.title || item.slug || item.id}
        </h1>
        <span className="px-3 py-1 rounded bg-surface-alt text-brand-gold text-xs font-medium">
          {getReviewTypeLabel(item)}
        </span>
      </div>
    </header>

    <div className="flex items-end justify-between mb-5">
      <div className="flex gap-5 items-center">
        <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold">
          {getContentLabel(item)}
        </span>
      </div>
      <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
        <span className="flex items-center gap-1">
          <Clock size={14} />
          {formatDateValue(item.updatedAt, 'yyyy-MM-dd HH:mm')}
        </span>
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
      <div>
        <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
          {item.reviewType === 'wiki' ? (
            <WikiMarkdown content={item.content || ''} />
          ) : (
            <MarkdownRenderer content={item.content || ''} />
          )}
        </div>
      </div>
      {renderSidebar(item)}
    </div>
  </>
)

const renderGalleryPreview = (
  item: AdminReviewQueueMergedItem,
  onOpenLightbox: (index: number) => void
) => {
  const images = Array.isArray(item.images) ? item.images : []

  return (
    <>
      <header className="mb-7">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
            {item.title || item.id}
          </h1>
          <span className="px-3 py-1 rounded bg-surface-alt text-brand-gold text-xs font-medium">
            {getReviewTypeLabel(item)}
          </span>
        </div>
        <p className="mt-2 text-text-secondary leading-relaxed">{item.description || '暂无描述'}</p>
        {item.copyright && <p className="text-xs text-text-muted mt-1">{item.copyright}</p>}
      </header>

      <div className="flex items-end justify-between mb-6 pb-2">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold">
            图片（{images.length}）
          </span>
        </div>
        <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
          <span className="flex items-center gap-1">
            <Clock size={14} /> {formatDateTime(item.createdAt, 'N/A')}
          </span>
          <span className="flex items-center gap-1">
            <UserIcon size={14} /> {getAuthorLabel(item)}
          </span>
        </div>
      </div>

      <section className="mb-10">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {images.map((image, index) => {
            const previewSrc = image.thumbnailUrl || image.url || ''

            return (
              <Button
                key={image.id}
                type="button"
                variant="ghost"
                onClick={() => onOpenLightbox(index)}
                className="group relative aspect-[3/4] h-auto cursor-zoom-in overflow-hidden rounded border-0 p-0"
              >
                {previewSrc ? (
                  <SmartImage
                    src={previewSrc}
                    alt={image.name || ''}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
                    生成中...
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 pointer-events-none">
                  <div className="absolute bottom-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 bg-black/40 text-white text-xs px-2 py-1 rounded">
                    查看原图
                  </div>
                </div>
              </Button>
            )
          })}
        </div>
      </section>

      {(item.tags?.length || item.locationDetail || item.locationName) && (
        <div className="grid grid-cols-1 gap-8 border-t border-border lg:grid-cols-[1fr_280px]">
          <div />
          <aside>
            {renderTags(item.tags)}
            {renderLocation(item)}
          </aside>
        </div>
      )}
    </>
  )
}

const AdminReviewContentPreview = ({ item }: AdminReviewContentPreviewProps) => {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const images = Array.isArray(item.images) ? item.images : []

  const handleOpenLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  return (
    <div
      className="min-h-[calc(100vh-10rem)] bg-[var(--color-bg-antique)] rounded border border-border"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-16 wiki-detail-page">
        {item.reviewType === 'gallery'
          ? renderGalleryPreview(item, handleOpenLightbox)
          : renderArticlePreview(item)}
      </div>

      {item.reviewType === 'gallery' ? (
        <Lightbox
          open={lightboxOpen}
          images={images.map((image) => ({
            id: image.id,
            url: image.thumbnailUrl || image.url,
            originalUrl: image.originalUrl || image.url,
            name: image.name,
          }))}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  )
}

export default AdminReviewContentPreview
