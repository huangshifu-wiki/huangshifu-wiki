import { Clock, MapPin, Tag } from 'lucide-react'
import { clsx } from 'clsx'
import MarkdownRenderer from '../../components/MarkdownRenderer'
import WikiMarkdown from '../wiki/WikiMarkdown'
import { getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import type { AdminReviewQueueMergedItem } from '../../types/api'

type AdminReviewContentPreviewProps = {
  item: AdminReviewQueueMergedItem
}

const wikiCategoryLabels: Record<string, string> = {
  biography: '人物',
  music: '音乐',
  album: '专辑',
  timeline: '时间线',
  event: '事件',
}

const formatDateValue = (value: string | undefined, pattern: string) =>
  value ? formatDate(value, pattern) : 'N/A'

const getContentLabel = (item: AdminReviewQueueMergedItem) => {
  if (item.reviewType === 'wiki') {
    return wikiCategoryLabels[item.category || ''] || item.category || '百科'
  }

  return item.sectionName || item.section || '帖子'
}

const getAuthorLabel = (item: AdminReviewQueueMergedItem) => {
  if (item.reviewType === 'wiki') {
    return item.lastEditorName || item.lastEditorUid || '匿名'
  }

  return item.authorName || item.authorUid || '匿名'
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

const AdminReviewContentPreview = ({ item }: AdminReviewContentPreviewProps) => {
  const typeText = item.reviewType === 'wiki' ? '百科' : '帖子'
  const authorText = item.reviewType === 'wiki' ? '编辑者' : '作者'

  return (
    <div
      className="min-h-[calc(100vh-10rem)] bg-bg-primary rounded border border-border"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-16 wiki-detail-page">
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
              {item.title || item.slug || item.id}
            </h1>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded theme-status-warning text-xs font-medium">
                待审核
              </span>
              <span className="px-3 py-1 rounded bg-surface-alt text-brand-gold text-xs font-medium">
                {typeText}
              </span>
            </div>
          </div>
        </header>

        <div className="flex items-end justify-between border-b border-border mb-5">
          <div className="flex gap-5 items-center">
            <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]">
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

        {Array.isArray(item.sensitiveWords) && item.sensitiveWords.length > 0 && (
          <div className="mb-5 p-3 theme-status-error rounded">
            <span className="text-xs font-medium theme-text-error">检测到敏感词: </span>
            {item.sensitiveWords.map((word) => (
              <span key={word} className="text-xs theme-text-error mr-1">
                #{word}
              </span>
            ))}
          </div>
        )}

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

          <aside className="lg:sticky lg:top-20">
            <div className="py-5 border-b border-border">
              <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                状态
              </h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">审核</span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
                      getStatusClassName(item.status)
                    )}
                  >
                    {getStatusText(item.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{authorText}</span>
                  <span className="text-text-primary font-medium text-right">
                    {getAuthorLabel(item)}
                  </span>
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

            {(item.locationDetail || item.locationName) && (
              <div className="py-5">
                <h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
                  地点
                </h3>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <MapPin size={14} className="text-brand-gold" />
                  <span>{item.locationDetail || item.locationName}</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

export default AdminReviewContentPreview
