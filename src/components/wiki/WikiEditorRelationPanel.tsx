import React, { useState } from 'react'
import { X, BarChart3, ChevronDown, ChevronUp } from '@/src/components/icons'
import { motion, AnimatePresence } from 'motion/react'
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
      <>
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
            className={`w-full px-4 py-3 rounded text-sm font-medium transition-all flex items-center justify-between border ${
              showGraphPreview
                ? 'bg-[var(--color-theme-accent)] text-white border-transparent'
                : 'bg-surface-alt text-text-secondary border-border hover:border-brand-gold hover:text-brand-gold'
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
                <div className="p-4 bg-surface rounded border border-border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-text-primary">关联图谱</h3>
                    <button
                      type="button"
                      onClick={() => setShowGraphPreview(false)}
                      className="p-1.5 text-text-muted hover:text-text-secondary rounded hover:bg-bg-tertiary"
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
      </>
    )
  }
)

WikiEditorRelationPanel.displayName = 'WikiEditorRelationPanel'

export default WikiEditorRelationPanel
