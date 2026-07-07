import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X, Filter, Search, ChevronDown, ChevronUp } from '@/src/components/icons'
import { clsx } from 'clsx'
import {
  bookCompactInputClass,
  bookPanelClass,
  bookSecondaryButtonClass,
} from '../../components/BookEditor'
import { apiGet } from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import type { WikiRelationType, WikiRelationRecord } from './types'
import { RELATION_TYPE_LABELS } from './types'
import RelationPreview from './RelationPreview'
import {
  filterAndSortRelations,
  type SortStrategy,
  type FilterOptions,
  DEFAULT_FILTER_OPTIONS,
  DEFAULT_SORT_STRATEGY,
  getTypeLabel,
  getSortStrategyLabel,
  type RelationWithMetadata,
} from '../../lib/relationSorter'
import {
  type RelationWithOriginalIndex,
  withOriginalRelationIndexes,
} from '../../lib/wikiRelationIndex'
import { metadataCache } from '../../lib/metadataCache'
import type { WikiPageMetadata } from '../../lib/wikiLinkParser'
import type { WikiItem } from '../../types/entities'

type RelationSearchSuggestion = {
  type: 'keyword' | 'wiki' | 'post' | 'music' | 'album'
  text: string
  subtext?: string
  id?: string
}

const parseInternalLink = (input: string): { slug: string; displayText: string } | null => {
  const match = input.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/)
  if (match) {
    return {
      slug: (match[2] || match[1]).trim(),
      displayText: match[1].trim(),
    }
  }
  return null
}

/**
 * 从显示文本推断关联类型
 * 基于常见的命名规则和关键词
 */
const inferRelationType = (displayText: string): WikiRelationType => {
  const text = displayText.toLowerCase()

  // 时间线相关关键词
  const timelineKeywords = [
    '年',
    '月',
    '日',
    '时间线',
    'timeline',
    '历史',
    '时期',
    '年代',
    '纪元',
    '事件',
    '活动',
  ]
  if (timelineKeywords.some((kw) => text.includes(kw))) {
    return 'timeline_relation'
  }

  // 作品相关关键词
  const workKeywords = [
    '专辑',
    '歌曲',
    '音乐',
    '作品',
    '单曲',
    'ep',
    '唱片',
    '演唱会',
    '演出',
    'mv',
    'video',
    'film',
    '电影',
    '剧集',
  ]
  if (workKeywords.some((kw) => text.includes(kw))) {
    return 'work_relation'
  }

  // 人物相关关键词
  const personKeywords = [
    '歌手',
    '音乐人',
    '作曲',
    '作词',
    '编曲',
    '制作',
    '导演',
    '演员',
    '艺人',
    '明星',
    '乐队',
    '组合',
    '团体',
  ]
  if (personKeywords.some((kw) => text.includes(kw))) {
    return 'related_person'
  }

  // 默认返回相关人物
  return 'related_person'
}

/**
 * 从 URL 路径推断关联类型
 */
const inferTypeFromPath = (path: string): WikiRelationType => {
  if (path.includes('/music/')) return 'work_relation'
  if (path.includes('/album/')) return 'work_relation'
  if (path.includes('/event/')) return 'timeline_relation'
  return 'related_person'
}

/**
 * 解析外部链接，提取 slug 和类型
 * 支持格式：https://domain.com/wiki/slug 或 https://domain.com/music/slug 等
 */
const parseExternalLink = (input: string): { slug: string; type: WikiRelationType } | null => {
  try {
    // 检查是否是 URL
    if (!input.startsWith('http://') && !input.startsWith('https://')) {
      return null
    }

    const url = new URL(input)
    const pathParts = url.pathname.split('/').filter(Boolean)

    // 支持的路径格式：/wiki/slug, /music/slug, /album/slug, /event/slug
    if (pathParts.length >= 2) {
      const category = pathParts[0]
      const slug = pathParts[pathParts.length - 1]

      // 根据路径推断类型
      const type = inferTypeFromPath(url.pathname)

      return { slug, type }
    }

    return null
  } catch {
    return null
  }
}

interface WikiRelationsProps {
  relations: WikiRelationRecord[]
  onRelationsChange: (relations: WikiRelationRecord[]) => void
  currentPage?: WikiItem | null
}

const WikiRelations: React.FC<WikiRelationsProps> = ({
  relations,
  onRelationsChange,
  currentPage = null,
}) => {
  const { show } = useToast()

  // 筛选和排序状态
  const [sortStrategy, setSortStrategy] = useState<SortStrategy>(DEFAULT_SORT_STRATEGY)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(DEFAULT_FILTER_OPTIONS)
  const [showFilters, setShowFilters] = useState(false)

  // 元数据缓存
  const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(new Map())

  // 加载元数据
  useEffect(() => {
    const loadMetadata = async () => {
      const slugs = relations.map((r) => r.targetSlug)
      if (slugs.length === 0) return

      const metadata = await metadataCache.getBatch(slugs)
      setMetadataMap(metadata)
    }

    loadMetadata()
  }, [relations])

  // 带元数据的关联
  const relationsWithMetadata: RelationWithOriginalIndex<RelationWithMetadata>[] = useMemo(() => {
    return withOriginalRelationIndexes(
      relations.map((relation) => {
        const metadata = metadataMap.get(relation.targetSlug) || null
        return {
          ...relation,
          metadata,
          qualityScore: 0,
        }
      })
    )
  }, [relations, metadataMap])

  // 筛选和排序后的关联
  const filteredAndSortedRelations = useMemo(() => {
    return filterAndSortRelations(relationsWithMetadata, filterOptions, sortStrategy)
  }, [relationsWithMetadata, filterOptions, sortStrategy])

  // 新建关联的状态
  const [newRelation, setNewRelation] = useState<WikiRelationRecord>({
    type: 'related_person',
    targetSlug: '',
    label: '',
    bidirectional: false,
  })
  const [relationSearchResults, setRelationSearchResults] = useState<RelationSearchSuggestion[]>([])
  const [relationSearchLoading, setRelationSearchLoading] = useState(false)
  const [showRelationDropdown, setShowRelationDropdown] = useState(false)
  const relationDropdownPresence = useFloatingPresence(showRelationDropdown)
  const [relationSelectedIndex, setRelationSelectedIndex] = useState(-1)
  const relationSearchRef = useRef<HTMLDivElement>(null)
  const relationSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 编辑状态
  const [editingRelation, setEditingRelation] = useState<WikiRelationRecord | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const editModalPresence = useFloatingPresence(Boolean(editingRelation && editingIndex !== null))

  const handleRelationInputChange = useCallback(
    (input: string, isPaste = false) => {
      // 1. 首先检查是否是内链格式 [[slug]] 或 [[显示文本|slug]]
      const internalLink = parseInternalLink(input)
      if (internalLink) {
        const shouldSetLabel = !newRelation.label && internalLink.displayText !== internalLink.slug
        // 如果是粘贴操作，自动推断关联类型
        const inferredType = isPaste
          ? inferRelationType(internalLink.displayText)
          : newRelation.type
        setNewRelation((prev) => ({
          ...prev,
          targetSlug: internalLink.slug,
          label: shouldSetLabel ? internalLink.displayText : prev.label,
          type: inferredType,
        }))
        setRelationSearchResults([])
        setShowRelationDropdown(false)
        return
      }

      // 2. 检查是否是外部链接（粘贴时）
      if (isPaste) {
        const externalLink = parseExternalLink(input)
        if (externalLink) {
          setNewRelation((prev) => ({
            ...prev,
            targetSlug: externalLink.slug,
            type: externalLink.type,
          }))
          setRelationSearchResults([])
          setShowRelationDropdown(false)
          return
        }
      }

      setNewRelation((prev) => ({
        ...prev,
        targetSlug: input,
      }))

      if (relationSearchTimeoutRef.current) {
        clearTimeout(relationSearchTimeoutRef.current)
      }
      if (!input || input.length < 2) {
        setRelationSearchResults([])
        setShowRelationDropdown(false)
        return
      }
      relationSearchTimeoutRef.current = setTimeout(async () => {
        setRelationSearchLoading(true)
        try {
          const data = await apiGet<{
            suggestions: RelationSearchSuggestion[]
          }>('/api/search/suggest', { q: input })
          const wikiResults = data.suggestions?.filter((s) => s.type === 'wiki') || []
          setRelationSearchResults(wikiResults)
          setShowRelationDropdown(wikiResults.length > 0)
          setRelationSelectedIndex(-1)
        } catch (e) {
          console.error('Relation search error:', e)
        } finally {
          setRelationSearchLoading(false)
        }
      }, 300)
    },
    [newRelation.label, newRelation.type]
  )

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (relationSearchRef.current && !relationSearchRef.current.contains(e.target as Node)) {
        setShowRelationDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleAddRelation = () => {
    if (!newRelation.targetSlug.trim()) {
      show('请输入目标页面标识', { variant: 'error' })
      return
    }
    onRelationsChange([
      ...relations,
      {
        ...newRelation,
        targetSlug: newRelation.targetSlug.trim(),
      },
    ])
    setNewRelation({
      type: 'related_person',
      targetSlug: '',
      label: '',
      bidirectional: false,
    })
  }

  const handleRemoveRelation = (index: number) => {
    onRelationsChange(relations.filter((_, i) => i !== index))
  }

  const handleEditRelation = (index: number) => {
    setEditingIndex(index)
    setEditingRelation({ ...relations[index] })
  }

  const handleSaveEdit = () => {
    if (!editingRelation || editingIndex === null) return
    const updated = [...relations]
    updated[editingIndex] = editingRelation
    onRelationsChange(updated)
    setEditingIndex(null)
    setEditingRelation(null)
  }

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setEditingRelation(null)
  }

  const handleEditModalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleSaveEdit()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleCancelEdit()
    }
  }

  // 筛选控件
  const FilterControls = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 类型筛选 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">关联类型</label>
          <select
            value={filterOptions.type}
            onChange={(e) =>
              setFilterOptions({
                ...filterOptions,
                type: e.target.value as FilterOptions['type'],
              })
            }
            className={bookCompactInputClass}
          >
            <option value="all">全部类型</option>
            <option value="related_person">相关人物</option>
            <option value="work_relation">作品关联</option>
            <option value="timeline_relation">时间线关联</option>
            <option value="custom">自定义关系</option>
          </select>
        </div>

        {/* 排序方式 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">排序方式</label>
          <select
            value={sortStrategy}
            onChange={(e) => setSortStrategy(e.target.value as SortStrategy)}
            className={bookCompactInputClass}
          >
            <option value="quality">质量优先</option>
            <option value="type_grouped">类型分组</option>
            <option value="date">时间排序</option>
            <option value="alphabetical">字母顺序</option>
          </select>
        </div>

        {/* 搜索框 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">搜索</label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={filterOptions.search}
              onChange={(e) =>
                setFilterOptions({
                  ...filterOptions,
                  search: e.target.value,
                })
              }
              placeholder="搜索标题、描述..."
              className={`${bookCompactInputClass} pl-9`}
            />
          </div>
        </div>
      </div>

      {/* 筛选结果统计 */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>
          显示{' '}
          <span className="font-semibold text-brand-gold">{filteredAndSortedRelations.length}</span>{' '}
          / {relations.length} 个关联
        </span>
        {(filterOptions.type !== 'all' ||
          filterOptions.search ||
          sortStrategy !== DEFAULT_SORT_STRATEGY) && (
          <button
            type="button"
            onClick={() => {
              setFilterOptions(DEFAULT_FILTER_OPTIONS)
              setSortStrategy(DEFAULT_SORT_STRATEGY)
            }}
            className="text-brand-gold hover:underline"
          >
            重置筛选
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-text-muted">相关页面</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-all',
              showFilters
                ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold'
            )}
          >
            <Filter size={14} />
            筛选
            {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            type="button"
            onClick={handleAddRelation}
            className="rounded border border-[rgba(138,109,47,0.25)] px-4 py-1.5 text-xs font-medium text-brand-gold transition-all hover:border-brand-gold hover:bg-brand-gold hover:text-white"
          >
            + 添加关联
          </button>
        </div>
      </div>

      {/* 筛选面板 */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`${bookPanelClass} p-4`}>
              <FilterControls />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 关联列表 */}
      {filteredAndSortedRelations.length > 0 && (
        <div className="space-y-3">
          {filteredAndSortedRelations.map((relation) => {
            const originalIndex = relation.originalIndex
            return (
              <RelationPreview
                key={`relation-${originalIndex}`}
                relation={{
                  ...relation,
                  metadata: relation.metadata || undefined,
                }}
                currentPage={currentPage || ({} as WikiItem)}
                onEdit={() => handleEditRelation(originalIndex)}
                onRemove={() => handleRemoveRelation(originalIndex)}
                isEditing={editingIndex === originalIndex}
              />
            )
          })}
        </div>
      )}

      {/* 空状态 */}
      {relations.length > 0 && filteredAndSortedRelations.length === 0 && (
        <div className={`${bookPanelClass} p-8 text-center text-text-muted`}>
          <p className="text-sm">没有符合筛选条件的关联</p>
          <button
            type="button"
            onClick={() => {
              setFilterOptions({
                ...DEFAULT_FILTER_OPTIONS,
                quality: 'all' as const,
              })
              setSortStrategy(DEFAULT_SORT_STRATEGY)
            }}
            className="mt-2 text-sm text-brand-gold hover:underline"
          >
            重置筛选条件
          </button>
        </div>
      )}

      {/* 编辑关联弹窗 */}
      {editModalPresence.mounted && editingRelation && editingIndex !== null && (
        <div
          className="floating-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-state={editModalPresence.state}
          aria-hidden={!editingRelation}
          onClick={handleCancelEdit}
        >
          <div
            className="floating-panel w-full max-w-md rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] p-6 shadow-[var(--book-panel-shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary">编辑关联</h3>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="rounded p-1.5 text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-brand-gold"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  关联类型
                </label>
                <select
                  value={editingRelation.type}
                  onChange={(e) =>
                    setEditingRelation({
                      ...editingRelation,
                      type: e.target.value as WikiRelationType,
                    })
                  }
                  className={bookCompactInputClass}
                >
                  <option value="related_person">相关人物</option>
                  <option value="work_relation">作品关联</option>
                  <option value="timeline_relation">时间线关联</option>
                  <option value="custom">自定义关系</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  目标页面
                </label>
                <input
                  type="text"
                  value={editingRelation.targetSlug}
                  readOnly
                  className={`${bookCompactInputClass} text-text-muted`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  显示名称
                </label>
                <input
                  type="text"
                  value={editingRelation.label || ''}
                  onChange={(e) =>
                    setEditingRelation({
                      ...editingRelation,
                      label: e.target.value,
                    })
                  }
                  onKeyDown={handleEditModalKeyDown}
                  placeholder="可选"
                  className={bookCompactInputClass}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={editingRelation.bidirectional}
                    onChange={(e) =>
                      setEditingRelation({
                        ...editingRelation,
                        bidirectional: e.target.checked,
                      })
                    }
                    className="rounded border border-[var(--book-ink-line)]"
                  />
                  双向关联
                </label>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCancelEdit}
                className={`flex-1 ${bookSecondaryButtonClass}`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 rounded px-4 py-2 text-sm font-medium theme-button-primary transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加关联表单 */}
      <div className={`${bookPanelClass} flex flex-col gap-3 p-4`}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={newRelation.type}
            onChange={(e) =>
              setNewRelation({
                ...newRelation,
                type: e.target.value as WikiRelationType,
              })
            }
            className={`${bookCompactInputClass} sm:w-auto`}
          >
            <option value="related_person">相关人物</option>
            <option value="work_relation">作品关联</option>
            <option value="timeline_relation">时间线关联</option>
            <option value="custom">自定义关系</option>
          </select>
          <div ref={relationSearchRef} className="relative flex-1">
            <input
              type="text"
              value={newRelation.targetSlug}
              onChange={(e) => {
                handleRelationInputChange(e.target.value, false)
              }}
              onPaste={(e) => {
                e.preventDefault()
                const pastedText = e.clipboardData.getData('text')
                handleRelationInputChange(pastedText, true)
              }}
              placeholder="粘贴链接或 [[页面标题]]"
              className={bookCompactInputClass}
              onKeyDown={(e) => {
                if (!showRelationDropdown) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setRelationSelectedIndex((prev) =>
                    Math.min(prev + 1, relationSearchResults.length - 1)
                  )
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setRelationSelectedIndex((prev) => Math.max(prev - 1, -1))
                } else if (e.key === 'Enter' && relationSelectedIndex >= 0) {
                  e.preventDefault()
                  const selected = relationSearchResults[relationSelectedIndex]
                  setNewRelation({
                    ...newRelation,
                    targetSlug: selected.id || '',
                  })
                  setShowRelationDropdown(false)
                } else if (e.key === 'Escape') {
                  setShowRelationDropdown(false)
                }
              }}
            />
            {relationDropdownPresence.mounted && (
              <div
                className="floating-dropdown absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] shadow-[var(--book-panel-shadow)] backdrop-blur-[12px]"
                data-state={relationDropdownPresence.state}
                aria-hidden={!showRelationDropdown}
              >
                <div className="border-b border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-3 py-2 text-xs text-text-muted">
                  直接输入{' '}
                  <code className="rounded bg-[var(--book-panel-hover)] px-1">[[标题]]</code>{' '}
                  格式更快
                </div>
                {relationSearchLoading ? (
                  <div className="px-4 py-2 text-sm text-text-muted">搜索中...</div>
                ) : relationSearchResults.length === 0 ? (
                  <div className="px-4 py-2 text-sm text-text-muted">
                    未找到相关页面，请尝试输入 [[页面标题]]
                  </div>
                ) : (
                  relationSearchResults.map((result, idx) => (
                    <div
                      key={result.id}
                      className={`cursor-pointer px-4 py-2 ${idx === relationSelectedIndex ? 'bg-brand-gold/10' : 'hover:bg-[var(--book-panel-hover)]'}`}
                      onClick={() => {
                        setNewRelation({
                          ...newRelation,
                          targetSlug: result.id || '',
                        })
                        setShowRelationDropdown(false)
                      }}
                      onMouseEnter={() => setRelationSelectedIndex(idx)}
                    >
                      <div className="text-sm font-medium text-text-primary">{result.text}</div>
                      <div className="flex items-center gap-2 truncate text-xs text-text-muted">
                        <span className="rounded bg-[var(--book-panel-bg)] px-1.5 py-0.5 text-[10px]">
                          {result.id}
                        </span>
                        <span>{result.subtext}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <input
            type="text"
            value={newRelation.label || ''}
            onChange={(e) => setNewRelation({ ...newRelation, label: e.target.value })}
            placeholder="显示名称 (可选)"
            className={`${bookCompactInputClass} flex-1`}
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-text-muted">
            <input
              type="checkbox"
              checked={newRelation.bidirectional}
              onChange={(e) =>
                setNewRelation({
                  ...newRelation,
                  bidirectional: e.target.checked,
                })
              }
              className="rounded"
            />
            双向关联
          </label>
        </div>
      </div>
    </div>
  )
}

export default WikiRelations
