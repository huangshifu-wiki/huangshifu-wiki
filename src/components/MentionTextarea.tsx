import React, { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { apiGet } from '../lib/apiClient'
import type { MentionTarget } from '../lib/mentions'

interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  maxLength?: number
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  placeholder?: string
  rows?: number
  disabled?: boolean
  className?: string
}

interface ActiveMentionToken {
  start: number
  end: number
  query: string
}

const TOKEN_BOUNDARY = /[\s<>{}[\]()`"'“”‘’]/
const WORD_CHARS = /[\p{L}\p{N}_]/u

function isValidMentionBoundary(value: string | undefined) {
  return !value || (!WORD_CHARS.test(value) && value !== '.' && value !== '-')
}

function getActiveMentionToken(value: string, cursor: number): ActiveMentionToken | null {
  const start = value.lastIndexOf('@', cursor - 1)
  if (start < 0) return null
  if (!isValidMentionBoundary(value[start - 1])) return null

  const token = value.slice(start + 1, cursor)
  if (!token || TOKEN_BOUNDARY.test(token)) return null
  return { start, end: cursor, query: token }
}

export default function MentionTextarea({
  value,
  onChange,
  textareaRef,
  maxLength,
  onKeyDown,
  placeholder,
  rows = 3,
  disabled,
  className,
}: MentionTextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const inputRef = textareaRef ?? innerRef
  const [cursor, setCursor] = useState(0)
  const [suggestions, setSuggestions] = useState<MentionTarget[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)

  const activeToken = useMemo(() => getActiveMentionToken(value, cursor), [cursor, value])

  useEffect(() => {
    if (!activeToken || disabled) {
      setSuggestions([])
      setSelectedIndex(0)
      return
    }

    const abortController = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      apiGet<{ users: MentionTarget[] }>(
        '/api/users/mentions',
        { q: activeToken.query, limit: 8 },
        { staleTime: 15000, swr: true },
        abortController.signal
      )
        .then((data) => {
          setSuggestions(data.users || [])
          setSelectedIndex(0)
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            console.error('Fetch mention suggestions error:', error)
          }
          setSuggestions([])
        })
        .finally(() => setLoading(false))
    }, 200)

    return () => {
      window.clearTimeout(timer)
      abortController.abort()
    }
  }, [activeToken?.query, disabled])

  useEffect(() => {
    if (!suggestions.length) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (inputRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setSuggestions([])
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [inputRef, suggestions.length])

  const updateCursor = () => {
    const nextCursor = inputRef.current?.selectionStart ?? 0
    setCursor(nextCursor)
  }

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
    setCursor(event.target.selectionStart)
  }

  const handleSelect = (target: MentionTarget) => {
    if (!activeToken) return
    const nextValue = `${value.slice(0, activeToken.start)}@${target.displayName} ${value.slice(
      activeToken.end
    )}`
    const nextCursor = activeToken.start + target.displayName.length + 2
    onChange(nextValue)
    setSuggestions([])
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      setCursor(nextCursor)
    }, 0)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      !suggestions.length ||
      event.nativeEvent.isComposing ||
      isComposingRef.current
    ) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % suggestions.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleSelect(suggestions[selectedIndex])
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setSuggestions([])
    }
  }

  return (
    <>
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onClick={updateCursor}
        onKeyUp={updateCursor}
        onFocus={updateCursor}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
        }}
        maxLength={maxLength}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
      />
      {suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="floating-dropdown absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded border border-border bg-surface"
          data-state="open"
          role="listbox"
          aria-hidden={false}
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.uid}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(event) => {
                event.preventDefault()
                handleSelect(suggestion)
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                index === selectedIndex ? 'bg-[var(--color-theme-accent)] text-white' : 'hover:bg-surface-alt'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{suggestion.displayName}</span>
              <span className="text-xs opacity-75">{suggestion.uid.slice(0, 8)}</span>
            </button>
          ))}
          {loading && <div className="px-3 py-2 text-xs text-text-muted">搜索中...</div>}
        </div>
      )}
    </>
  )
}
