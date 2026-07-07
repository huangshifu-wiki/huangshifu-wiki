import React, { useState } from 'react'
import { ExternalLink, Loader2, Search, X, Check, AlertCircle } from '@/src/components/icons'
import { clsx } from 'clsx'

import { apiGet } from '../lib/apiClient'
import { formatMusicCredits } from '../lib/musicCredits'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

type Platform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo'

type MatchSuggestion = {
  sourceId: string
  title: string
  artists: string[]
  album: string
  cover: string
  sourceUrl: string
  score: number
  isAutoSelected: boolean
  alreadyLinked: { docId: string; title: string } | null
}

type MatchSuggestionsResponse = {
  suggestions: MatchSuggestion[]
  autoSelectedIndex: number | null
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

const platformLabels: Record<Platform, string> = {
  netease: '网易云音乐',
  tencent: 'QQ音乐',
  kugou: '酷狗音乐',
  baidu: '百度音乐',
  kuwo: '酷我音乐',
}

function buildPlatformSongUrl(platform: Platform, id: string): string {
  if (platform === 'netease') return `https://music.163.com/song?id=${id}`
  if (platform === 'tencent') return `https://y.qq.com/n/ryqq/songDetail/${id}`
  if (platform === 'kugou') return `https://www.kugou.com/song/#hash=${id}`
  if (platform === 'baidu') return `https://music.baidu.com/song/${id}`
  return `https://www.kuwo.cn/song_detail/${id}`
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
  const presence = useFloatingPresence(open)
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

  React.useEffect(() => {
    if (searched && suggestions.length > 0) {
      const autoIdx = suggestions.findIndex((s) => s.isAutoSelected)
      if (autoIdx >= 0) {
        setSelectedIndex(autoIdx)
      }
    }
  }, [searched, suggestions])

  const handleSearch = async () => {
    setLoading(true)
    setError('')
    setSearched(false)
    try {
      const data = await apiGet<MatchSuggestionsResponse>('/api/music/match-suggestions', {
        platform: targetPlatform,
        title,
        artist,
      })
      setSuggestions(data.suggestions || [])
      setSearched(true)
      if (data.suggestions.length === 0) {
        setError(`在${platformLabels[targetPlatform]}未找到匹配歌曲`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败')
      setSuggestions([])
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    if (selectedIndex === null) return
    onSelect(suggestions[selectedIndex].sourceId)
    onClose()
  }

  if (!presence.mounted) return null

  return (
    <div
      className="floating-overlay fixed inset-0 z-[130] bg-black/40 p-4 flex items-center justify-center"
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className="floating-panel w-full max-w-lg max-h-[90vh] overflow-hidden bg-[var(--book-panel-bg-strong)] rounded border border-[var(--book-ink-line)] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <header className="px-5 py-4 border-b border-[var(--book-ink-line)] flex items-center justify-between">
          <div>
            <h3
              className="text-base font-semibold text-text-primary tracking-[0.06em]"
              style={{ fontFamily: 'var(--book-title-font)' }}
            >
              搜索匹配歌曲
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              在{platformLabels[targetPlatform]}搜索：{title} - {artist}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
          >
            <X size={18} />
          </button>
        </header>

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
                <button
                  key={suggestion.sourceId}
                  onClick={() => setSelectedIndex(index)}
                  className={clsx(
                    'w-full text-left p-3 rounded border transition-all duration-300',
                    selectedIndex === index
                      ? 'border-brand-gold bg-[color-mix(in_srgb,var(--color-theme-accent)_8%,transparent)]'
                      : 'border-[var(--book-ink-line)] hover:border-brand-gold/50 hover:bg-surface-alt'
                  )}
                >
                  <div className="flex items-center gap-3">
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
                    <a
                      href={buildPlatformSongUrl(targetPlatform, suggestion.sourceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 text-text-muted hover:text-brand-gold transition-colors shrink-0"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </div>
                </button>
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-[var(--book-ink-line)] text-sm text-text-secondary hover:text-brand-gold hover:border-brand-gold/50 transition-all duration-300"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIndex === null || loading}
            className="px-5 py-2 rounded theme-button-primary font-medium disabled:opacity-50 inline-flex items-center gap-2 text-sm transition-all"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? '处理中…' : '确认'}
          </button>
        </footer>
      </div>
    </div>
  )
}
