import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Search as SearchIcon } from '@/src/components/icons'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import { useDismissableLayer } from '../../hooks/useClickOutside'
import { useTraditionalSearch } from '../../hooks/useSearch'
import type { SearchSuggestion } from '../../hooks/useSearch'
import { Button, Input } from '@/src/components/ui'

/**
 * 导航栏紧凑搜索框：位于通知按钮左侧。
 * 输入时展示 /api/search/suggest 建议下拉；回车或点击建议跳转到 /search?q=… 或对应详情页。
 * 与搜索页 SearchBox 的建议交互保持一致，但不含搜索历史、AI 图片搜索与模式开关。
 */
export const NavbarSearchBox: React.FC = () => {
  const navigate = useNavigate()
  const { getSuggestions } = useTraditionalSearch()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isComposingRef = useRef(false)
  const lastSuggestionsRef = useRef<SearchSuggestion[]>([])

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [inputFocused, setInputFocused] = useState(false)

  const trimmedQuery = query.trim()
  const dropdownOpen = inputFocused && trimmedQuery.length >= 2 && suggestions.length > 0

  if (suggestions.length > 0) {
    lastSuggestionsRef.current = suggestions
  }
  const visibleSuggestions = suggestions.length > 0 ? suggestions : lastSuggestionsRef.current

  const presence = useFloatingPresence(dropdownOpen)

  const dismiss = useCallback(() => {
    setSuggestions([])
    setHighlightedIndex(-1)
    setInputFocused(false)
  }, [])

  useDismissableLayer(wrapperRef, dismiss, dropdownOpen)

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setSuggestions([])
        return
      }
      const result = await getSuggestions(q)
      setSuggestions(result)
    },
    [getSuggestions]
  )

  useEffect(() => {
    return () => {
      if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current)
    }
  }, [])

  // 建议列表变化时重置高亮索引
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [suggestions])

  const submitSearch = useCallback(() => {
    if (isComposingRef.current) return
    const q = trimmedQuery
    navigate(q ? '/search?q=' + encodeURIComponent(q) : '/search')
    dismiss()
  }, [trimmedQuery, navigate, dismiss])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitSearch()
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

  // 建议条目对应目标页；keyword 类型无 URL（触发搜索）
  const getSuggestionUrl = (s: SearchSuggestion): string | null => {
    if (s.type === 'wiki' && s.id) return `/wiki/${s.id}`
    if (s.type === 'post' && s.id) return `/forum/${s.id}`
    if (s.type === 'music' && s.id) return `/music/${s.id}`
    if (s.type === 'album' && s.id) return `/album/${s.id}`
    return null
  }

  const handleSuggestionClick = (s: SearchSuggestion) => {
    dismiss()
    if (s.type === 'keyword') {
      navigate('/search?q=' + encodeURIComponent(s.text))
    } else if (s.type === 'wiki' && s.id) {
      navigate(`/wiki/${s.id}`)
    } else if (s.type === 'post' && s.id) {
      navigate(`/forum/${s.id}`)
    } else if (s.type === 'music' && s.id) {
      navigate(`/music/${s.id}`)
    } else if (s.type === 'album' && s.id) {
      navigate(`/album/${s.id}`)
    }
  }

  // 下拉列表键盘导航处理
  const handleListboxKeyDown = (e: React.KeyboardEvent) => {
    if (!dropdownOpen) return

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      }
      case 'Enter': {
        if (e.nativeEvent.isComposing) return
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          e.preventDefault()
          handleSuggestionClick(suggestions[highlightedIndex])
        }
        break
      }
      case 'Escape': {
        dismiss()
        break
      }
    }
  }

  const suggestionItemClass = (isHighlighted: boolean) =>
    clsx(
      'w-full flex-col items-stretch justify-start rounded-none border-x-0 border-t-0 border-b border-[var(--book-ink-line)] px-4 py-2.5 text-left last:border-0',
      isHighlighted ? 'bg-[var(--color-theme-accent)] text-white' : 'hover:bg-surface-alt'
    )

  return (
    <div ref={wrapperRef} className="relative">
      <form role="search" onSubmit={handleSubmit} onKeyDown={handleListboxKeyDown}>
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            onClick={submitSearch}
            className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 text-[var(--home-text-2)] hover:bg-transparent hover:text-[var(--home-gold)]"
            aria-label="打开搜索页"
          >
            <SearchIcon size={16} />
          </Button>
          <Input
            type="text"
            value={query}
            onChange={(e) => {
              setInputFocused(true)
              setQuery(e.target.value)
              if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current)
              suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(e.target.value), 300)
            }}
            onFocus={() => {
              setInputFocused(true)
              if (query.trim().length >= 2) fetchSuggestions(query)
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            placeholder="搜索"
            aria-label="搜索百科、帖子、图集、音乐或专辑"
            autoComplete="off"
            aria-owns="navbar-search-suggestions"
            aria-expanded={dropdownOpen}
            className="w-56 rounded-full border-[var(--home-border)] bg-[color-mix(in_srgb,var(--home-nav-bg)_55%,transparent)] py-1.5 pl-9 pr-3 text-sm text-[var(--home-text-1)] placeholder:text-[var(--home-text-3)] focus:border-[var(--home-gold)] focus:shadow-none"
          />
        </div>

        {presence.mounted && visibleSuggestions.length > 0 && (
          <div
            className="floating-dropdown absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-sm border border-[var(--book-ink-line)] bg-[var(--ui-floating-bg)] shadow-[var(--book-panel-shadow)]"
            data-state={presence.state}
            role="listbox"
            id="navbar-search-suggestions"
            aria-hidden={!dropdownOpen}
          >
            {visibleSuggestions.map((s, i) => {
              const suggestionUrl = getSuggestionUrl(s)
              return suggestionUrl ? (
                <Button
                  key={`${s.type}-${s.id || s.text}-${i}`}
                  asChild
                  variant="ghost"
                  role="option"
                  aria-selected={i === highlightedIndex}
                  id={`navbar-suggestion-${i}`}
                  className={suggestionItemClass(i === highlightedIndex)}
                >
                  <Link to={suggestionUrl} onClick={dismiss}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={clsx(
                          'shrink-0 px-2 py-0.5 rounded text-[10px] font-medium',
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
                            'truncate text-xs',
                            i === highlightedIndex ? 'text-white/80' : 'text-text-muted'
                          )}
                        >
                          {s.subtext}
                        </span>
                      )}
                    </div>
                  </Link>
                </Button>
              ) : (
                <Button
                  key={`${s.type}-${s.id || s.text}-${i}`}
                  type="button"
                  variant="ghost"
                  onClick={() => handleSuggestionClick(s)}
                  className={suggestionItemClass(i === highlightedIndex)}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  id={`navbar-suggestion-${i}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={clsx(
                        'shrink-0 px-2 py-0.5 rounded text-[10px] font-medium',
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
                          'truncate text-xs',
                          i === highlightedIndex ? 'text-white/80' : 'text-text-muted'
                        )}
                      >
                        {s.subtext}
                      </span>
                    )}
                  </div>
                </Button>
              )
            })}
          </div>
        )}
      </form>
    </div>
  )
}
