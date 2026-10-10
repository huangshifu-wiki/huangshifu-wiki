import React, { useRef, useState } from 'react'
import { ExternalLink, Loader2, Search, Check, AlertCircle } from '@/src/components/icons'
import { clsx } from 'clsx'

import { apiGet } from '../lib/apiClient'
import { formatMusicCredits } from '../lib/musicCredits'
import { getMusicPlatformLabel, getPlatformExternalUrl } from '../lib/musicPlatformUrls'
import { Button, Dialog, DialogContent } from '@/src/components/ui'
import type { Platform } from '../types/common'

type MatchSuggestion = {
  sourceId: string
  title: string
  artists: string[]
  album: string
  cover: string
  score: number
  isAutoSelected: boolean
  alreadyLinked: { docId: string; title: string } | null
}

interface MatchSuggestionModalProps {
  open: boolean
  onClose: () => void
  title: string
  artist: string
  targetPlatform: Platform
  existingPlatformId?: string | null
  onSelect: (sourceId: string) => void
}

export const MatchSuggestionModal = ({
  open,
  onClose,
  title,
  artist,
  targetPlatform,
  existingPlatformId,
  onSelect,
}: MatchSuggestionModalProps) => {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([])
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  React.useEffect(() => {
    if (open && !searched) {
      handleSearch()
    }
  }, [open])

  React.useEffect(() => {
    if (!open) {
      setSuggestions([])
      setSearched(false)
      setError('')
      setSelectedIndex(null)
    }
  }, [open])

  const handleSearch = async () => {
    setLoading(true)
    setError('')
    setSearched(false)
    try {
      const data = await apiGet<{ suggestions: MatchSuggestion[] }>(
        '/api/music/match-suggestions',
        { platform: targetPlatform, title, artist }
      )
      setSuggestions(data.suggestions)
      const autoIdx = data.suggestions.findIndex((suggestion) => suggestion.isAutoSelected)
      setSelectedIndex(autoIdx >= 0 ? autoIdx : null)
      if (data.suggestions.length === 0) {
        setError(`在${getMusicPlatformLabel(targetPlatform)}未找到匹配歌曲`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败')
      setSuggestions([])
    } finally {
      setSearched(true)
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    if (selectedIndex === null) return
    onSelect(suggestions[selectedIndex].sourceId)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        title="搜索匹配歌曲"
        description={`在${getMusicPlatformLabel(targetPlatform)}搜索：${title} - ${artist}`}
        className="flex max-h-[90vh] flex-col overflow-hidden"
        onOpenAutoFocus={() => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
        }}
      >
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-brand-gold" />
              <span className="ml-3 text-sm text-text-secondary">搜索中…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2 p-3 rounded theme-status-error text-sm">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {searched && suggestions.length > 0 && !loading && (
            <div className="space-y-2">
              {suggestions.map((suggestion, index) => (
                <div key={suggestion.sourceId} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSelectedIndex(index)}
                    aria-pressed={selectedIndex === index}
                    className={clsx(
                      'h-auto w-full justify-start gap-3 whitespace-normal text-left p-3 transition-all duration-300',
                      selectedIndex === index
                        ? 'border-brand-gold bg-[color-mix(in_srgb,var(--color-theme-accent)_8%,transparent)]'
                        : 'border-[var(--book-ink-line)] hover:border-brand-gold/50 hover:bg-surface-alt'
                    )}
                  >
                    <div
                      className={clsx(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                        selectedIndex === index
                          ? 'border-brand-gold bg-brand-gold'
                          : 'border-border'
                      )}
                    >
                      {selectedIndex === index && <Check size={12} className="text-white" />}
                    </div>
                    <img
                      src={suggestion.cover}
                      alt=""
                      className="w-11 h-11 rounded object-cover shrink-0 border border-[var(--book-ink-line)] shadow-[0_1px_4px_rgba(42,37,32,0.08)]"
                      style={{ filter: 'brightness(0.96) saturate(0.92)' }}
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {suggestion.title}
                      </p>
                      <p className="text-xs text-text-muted truncate">
                        {formatMusicCredits(suggestion.artists, '未知歌手')} · {suggestion.album}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={clsx(
                            'text-[10px] px-1.5 py-0.5 rounded',
                            suggestion.score >= 80
                              ? 'theme-status-success'
                              : suggestion.score >= 60
                                ? 'theme-status-warning'
                                : 'bg-surface-alt text-text-muted'
                          )}
                        >
                          匹配度 {suggestion.score}%
                        </span>
                        {suggestion.alreadyLinked && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded theme-bg-info-soft theme-text-info">
                            已关联
                          </span>
                        )}
                        {suggestion.isAutoSelected && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded theme-tag">推荐</span>
                        )}
                      </div>
                    </div>
                  </Button>
                  <a
                    href={getPlatformExternalUrl(targetPlatform, suggestion.sourceId) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-text-muted hover:text-brand-gold transition-colors shrink-0"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              ))}
            </div>
          )}

          {searched && suggestions.length === 0 && !loading && !error && (
            <div className="text-center py-12 text-text-muted">
              <Search size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">未找到匹配歌曲</p>
            </div>
          )}

          {existingPlatformId && (
            <div className="p-3 rounded bg-surface-alt border border-[var(--book-ink-line)]">
              <p className="text-xs text-text-muted">
                该平台已有ID:{' '}
                <span className="font-mono font-medium text-text-primary">
                  {existingPlatformId}
                </span>
              </p>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[var(--book-ink-line)] bg-surface-alt/60 flex justify-end gap-3 pb-safe">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selectedIndex === null}
            loading={loading}
            loadingText="处理中…"
          >
            确认
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
