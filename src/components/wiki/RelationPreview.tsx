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
      className={`p-4 rounded border ${isNew || isEditing ? 'border-brand-gold/30 bg-brand-gold/5' : 'border-border bg-surface'} hover:border-brand-gold/40 transition-all`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-text-primary text-base">{displayTitle}</h4>
            {isNew && (
              <span className="px-2 py-0.5 bg-[var(--color-theme-accent)] text-white text-[10px] font-medium rounded">
                新建
              </span>
            )}
            {isEditing && (
              <span className="px-2 py-0.5 theme-bg-info-soft theme-text-info text-[10px] font-medium rounded">
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
                <span>目标：{targetDisplayTitle}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(relation)}
              className="p-1.5 text-text-muted hover:text-brand-gold transition-colors rounded hover:bg-surface-alt"
              title="编辑关联"
            >
              <Edit2 size={14} />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1.5 text-text-muted theme-icon-button-danger transition-colors rounded hover:bg-[color-mix(in_srgb,var(--color-error)_10%,var(--color-surface))]"
              title="移除关联"
            >
              <X size={14} />
            </button>
          )}

          {onConfirm && isNew && (
            <button
              type="button"
              onClick={onConfirm}
              className="p-1.5 theme-text-success transition-colors rounded hover:bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))]"
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
        <div className="mt-3 rounded overflow-hidden">
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
                className="px-2 py-1 bg-surface-alt text-text-secondary text-[10px] font-medium rounded"
              >
                #{tag}
              </span>
            ))}
          {relation.metadata?.authorName && (
            <span className="px-2 py-1 bg-surface-alt text-brand-gold text-[10px] font-medium rounded">
              👤 {relation.metadata.authorName}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

export default RelationPreview
