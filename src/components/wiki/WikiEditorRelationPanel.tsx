import React, { useState } from 'react'
import { X, BarChart3, ChevronDown, ChevronUp } from '@/src/components/icons'
import { motion, AnimatePresence } from 'motion/react'
import { BookEditorSection, bookPanelClass } from '../../components/BookEditor'
import WikiRelations from './WikiRelations'
import MiniRelationGraph from './MiniRelationGraph'
import type { WikiRelationRecord } from './types'
import type { WikiPageMetadata } from '../../lib/wikiLinkParser'

interface WikiEditorRelationPanelProps {
  relations: WikiRelationRecord[]
  onRelationsChange: (relations: WikiRelationRecord[]) => void
  currentPage: {
    slug: string
    title: string
    category: string
    content: string
    tags: string[]
    description: string
  } | null
  metadataMap: Map<string, WikiPageMetadata>
  isNew: boolean
  slug: string | undefined
  formDataTitle: string
}

const WikiEditorRelationPanel = React.memo(
  ({
    relations,
    onRelationsChange,
    currentPage,
    metadataMap,
    isNew,
    slug,
    formDataTitle,
  }: WikiEditorRelationPanelProps) => {
    const [showGraphPreview, setShowGraphPreview] = useState(false)

    return (
      <BookEditorSection title="关联关系">
        <WikiRelations
          relations={relations}
          onRelationsChange={onRelationsChange}
          currentPage={currentPage as any}
        />

        {/* 图谱预览面板 */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowGraphPreview(!showGraphPreview)}
            className={`flex w-full items-center justify-between rounded border px-4 py-3 text-sm font-medium transition-all ${
              showGraphPreview
                ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold'
            }`}
          >
            <div className="flex items-center gap-2">
              <BarChart3 size={16} />
              <span>图谱预览</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs opacity-75">{relations.length} 个关联</span>
              {showGraphPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          <AnimatePresence>
            {showGraphPreview && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className={`${bookPanelClass} p-4`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-primary">关联图谱</h3>
                    <button
                      type="button"
                      onClick={() => setShowGraphPreview(false)}
                      className="rounded p-1.5 text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-brand-gold"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {relations.length === 0 ? (
                    <div className="py-8 text-center text-text-muted text-sm">
                      暂无关联数据，请先添加关联
                    </div>
                  ) : (
                    <>
                      <MiniRelationGraph
                        relations={relations}
                        metadata={metadataMap}
                        currentSlug={isNew ? 'new' : slug || ''}
                        currentTitle={formDataTitle || '新页面'}
                        height={360}
                      />
                      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-text-muted">
                        <span>提示：拖动图谱查看，滚轮缩放</span>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </BookEditorSection>
    )
  }
)

WikiEditorRelationPanel.displayName = 'WikiEditorRelationPanel'

export default WikiEditorRelationPanel
