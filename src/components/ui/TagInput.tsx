import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from '@/src/components/icons'
import { normalizeStringListInput } from '@/src/lib/musicCredits'
import { IconButton } from './actions'
import { Input } from './forms'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './overlays'
import { cn } from './utils'

export interface TagInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange'
> {
  value: readonly string[]
  onChange: (nextTags: string[]) => void
  suggestions?: readonly string[]
}

export const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  (
    {
      value,
      onChange,
      suggestions = [],
      className,
      id,
      disabled,
      onKeyDown,
      onFocus,
      onBlur: onInputBlur,
      onClick: onInputClick,
      onCompositionStart,
      onCompositionEnd,
      ...inputProps
    },
    forwardedRef
  ) => {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const keepOpenOnBlurRef = useRef(false)
    const keepOpenResetTimerRef = useRef<number | undefined>(undefined)
    const listboxId = useId()
    const isComposingRef = useRef(false)
    const [inputValue, setInputValue] = useState('')
    const [open, setOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)

    const selectedTags = useMemo(() => normalizeStringListInput(value), [value])
    const normalizedSuggestions = useMemo(
      () => normalizeStringListInput(suggestions),
      [suggestions]
    )
    const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags])
    const filteredSuggestions = useMemo(() => {
      const query = inputValue.trim().toLowerCase()
      return normalizedSuggestions.filter(
        (tag) => !selectedTagSet.has(tag) && (!query || tag.toLowerCase().includes(query))
      )
    }, [inputValue, normalizedSuggestions, selectedTagSet])
    const listboxOpen = !disabled && open && filteredSuggestions.length > 0

    const dismiss = useCallback(() => {
      keepOpenOnBlurRef.current = false
      if (keepOpenResetTimerRef.current !== undefined) {
        window.clearTimeout(keepOpenResetTimerRef.current)
        keepOpenResetTimerRef.current = undefined
      }
      setOpen(false)
      setHighlightedIndex(-1)
    }, [])
    useEffect(() => {
      if (disabled) dismiss()
    }, [disabled, dismiss])

    useEffect(() => {
      return () => {
        if (keepOpenResetTimerRef.current !== undefined) {
          window.clearTimeout(keepOpenResetTimerRef.current)
        }
      }
    }, [])

    const armKeepOpen = () => {
      keepOpenOnBlurRef.current = true
      if (keepOpenResetTimerRef.current !== undefined) {
        window.clearTimeout(keepOpenResetTimerRef.current)
        keepOpenResetTimerRef.current = undefined
      }
    }

    const scheduleKeepOpenReset = () => {
      if (keepOpenResetTimerRef.current !== undefined) {
        window.clearTimeout(keepOpenResetTimerRef.current)
      }
      keepOpenResetTimerRef.current = window.setTimeout(() => {
        keepOpenOnBlurRef.current = false
        keepOpenResetTimerRef.current = undefined
      }, 0)
    }

    const updateTags = useCallback(
      (tags: readonly string[], keepOpen = false) => {
        const currentTags = selectedTags
        const nextTags = normalizeStringListInput([...currentTags, ...tags])

        if (nextTags.length !== currentTags.length) {
          onChange(nextTags)
        }
        setInputValue('')
        setHighlightedIndex(-1)
        setOpen(keepOpen)
      },
      [onChange, selectedTags]
    )

    const focusInput = () => {
      inputRef.current?.focus()
    }
    const handleInputBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      onInputBlur?.(event)
      if (keepOpenOnBlurRef.current) return
      const relatedTarget = event.relatedTarget
      const staysOnTagControl =
        relatedTarget instanceof Element &&
        wrapperRef.current?.contains(relatedTarget) &&
        relatedTarget.closest('button') !== null
      if (!staysOnTagControl && !event.currentTarget.contains(relatedTarget as Node | null)) {
        dismiss()
      }
    }

    const handleTagRemove = (tag: string) => {
      armKeepOpen()
      onChange(selectedTags.filter((item) => item !== tag))
      setOpen(true)
      focusInput()
      scheduleKeepOpenReset()
    }

    const handleTagRemovePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      armKeepOpen()
      event.preventDefault()
      setOpen(true)
      focusInput()
    }
    const handleWrapperClick = () => {
      if (disabled) return
      armKeepOpen()
      focusInput()
      setOpen(true)
      scheduleKeepOpenReset()
    }

    const handleWrapperPointerDownCapture = () => {
      if (disabled) return
      armKeepOpen()
      focusInput()
      setOpen(true)
    }

    const handleWrapperPointerCancel = () => {
      keepOpenOnBlurRef.current = false
      if (keepOpenResetTimerRef.current !== undefined) {
        window.clearTimeout(keepOpenResetTimerRef.current)
        keepOpenResetTimerRef.current = undefined
      }
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(event.target.value)
      setOpen(true)
      setHighlightedIndex(-1)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.nativeEvent.isComposing || isComposingRef.current) return

      if (event.key === 'ArrowDown') {
        if (!filteredSuggestions.length) return
        event.preventDefault()
        setOpen(true)
        setHighlightedIndex((previous) =>
          previous < filteredSuggestions.length - 1 ? previous + 1 : 0
        )
        return
      }

      if (event.key === 'ArrowUp') {
        if (!filteredSuggestions.length) return
        event.preventDefault()
        setOpen(true)
        setHighlightedIndex((previous) =>
          previous > 0 ? previous - 1 : filteredSuggestions.length - 1
        )
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (listboxOpen && highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
          updateTags([filteredSuggestions[highlightedIndex]], true)
          return
        }
        updateTags(normalizeStringListInput(inputValue), filteredSuggestions.length > 0)
        return
      }

      if (event.key === 'Escape') {
        if (!listboxOpen) return
        event.preventDefault()
        dismiss()
        return
      }

      if (event.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
        event.preventDefault()
        onChange(selectedTags.slice(0, -1))
      }
    }
    const handleCompositionStart = (event: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = true
      onCompositionStart?.(event)
    }

    const handleCompositionEnd = (event: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false
      onCompositionEnd?.(event)
    }

    const handleSuggestionPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      focusInput()
    }

    return (
      <Popover
        open={listboxOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !keepOpenOnBlurRef.current) dismiss()
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={wrapperRef}
            onPointerDownCapture={handleWrapperPointerDownCapture}
            onPointerCancel={handleWrapperPointerCancel}
            onClick={handleWrapperClick}
            className={cn(
              'relative flex min-h-10 w-full min-w-0 items-center gap-1 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-0.5 text-sm text-text-primary transition-colors focus-within:border-brand-gold focus-within:shadow-[var(--book-focus-ring)]',
              listboxOpen && 'z-20',
              disabled && 'cursor-not-allowed opacity-50',
              className
            )}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="theme-tag inline-flex max-w-full shrink-0 items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs"
                >
                  <span className="min-w-0 break-words">{tag}</span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`删除标签：${tag}`}
                    className="h-6 w-6 min-h-6 min-w-6 shrink-0 border-0 p-0 text-current hover:bg-transparent"
                    onPointerDown={handleTagRemovePointerDown}
                    onClick={() => handleTagRemove(tag)}
                    disabled={disabled}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </IconButton>
                </span>
              ))}
              <PopoverTrigger asChild key="tag-input">
                <Input
                  {...inputProps}
                  ref={(node) => {
                    inputRef.current = node
                    if (typeof forwardedRef === 'function') {
                      forwardedRef(node)
                    } else if (forwardedRef) {
                      forwardedRef.current = node
                    }
                  }}
                  id={id}
                  type="text"
                  value={inputValue}
                  disabled={disabled}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-controls={listboxId}
                  aria-expanded={listboxOpen}
                  aria-activedescendant={
                    highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length
                      ? `${listboxId}-option-${highlightedIndex}`
                      : undefined
                  }
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={(event) => {
                    setOpen(true)
                    onFocus?.(event)
                  }}
                  onBlur={handleInputBlur}
                  onClick={(event) => {
                    event.preventDefault()
                    setOpen(true)
                    onInputClick?.(event)
                  }}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm shadow-none focus:border-transparent focus:shadow-none"
                />
              </PopoverTrigger>
            </div>
          </div>
        </PopoverAnchor>
        {listboxOpen && (
          <PopoverContent
            id={listboxId}
            role="listbox"
            aria-label="已有标签"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => {
              if (
                keepOpenOnBlurRef.current ||
                wrapperRef.current?.contains(event.detail.originalEvent.target as Node)
              ) {
                event.preventDefault()
              }
            }}
            onFocusOutside={(event) => {
              if (keepOpenOnBlurRef.current || wrapperRef.current?.contains(event.target as Node)) {
                event.preventDefault()
              }
            }}
            onInteractOutside={(event) => {
              if (keepOpenOnBlurRef.current || wrapperRef.current?.contains(event.target as Node)) {
                event.preventDefault()
              }
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {filteredSuggestions.map((tag, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                key={tag}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                disabled={disabled}
                data-press-feedback="ripple"
                className={cn(
                  'flex min-h-8 w-full items-center rounded border-b border-[var(--book-ink-line)] px-2 py-1 text-left text-sm transition-colors last:border-0',
                  index === highlightedIndex
                    ? 'bg-[var(--color-theme-surface-alt)] text-brand-gold'
                    : 'bg-[var(--color-theme-surface)] text-text-primary hover:bg-[var(--color-theme-surface-alt)] hover:text-brand-gold'
                )}
                onPointerDown={handleSuggestionPointerDown}
                onClick={() => updateTags([tag], true)}
              >
                {tag}
              </button>
            ))}
          </PopoverContent>
        )}
      </Popover>
    )
  }
)

TagInput.displayName = 'TagInput'
