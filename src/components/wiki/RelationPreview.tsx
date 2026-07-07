import React from 'react'
import { motion } from 'motion/react'
import { X, Edit2, Check, Link2 } from '@/src/components/icons'
import type { WikiRelationRecord } from './types'
import type { WikiPageMetadata } from '../../lib/wikiLinkParser'
import type { WikiItem } from '../../types/entities'
import { RELATION_TYPE_LABELS } from './types'
import { getWikiRelationDisplayTitle } from '../../lib/wikiRelationDisplay'

interface RelationPreviewProps {
  relation: WikiRelationRecord & {
    metadata?: WikiPageMetadata | null
  }
  currentPage: WikiItem
  onEdit?: (relation: WikiRelationRecord) => void
  onRemove?: () => void
  onConfirm?: () => void
  isNew?: boolean
  isEditing?: boolean
}

const RelationPreview: React.FC<RelationPreviewProps> = ({
  relation,
  currentPage,
  onEdit,
  onRemove,
  onConfirm,
  isNew = false,
  isEditing = false,
}) => {
  const typeLabel = RELATION_TYPE_LABELS[relation.type]
  const targetTitle = relation.metadata?.title?.trim() || null
  const displayTitle = getWikiRelationDisplayTitle({
    ...relation,
    targetTitle,
  })
  const targetDisplayTitle = targetTitle || relation.targetSlug
  const customDisplayName = relation.label?.trim() || ''
  const hasCustomDisplayName = Boolean(
    customDisplayName && customDisplayName !== targetDisplayTitle
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`rounded border p-4 transition-colors ${
        isNew || isEditing
          ? 'border-brand-gold/40 bg-[color-mix(in_srgb,var(--color-theme-accent)_8%,transparent)]'
          : 'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] hover:border-brand-gold/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2 mb-1">
            <h4 className="min-w-0 text-wrap-anywhere font-semibold text-text-primary text-base">
              {displayTitle}
            </h4>
            {isNew && (
              <span className="flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-medium theme-button-primary">
                新建
              </span>
            )}
            {isEditing && (
              <span className="flex-shrink-0 px-2 py-0.5 theme-bg-info-soft theme-text-info text-[10px] font-medium rounded">
                编辑中
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Link2 size={12} />
              {typeLabel}
            </span>
            {relation.metadata?.category && (
              <>
                <span>/</span>
                <span className="capitalize">{relation.metadata.category}</span>
              </>
            )}
            {hasCustomDisplayName && (
              <>
                <span>/</span>
                <span className="min-w-0 text-wrap-anywhere">目标：{targetDisplayTitle}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(relation)}
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-[var(--book-panel-hover)] hover:text-brand-gold"
              title="编辑关联"
            >
              <Edit2 size={14} />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-1.5 text-text-muted theme-icon-button-danger transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_10%,var(--book-panel-bg))]"
              title="移除关联"
            >
              <X size={14} />
            </button>
          )}

          {onConfirm && isNew && (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded p-1.5 theme-text-success transition-colors hover:bg-[color-mix(in_srgb,var(--color-success)_10%,var(--book-panel-bg))]"
              title="确认添加"
            >
              <Check size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 描述信息 */}
      {relation.metadata?.description && (
        <p className="text-sm text-text-secondary mt-3 line-clamp-2">
          {relation.metadata.description}
        </p>
      )}

      {/* 封面图片 */}
      {relation.metadata?.coverImage && (
        <div className="mt-3 overflow-hidden rounded border border-[var(--book-ink-line)]">
          <img
            src={relation.metadata.coverImage}
            alt="Cover"
            className="w-full h-32 object-cover"
          />
        </div>
      )}

      {/* 元数据标签 */}
      {(relation.metadata?.tags?.length || relation.metadata?.authorName) && (
        <div className="flex flex-wrap gap-2 mt-3">
          {relation.metadata?.tags &&
            relation.metadata.tags.slice(0, 5).map((tag, idx) => (
              <span
                key={idx}
                className="rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-1 text-[10px] font-medium text-text-secondary"
              >
                #{tag}
              </span>
            ))}
          {relation.metadata?.authorName && (
            <span className="rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-1 text-[10px] font-medium text-brand-gold">
              👤 {relation.metadata.authorName}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

export default RelationPreview
