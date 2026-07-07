import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, Camera, Clock, Sparkles, Trash2, X } from '@/src/components/icons'
import { clsx } from 'clsx'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import type { SearchSuggestion } from '../../hooks/useSearch'
import type { SearchHistoryItem } from '../../hooks/useSearchHistory'

interface SearchBoxProps {
  query: string
  suggestions: SearchSuggestion[]
  searchHistory?: SearchHistoryItem[]
  aiSearching: boolean
  semanticImageSearch: boolean
  semanticSearchEnabled?: boolean
  onQueryChange: (val: string) => void
  onSearch: (q: string) => void
  onImageSearch: (file: File) => void
  onToggleSemanticSearch: () => void
  onDismissSuggestions: () => void
  onRemoveSearchHistoryItem?: (query: string) => void
  onClearSearchHistory?: () => void
}

type SearchDropdown =
  | { type: 'suggestions'; items: SearchSuggestion[] }
  | { type: 'history'; items: SearchHistoryItem[] }

export const SearchBox: React.FC<SearchBoxProps> = ({
  query,
  suggestions,
  searchHistory = [],
  aiSearching,
  semanticImageSearch,
  semanticSearchEnabled = true,
  onQueryChange,
  onSearch,
  onImageSearch,
  onToggleSemanticSearch,
  onDismissSuggestions,
  onRemoveSearchHistoryItem,
  onClearSearchHistory,
}) => {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)

  // 建议列表键盘导航状态
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [inputFocused, setInputFocused] = useState(false)
  const trimmedQuery = query.trim()
  const matchingHistory = useMemo(() => {
    if (trimmedQuery.length === 1) return []
    const normalizedQuery = trimmedQuery.toLowerCase()
    return searchHistory.filter((item) =>
      normalizedQuery ? item.query.toLowerCase().includes(normalizedQuery) : true
    )
  }, [searchHistory, trimmedQuery])

  const currentDropdown: SearchDropdown | null =
    trimmedQuery.length >= 2 && suggestions.length > 0
      ? { type: 'suggestions', items: suggestions }
      : inputFocused && matchingHistory.length > 0
        ? { type: 'history', items: matchingHistory }
        : null
  const dropdownOpen = Boolean(currentDropdown)

  const dropdownPresence = useFloatingPresence(dropdownOpen)
  const lastDropdownRef = useRef<SearchDropdown | null>(null)

  if (currentDropdown) {
    lastDropdownRef.current = currentDropdown
  }

  const visibleDropdown = currentDropdown || lastDropdownRef.current

  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setInputFocused(false)
        onDismissSuggestions()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen, onDismissSuggestions])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isComposingRef.current) return
    onSearch(query)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onImageSearch(file)
    e.target.value = ''
  }

  const getSuggestionTypeLabel = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'keyword':
        return '搜索'
      case 'wiki':
        return '百科'
      case 'music':
        return '音乐'
      case 'album':
        return '专辑'
      default:
        return '帖子'
    }
  }

  const getSuggestionTypeClass = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'keyword':
        return 'bg-surface-alt text-text-secondary'
      case 'wiki':
        return 'theme-tag'
      case 'music':
        return 'theme-status-error'
      case 'album':
        return 'theme-status-warning'
      default:
        return 'bg-surface-alt text-text-secondary'
    }
  }

  const handleSuggestionClick = (s: SearchSuggestion) => {
    setHighlightedIndex(-1)
    setInputFocused(false)
    if (s.type === 'keyword') {
      onSearch(s.text)
    } else {
      if (s.type === 'wiki' && s.id) {
        navigate(`/wiki/${s.id}`)
      } else if (s.type === 'post' && s.id) {
        navigate(`/forum/${s.id}`)
      } else if (s.type === 'music' && s.id) {
        navigate(`/music/${s.id}`)
      } else if (s.type === 'album' && s.id) {
        navigate(`/album/${s.id}`)
      }
    }
  }

  const handleHistoryClick = (historyQuery: string) => {
    setHighlightedIndex(-1)
    setInputFocused(false)
    onSearch(historyQuery)
  }

  const handleRemoveHistoryItem = (e: React.MouseEvent, historyQuery: string) => {
    e.stopPropagation()
    onRemoveSearchHistoryItem?.(historyQuery)
  }

  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation()
    setHighlightedIndex(-1)
    onClearSearchHistory?.()
  }

  // 列表变化时重置高亮索引
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [currentDropdown?.type, suggestions, matchingHistory])

  // 下拉列表键盘导航处理
  const handleListboxKeyDown = (e: React.KeyboardEvent) => {
    if (!currentDropdown) return

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev < currentDropdown.items.length - 1 ? prev + 1 : prev))
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      }
      case 'Enter': {
        if (e.nativeEvent.isComposing) return
        if (highlightedIndex >= 0 && highlightedIndex < currentDropdown.items.length) {
          e.preventDefault()
          if (currentDropdown.type === 'suggestions') {
            handleSuggestionClick(currentDropdown.items[highlightedIndex])
          } else {
            handleHistoryClick(currentDropdown.items[highlightedIndex].query)
          }
        }
        break
      }
      case 'Escape': {
        onDismissSuggestions()
        setInputFocused(false)
        setHighlightedIndex(-1)
        break
      }
    }
  }

  return (
    <div ref={wrapperRef} className="mb-6 border-y border-[var(--book-ink-line)] py-4 sm:py-6">
      <form
        onSubmit={handleSubmit}
        className="group relative mb-5"
        role="search"
        onKeyDown={handleListboxKeyDown}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setInputFocused(true)
            onQueryChange(e.target.value)
          }}
          onFocus={() => {
            setInputFocused(true)
            if (query.length >= 2) onQueryChange(query)
          }}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          placeholder="搜索百科、帖子、图集、音乐或专辑..."
          aria-label="搜索百科、帖子、图集、音乐或专辑"
          autoComplete="off"
          aria-owns="search-suggestions"
          aria-expanded={dropdownOpen}
          className="w-full rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] py-4 pl-12 pr-14 text-base text-text-primary shadow-[inset_0_1px_0_rgba(138,109,47,0.06)] outline-none transition-all placeholder:text-text-muted focus:border-brand-gold sm:pr-40"
        />
        <SearchIcon
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-brand-gold"
          size={20}
        />

        {dropdownPresence.mounted && visibleDropdown && visibleDropdown.items.length > 0 && (
          <div
            className="floating-dropdown absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] shadow-[var(--book-panel-shadow)]"
            data-state={dropdownPresence.state}
            role="listbox"
            id="search-suggestions"
            aria-hidden={!currentDropdown}
          >
            {visibleDropdown.type === 'history' && (
              <div className="flex items-center justify-between border-b border-[var(--book-ink-line)] bg-surface-alt px-4 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
                  <Clock size={14} />
                  <span>搜索历史</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-brand-gold"
                  title="清空搜索历史"
                  aria-label="清空搜索历史"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}

            {visibleDropdown.type === 'suggestions'
              ? visibleDropdown.items.map((s, i) => (
                  <button
                    key={`${s.type}-${s.id || s.text}-${i}`}
                    type="button"
                    onClick={() => handleSuggestionClick(s)}
                    className={clsx(
                      'w-full border-b border-[var(--book-ink-line)] px-4 py-2.5 text-left transition-colors last:border-0',
                      i === highlightedIndex
                        ? 'bg-[var(--color-theme-accent)] text-white'
                        : 'hover:bg-surface-alt'
                    )}
                    role="option"
                    aria-selected={i === highlightedIndex}
                    id={`suggestion-${i}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-medium',
                          getSuggestionTypeClass(s.type)
                        )}
                      >
                        {getSuggestionTypeLabel(s.type)}
                      </span>
                      <span
                        className={clsx(
                          'text-sm',
                          i === highlightedIndex ? 'text-white' : 'text-text-primary'
                        )}
                      >
                        {s.text}
                      </span>
                      {s.subtext && (
                        <span
                          className={clsx(
                            'text-xs',
                            i === highlightedIndex ? 'text-white/80' : 'text-text-muted'
                          )}
                        >
                          {s.subtext}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              : visibleDropdown.items.map((item, i) => (
                  <div
                    key={item.query}
                    className={clsx(
                      'flex items-center border-b border-[var(--book-ink-line)] transition-colors last:border-0',
                      i === highlightedIndex
                        ? 'bg-[var(--color-theme-accent)] text-white'
                        : 'hover:bg-surface-alt'
                    )}
                    role="option"
                    aria-selected={i === highlightedIndex}
                    id={`suggestion-${i}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleHistoryClick(item.query)}
                      className="min-w-0 flex-1 px-4 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Clock
                          size={15}
                          className={i === highlightedIndex ? 'text-white/80' : 'text-text-muted'}
                        />
                        <span
                          className={clsx(
                            'truncate text-sm',
                            i === highlightedIndex ? 'text-white' : 'text-text-primary'
                          )}
                        >
                          {item.query}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemoveHistoryItem(e, item.query)}
                      className={clsx(
                        'mr-2 p-1.5 rounded transition-colors',
                        i === highlightedIndex
                          ? 'text-white/80 hover:text-white hover:bg-[color-mix(in_srgb,var(--color-theme-accent)_24%,transparent)]'
                          : 'text-text-muted hover:text-brand-gold hover:bg-surface'
                      )}
                      title={`删除搜索历史：${item.query}`}
                      aria-label={`删除搜索历史：${item.query}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
          </div>
        )}

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {semanticSearchEnabled && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={aiSearching}
              className="rounded bg-surface-alt p-2.5 text-text-muted transition-all hover:text-brand-gold"
              title="AI 图片搜索"
              aria-label="AI 图片搜索"
            >
              {aiSearching ? <Sparkles className="animate-spin" size={18} /> : <Camera size={18} />}
            </button>
          )}
          <button
            type="submit"
            className="hidden rounded px-6 py-2.5 font-medium theme-button-primary transition-all sm:inline-flex"
            aria-label="提交搜索"
          >
            搜索
          </button>
        </div>
        {semanticSearchEnabled && (
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
        )}
      </form>

      {/* 混合搜索模式切换 */}
      {semanticSearchEnabled && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--book-ink-line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onToggleSemanticSearch}
              className={clsx(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2',
                semanticImageSearch ? 'bg-[var(--color-theme-accent)]' : 'bg-border'
              )}
              role="switch"
              aria-checked={semanticImageSearch}
              aria-label="切换智能混合搜索模式"
              id="hybrid-search-toggle"
            >
              <span
                className={clsx(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                  semanticImageSearch ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
            <label
              htmlFor="hybrid-search-toggle"
              className="text-sm text-text-secondary cursor-pointer select-none"
            >
              <span className="font-medium">智能混合搜索</span>
            </label>
          </div>
          <div className="text-xs text-text-muted">
            {semanticImageSearch ? (
              <span className="text-brand-gold font-medium">● 混合模式已开启</span>
            ) : (
              <span>关键词模式</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
