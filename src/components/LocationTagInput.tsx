import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, X, Loader2 } from '@/src/components/icons'
import { clsx } from 'clsx'
import { MapPickerModal, type PickedLocation } from './MapPickerModal'
import { apiGet, apiPost } from '../lib/apiClient'
import { resolveLocationTagInputEnterSelectionIndex } from '../lib/locationTagInput'
import { Popover, PopoverAnchor, PopoverContent } from '@/src/components/ui'

interface RegionSuggestion {
  code: string
  name: string
  fullName: string
  level: number
  levelName: string
  parentCode: string | null
}

interface LocationTagInputProps {
  value: string | null
  locationCode: string | null
  onChange: (fullName: string, code: string) => void
  onClear: () => void
  variant?: 'default' | 'book'
}

export const LocationTagInput = ({
  value,
  onChange,
  onClear,
  variant = 'default',
}: LocationTagInputProps) => {
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value || '')
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([])
      return
    }
    setLoading(true)
    try {
      const data = await apiGet<{ regions?: RegionSuggestion[] }>(
        `/api/regions/search?q=${encodeURIComponent(query)}&limit=10`
      )
      setSuggestions(data.regions || [])
    } catch (err) {
      console.error('Failed to fetch suggestions:', err)
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    setShowDropdown(true)
    setSelectedIndex(-1)
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      fetchSuggestions(newValue)
    }, 200)
  }

  const handleSelect = (region: RegionSuggestion) => {
    setInputValue(region.fullName)
    onChange(region.fullName, region.code)
    setShowDropdown(false)
    setSuggestions([])
    setSelectedIndex(-1)
  }

  const handleClear = () => {
    setInputValue('')
    onClear()
    setSuggestions([])
    setShowDropdown(false)
    setSelectedIndex(-1)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return

    switch (e.key) {
      case 'ArrowDown':
        if (!showDropdown || suggestions.length === 0) return
        e.preventDefault()
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        if (!showDropdown || suggestions.length === 0) return
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        {
          const selectedSuggestionIndex = resolveLocationTagInputEnterSelectionIndex({
            showDropdown,
            suggestionsLength: suggestions.length,
            selectedIndex,
          })

          if (selectedSuggestionIndex === null) {
            setShowDropdown(false)
            setSelectedIndex(-1)
            break
          }

          handleSelect(suggestions[selectedSuggestionIndex])
        }
        break
      case 'Escape':
        if (!showDropdown) return
        e.preventDefault()
        e.stopPropagation()
        setShowDropdown(false)
        setSelectedIndex(-1)
        break
    }
  }

  const handleMapConfirm = async (location: PickedLocation) => {
    try {
      const data = await apiPost<{
        result?: { adcode: string; province: string; city: string; district: string }
      }>('/api/regions/resolve', { lng: location.lng, lat: location.lat })
      if (data.result) {
        const displayName =
          location.address || `${data.result.province}${data.result.city}${data.result.district}`
        setInputValue(displayName)
        onChange(displayName, data.result.adcode)
      }
    } catch (err) {
      console.error('Failed to resolve location:', err)
    }
  }

  const handleFocus = () => {
    if (inputValue && suggestions.length > 0) {
      setShowDropdown(true)
    }
  }

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.relatedTarget as Node | null
    if (target && (anchorRef.current?.contains(target) || dropdownRef.current?.contains(target)))
      return
    setShowDropdown(false)
    setSelectedIndex(-1)
  }

  const isBook = variant === 'book'

  if (value && !inputValue) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium',
            isBook
              ? 'rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-secondary'
              : 'theme-tag rounded'
          )}
        >
          <MapPin size={11} />
          {value}
        </span>
        <button
          onClick={handleClear}
          className={clsx(
            'rounded p-0.5 transition-colors',
            isBook
              ? 'text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-brand-gold'
              : 'hover:bg-surface-alt'
          )}
          type="button"
        >
          <X size={11} className={isBook ? undefined : 'text-text-muted'} />
        </button>
      </div>
    )
  }

  return (
    <Popover
      open={showDropdown && suggestions.length > 0}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setShowDropdown(false)
          setSelectedIndex(-1)
        }
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} onBlurCapture={handleBlur} className="flex items-center gap-1">
          <div className="relative flex-1">
            <MapPin
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              placeholder="输入或选择地点..."
              className={clsx(
                'w-full rounded py-2.5 pl-9 pr-9 text-base',
                isBook
                  ? 'border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-gold'
                  : 'theme-input'
              )}
            />
            {loading && (
              <Loader2
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin"
              />
            )}
            {!loading && inputValue && (
              <button
                onClick={handleClear}
                className={clsx(
                  'absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5',
                  isBook
                    ? 'text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-brand-gold'
                    : 'hover:bg-surface-alt'
                )}
                type="button"
              >
                <X size={13} className={isBook ? undefined : 'text-text-muted'} />
              </button>
            )}
          </div>
          <button
            onClick={() => setMapPickerOpen(true)}
            className={clsx(
              'rounded border p-2 transition-all',
              isBook
                ? 'border-[var(--book-ink-line)] text-text-muted hover:border-brand-gold/50 hover:text-brand-gold'
                : 'border-border hover:border-brand-gold hover:text-brand-gold'
            )}
            type="button"
            title="在地图上选择"
          >
            <MapPin size={15} className={isBook ? undefined : 'text-text-muted'} />
          </button>
        </div>
      </PopoverAnchor>

      {showDropdown && suggestions.length > 0 && (
        <PopoverContent
          ref={dropdownRef}
          role="listbox"
          aria-label="地点候选"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className={clsx(
            'w-[var(--radix-popper-anchor-width)] max-h-[min(15rem,var(--radix-popover-content-available-height))] overflow-y-auto p-0',
            isBook && 'bg-[var(--book-panel-bg-strong)] shadow-[var(--book-panel-shadow)]'
          )}
        >
          {suggestions.map((region, index) => (
            <button
              key={region.code}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(region)}
              className={clsx(
                'w-full border-b px-4 py-3 text-left transition-colors last:border-b-0',
                isBook ? 'border-[var(--book-ink-line)]' : 'border-border',
                index === selectedIndex
                  ? isBook
                    ? 'bg-[var(--book-panel-hover)]'
                    : 'bg-surface-alt'
                  : isBook
                    ? 'hover:bg-[var(--book-panel-hover)]'
                    : 'hover:bg-surface-alt'
              )}
            >
              <div className="flex items-center gap-1.5">
                <MapPin size={11} className="text-brand-gold flex-shrink-0" />
                <span className="text-sm font-medium text-text-primary">{region.name}</span>
                <span
                  className={clsx(
                    'rounded px-1 text-[10px] text-text-muted',
                    isBook ? 'bg-[var(--book-panel-bg)]' : 'bg-surface-alt'
                  )}
                >
                  {region.levelName}
                </span>
              </div>
              <div className="text-xs text-text-muted mt-0.5 pl-[1.125rem]">{region.fullName}</div>
            </button>
          ))}
        </PopoverContent>
      )}

      <MapPickerModal
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        onConfirm={handleMapConfirm}
      />
    </Popover>
  )
}

export type { RegionSuggestion }
