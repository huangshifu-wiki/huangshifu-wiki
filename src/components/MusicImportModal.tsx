import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Link2,
  X,
} from '@/src/components/icons'
import { Checkbox } from '@/src/components/ui'
import { clsx } from 'clsx'

import { apiPost, invalidateMusicApiCaches } from '../lib/apiClient'
import { formatMusicCredits } from '../lib/musicCredits'
import { validateRequiredText, validateUrl } from '../lib/clientValidation'
import { getMusicPlatformLabel } from '../lib/musicPlatformUrls'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import { isBackdropClick } from '../utils/modal'
import {
  BookEditorSection,
  BookFormField,
  bookCompactInputClass,
  bookPanelClass,
  bookSecondaryButtonClass,
  bookSmallButtonClass,
} from './BookEditor'
import type { Platform } from '../types/common'

type ResourceType = 'song' | 'album' | 'playlist'
type FilterTab = 'all' | 'new' | 'fillable' | 'conflict' | 'identical'

type SongImportMatchStatus = 'new' | 'identical' | 'fillable' | 'conflict'
type SongImportDiffFieldStatus = 'same' | 'fill' | 'conflict'

type SongImportFieldDiff = {
  field:
    | 'title'
    | 'artists'
    | 'album'
    | 'externalSource'
    | 'cover'
    | 'duration'
    | 'releaseDate'
    | 'lyric'
  label: string
  status: SongImportDiffFieldStatus
  existingValue: string | null
  incomingValue: string | null
}

type SongImportExistingSong = {
  docId: string
  slug: string
  title: string
  artists: string[]
  album: string
  hasCover: boolean
  hasLyric: boolean
  durationMs: number | null
  releaseDate: string | null
  externalSources: Array<{ platform: string; sourceId: string }>
}

type SongImportMatchResult = {
  status: SongImportMatchStatus
  matchType: 'source' | 'title_artist' | 'none'
  existingSong: SongImportExistingSong | null
  diffs: SongImportFieldDiff[]
}

type SongImportMatchSummary = {
  newCount: number
  fillableCount: number
  conflictCount: number
  identicalCount: number
}

const EMPTY_MATCH_SUMMARY: SongImportMatchSummary = {
  newCount: 0,
  fillableCount: 0,
  conflictCount: 0,
  identicalCount: 0,
}

const MATCH_BADGES: Record<SongImportMatchStatus, { text: string; className: string }> = {
  new: {
    text: '新歌',
    className:
      'border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  conflict: {
    text: '存在差异',
    className: 'border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  fillable: {
    text: '可补全',
    className: 'border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  identical: {
    text: '无变化',
    className: 'border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-muted',
  },
}

type PreviewSong = {
  sourceId: string
  title: string
  artists: string[]
  album: string
  cover: string
  sourceUrl: string
  match?: SongImportMatchResult
}

type ParsedResource = {
  platform: Platform
  type: ResourceType
  id: string
  title: string
  artist: string
  cover: string
  description: string
  platformUrl: string
  songs: PreviewSong[]
  totalSongs: number
  matchSummary?: SongImportMatchSummary
}

type ParseUrlResponse = {
  resource: ParsedResource
}

type ImportResponse = {
  summary: {
    imported: number
    skipped: number
    failed: number
  }
  collection?: {
    docId: string
    title: string
  } | null
}

interface MusicImportModalProps {
  open: boolean
  onClose: () => void
  onImported: () => Promise<void> | void
}

function resourceTypeLabel(type: ResourceType) {
  if (type === 'song') return '歌曲'
  if (type === 'album') return '专辑'
  return '歌单'
}

function getDiffSummary(diffs: SongImportFieldDiff[]): string[] {
  const summaries: string[] = []
  for (const diff of diffs) {
    if (diff.status === 'fill') {
      if (diff.field === 'externalSource') summaries.push('+平台外链')
      else if (diff.field === 'album') summaries.push('+专辑')
      else if (diff.field === 'cover') summaries.push('+封面')
      else if (diff.field === 'lyric') summaries.push('+歌词')
      else if (diff.field === 'duration') summaries.push('+时长')
      else if (diff.field === 'releaseDate') summaries.push('+发行时间')
    } else if (diff.status === 'conflict') {
      if (diff.field === 'title') summaries.push('标题差异')
      else if (diff.field === 'artists') summaries.push('歌手差异')
      else if (diff.field === 'album') summaries.push('专辑差异')
      else if (diff.field === 'duration') summaries.push('时长差异>5s')
      else if (diff.field === 'releaseDate') summaries.push('发行时间不同')
    }
  }
  return summaries
}

export const MusicImportModal = ({ open, onClose, onImported }: MusicImportModalProps) => {
  const presence = useFloatingPresence(open)
  const [url, setUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<ParsedResource | null>(null)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmingImport, setConfirmingImport] = useState(false)
  const [importResult, setImportResult] = useState<string>('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [expandedDiffIds, setExpandedDiffIds] = useState<Set<string>>(new Set())
  const songs = preview?.songs
  const filteredSongs = useMemo(() => {
    if (!songs || activeTab === 'all') return songs ?? []
    return songs.filter((song) => (song.match?.status || 'new') === activeTab)
  }, [activeTab, songs])

  const { selectedNewCount, selectedFillableCount, selectedConflictCount, selectedIdenticalCount } =
    useMemo(() => {
      let selectedNewCount = 0
      let selectedFillableCount = 0
      let selectedConflictCount = 0
      let selectedIdenticalCount = 0
      for (const song of songs ?? []) {
        if (!selectedIds.has(song.sourceId)) continue
        const status = song.match?.status ?? 'new'
        if (status === 'new') selectedNewCount += 1
        else if (status === 'fillable') selectedFillableCount += 1
        else if (status === 'conflict') selectedConflictCount += 1
        else selectedIdenticalCount += 1
      }
      return {
        selectedNewCount,
        selectedFillableCount,
        selectedConflictCount,
        selectedIdenticalCount,
      }
    }, [selectedIds, songs])

  const selectedCount = selectedIds.size

  if (!presence.mounted) return null

  const resetResult = () => {
    if (importResult) setImportResult('')
    if (confirmingImport) setConfirmingImport(false)
  }

  const handleParse = async () => {
    const urlError =
      validateRequiredText(url, 'url', '音乐链接') || validateUrl(url, 'url', '音乐链接')
    if (urlError) {
      setError(urlError.message)
      return
    }
    setParsing(true)
    if (error) setError('')
    if (importResult) setImportResult('')
    if (confirmingImport) setConfirmingImport(false)
    if (activeTab !== 'all') setActiveTab('all')
    if (expandedDiffIds.size) setExpandedDiffIds(new Set())
    try {
      const response = await apiPost<ParseUrlResponse>('/api/music/parse-url', { url: url.trim() })
      setPreview(response.resource)
      // 智能默认勾选：仅默认勾选新歌、可补全或有差异的歌曲，对于完全一致无变化的歌曲默认不勾选
      const defaultSelected = new Set(
        response.resource.songs
          .filter((song) => {
            const status = song.match?.status || 'new'
            return status !== 'identical'
          })
          .map((song) => song.sourceId)
      )
      // 如果全部都是 identical，则兜底全部勾选
      if (defaultSelected.size === 0 && response.resource.songs.length > 0) {
        setSelectedIds(new Set(response.resource.songs.map((song) => song.sourceId)))
      } else {
        setSelectedIds(defaultSelected)
      }
    } catch (err) {
      setPreview(null)
      setSelectedIds(new Set())
      setError(err instanceof Error ? err.message : '解析链接失败')
    } finally {
      setParsing(false)
    }
  }

  const setSongSelected = (sourceId: string, selected: boolean) => {
    resetResult()
    setSelectedIds((prev) => {
      if (prev.has(sourceId) === selected) return prev
      const next = new Set(prev)
      if (selected) next.add(sourceId)
      else next.delete(sourceId)
      return next
    })
  }

  const handleSelectAllCurrentTab = () => {
    if (!preview) return
    resetResult()
    const targetSongs = filteredSongs
    setSelectedIds((prev) => {
      let next: Set<string> | null = null
      for (const song of targetSongs) {
        if (!prev.has(song.sourceId)) {
          next ??= new Set(prev)
          next.add(song.sourceId)
        }
      }
      return next ?? prev
    })
  }

  const handleSelectNoneCurrentTab = () => {
    if (!preview) return
    resetResult()
    setSelectedIds((prev) => {
      let next: Set<string> | null = null
      for (const song of filteredSongs) {
        if (prev.has(song.sourceId)) {
          next ??= new Set(prev)
          next.delete(song.sourceId)
        }
      }
      return next ?? prev
    })
  }

  const matchSummary = preview?.matchSummary ?? EMPTY_MATCH_SUMMARY

  const toggleDiffExpand = (sourceId: string) => {
    setExpandedDiffIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const handleFinalImport = async () => {
    if (!preview) return
    if (!selectedCount) {
      setError('请至少选择一首歌曲')
      return
    }
    setImporting(true)
    if (error) setError('')
    if (importResult) setImportResult('')
    try {
      const response = await apiPost<ImportResponse>('/api/music/import', {
        url: url.trim() || preview.platformUrl,
        selectedSongIds: [...selectedIds],
        duplicateStrategy: 'fill',
      })
      const summary = response.summary
      const parts = [`导入成功 ${summary.imported} 首`]
      if (summary.skipped) parts.push(`跳过/已存在 ${summary.skipped} 首`)
      if (summary.failed) parts.push(`失败 ${summary.failed} 首`)
      if (response.collection) parts.push(`已更新专辑：${response.collection.title}`)
      setImportResult(parts.join('，'))
      invalidateMusicApiCaches()
      setConfirmingImport(false)
      await onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className="floating-overlay fixed inset-0 z-[120] flex items-center justify-center bg-[var(--ui-overlay-bg)] p-4"
      data-state={presence.state}
      aria-hidden={!open}
      onClick={(event) => {
        if (isBackdropClick(event)) onClose()
      }}
    >
      <div className="floating-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--book-ink-line)] px-5 py-4 md:px-6">
          <div>
            <h3
              className="text-base font-semibold tracking-[0.06em] text-text-primary"
              style={{ fontFamily: 'var(--book-title-font)' }}
            >
              导入音乐 / 专辑 / 歌单
            </h3>
            <p className="mt-0.5 text-xs tracking-[0.04em] text-text-muted">
              智能比对曲库已有歌曲，直观展现补全与差异项；确认后安全写入
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-text-muted transition-colors hover:bg-[var(--book-panel-hover)] hover:text-text-primary"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-6 overflow-y-auto px-5 py-4 md:px-6">
          <BookEditorSection title="资源链接" className="border-t-0 pt-0">
            <div className={`${bookPanelClass} p-4`}>
              <BookFormField label="粘贴链接">
                <div className="flex flex-col gap-2 md:flex-row">
                  <div className="relative flex-1">
                    <Link2
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                    />
                    <input
                      value={url}
                      onChange={(event) => {
                        setUrl(event.target.value)
                        if (error) setError('')
                      }}
                      placeholder="例如: https://music.163.com/#/playlist?id=3778678"
                      className={`${bookCompactInputClass} pl-9`}
                    />
                  </div>
                  <button
                    onClick={handleParse}
                    disabled={parsing}
                    className="inline-flex items-center justify-center gap-2 rounded px-5 py-2 text-sm font-medium theme-button-primary transition-all disabled:opacity-50"
                  >
                    {parsing ? <Loader2 size={14} className="animate-spin" /> : null}
                    {parsing ? '解析中' : '解析链接'}
                  </button>
                </div>
                {error ? <p className="mt-2 text-sm theme-text-error">{error}</p> : null}
              </BookFormField>
            </div>
          </BookEditorSection>

          {preview && (
            <BookEditorSection title="导入预览与比对">
              <div className="space-y-4">
                <div className={`${bookPanelClass} space-y-4 p-4`}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)]">
                        {preview.cover && (
                          <img
                            src={preview.cover}
                            alt="封面"
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-muted">
                          {getMusicPlatformLabel(preview.platform)} ·{' '}
                          {resourceTypeLabel(preview.type)}
                        </p>
                        <h4 className="truncate text-base font-bold text-text-primary">
                          {preview.title}
                        </h4>
                        <p className="truncate text-sm text-text-secondary">{preview.artist}</p>
                      </div>
                    </div>
                    <a
                      href={preview.platformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={bookSmallButtonClass}
                    >
                      查看原始页面
                    </a>
                  </div>

                  {preview.description && (
                    <p className="rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] p-3 text-sm text-text-secondary">
                      {preview.description}
                    </p>
                  )}
                </div>

                {/* 状态过滤与快捷统计 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--book-ink-line)] pb-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setActiveTab('all')}
                      className={clsx(
                        'rounded px-2.5 py-1 font-medium transition-colors',
                        activeTab === 'all'
                          ? 'bg-[var(--color-theme-accent)] text-white'
                          : 'bg-[var(--book-panel-bg)] text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-text-primary'
                      )}
                    >
                      全部 ({preview.totalSongs})
                    </button>
                    <button
                      onClick={() => setActiveTab('new')}
                      className={clsx(
                        'rounded px-2.5 py-1 font-medium transition-colors',
                        activeTab === 'new'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[var(--book-panel-bg)] text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                      )}
                    >
                      新歌 ({matchSummary.newCount})
                    </button>
                    <button
                      onClick={() => setActiveTab('fillable')}
                      className={clsx(
                        'rounded px-2.5 py-1 font-medium transition-colors',
                        activeTab === 'fillable'
                          ? 'bg-sky-600 text-white'
                          : 'bg-[var(--book-panel-bg)] text-sky-600 hover:bg-sky-500/10 dark:text-sky-400'
                      )}
                    >
                      可补全 ({matchSummary.fillableCount})
                    </button>
                    <button
                      onClick={() => setActiveTab('conflict')}
                      className={clsx(
                        'rounded px-2.5 py-1 font-medium transition-colors',
                        activeTab === 'conflict'
                          ? 'bg-amber-600 text-white'
                          : 'bg-[var(--book-panel-bg)] text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
                      )}
                    >
                      存在差异 ({matchSummary.conflictCount})
                    </button>
                    <button
                      onClick={() => setActiveTab('identical')}
                      className={clsx(
                        'rounded px-2.5 py-1 font-medium transition-colors',
                        activeTab === 'identical'
                          ? 'bg-[var(--book-ink-line)] text-text-primary'
                          : 'bg-[var(--book-panel-bg)] text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-text-primary'
                      )}
                    >
                      无变化 ({matchSummary.identicalCount})
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">已勾选 {selectedCount} 首</span>
                    <button onClick={handleSelectAllCurrentTab} className={bookSmallButtonClass}>
                      勾选本栏
                    </button>
                    <button onClick={handleSelectNoneCurrentTab} className={bookSmallButtonClass}>
                      取消本栏
                    </button>
                  </div>
                </div>

                {/* 歌曲列表 */}
                <div className="max-h-80 space-y-2 overflow-y-auto rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] p-2">
                  {filteredSongs.length === 0 ? (
                    <div className="py-8 text-center text-sm text-text-muted">该状态下暂无歌曲</div>
                  ) : (
                    filteredSongs.map((song, index) => {
                      const checked = selectedIds.has(song.sourceId)
                      const isExpanded = expandedDiffIds.has(song.sourceId)
                      const badge = MATCH_BADGES[song.match?.status ?? 'new']
                      const diffSummaries = song.match ? getDiffSummary(song.match.diffs) : []

                      return (
                        <div
                          key={`${song.sourceId}-${index}`}
                          className={clsx(
                            'rounded border border-[var(--book-ink-line)] transition-colors',
                            checked
                              ? 'bg-[color-mix(in_srgb,var(--color-theme-accent)_6%,transparent)]'
                              : 'bg-[var(--book-panel-bg)]'
                          )}
                        >
                          <div className="flex items-center gap-3 p-3">
                            <Checkbox
                              id={`music-import-selection-${song.sourceId}-${index}`}
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                setSongSelected(song.sourceId, nextChecked === true)
                              }
                              className="h-4 w-4"
                              aria-label={`选择 ${song.title}`}
                            />

                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)]">
                              {song.cover ? (
                                <img
                                  src={song.cover}
                                  alt="封面"
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                />
                              ) : null}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-medium text-text-primary">
                                  {song.title}
                                </span>
                                <span
                                  className={clsx(
                                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                                    badge.className
                                  )}
                                >
                                  {badge.text}
                                </span>
                                {diffSummaries.map((summary, idx) => (
                                  <span
                                    key={idx}
                                    className="rounded bg-[var(--book-panel-hover)] px-1.5 py-0.5 text-[10px] text-text-muted"
                                  >
                                    {summary}
                                  </span>
                                ))}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-text-muted">
                                {formatMusicCredits(song.artists, '未知歌手')} · {song.album}
                                {song.match?.existingSong ? (
                                  <span className="ml-2 text-text-secondary">
                                    (匹配已有: #
                                    {song.match.existingSong.slug || song.match.existingSong.docId}
                                    《{song.match.existingSong.title}》)
                                  </span>
                                ) : null}
                              </p>
                            </div>

                            {song.match && song.match.status !== 'new' && (
                              <button
                                type="button"
                                onClick={() => toggleDiffExpand(song.sourceId)}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-[var(--book-panel-hover)] hover:text-text-primary"
                                aria-label={isExpanded ? '收起差异对比' : '展开差异对比'}
                              >
                                <span>{isExpanded ? '收起对比' : '差异对比'}</span>
                                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              </button>
                            )}
                          </div>

                          {/* 差异比对折叠面板 */}
                          {isExpanded && song.match && song.match.existingSong && (
                            <div className="border-t border-[var(--book-ink-line)] bg-[var(--book-panel-hover)] px-4 py-3 text-xs">
                              <div className="mb-2 flex items-center justify-between text-text-muted">
                                <span>
                                  匹配依据：
                                  {song.match.matchType === 'source'
                                    ? '平台外部ID精确命中'
                                    : '歌曲名称与演唱歌手完全一致'}
                                </span>
                                <span>
                                  目标条目：#
                                  {song.match.existingSong.slug || song.match.existingSong.docId}
                                </span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                  <thead>
                                    <tr className="border-b border-[var(--book-ink-line)] text-text-muted">
                                      <th className="pb-1 font-medium">比对字段</th>
                                      <th className="pb-1 font-medium">曲库现有值 (Existing)</th>
                                      <th className="pb-1 font-medium">平台导入值 (Incoming)</th>
                                      <th className="pb-1 font-medium">状态</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[var(--book-ink-line)]">
                                    {song.match.diffs.map((diff, dIdx) => {
                                      let statusBadge = (
                                        <span className="text-text-muted">一致</span>
                                      )
                                      if (diff.status === 'fill') {
                                        statusBadge = (
                                          <span className="font-medium text-sky-600 dark:text-sky-400">
                                            待补全
                                          </span>
                                        )
                                      } else if (diff.status === 'conflict') {
                                        statusBadge = (
                                          <span className="font-medium text-amber-600 dark:text-amber-400">
                                            存在差异
                                          </span>
                                        )
                                      }
                                      return (
                                        <tr
                                          key={dIdx}
                                          className={clsx(
                                            diff.status === 'conflict' && 'bg-amber-500/5',
                                            diff.status === 'fill' && 'bg-sky-500/5'
                                          )}
                                        >
                                          <td className="py-1.5 font-medium text-text-secondary">
                                            {diff.label}
                                          </td>
                                          <td className="max-w-[200px] truncate py-1.5 text-text-muted">
                                            {diff.existingValue || '-'}
                                          </td>
                                          <td className="max-w-[200px] truncate py-1.5 text-text-primary">
                                            {diff.incomingValue || '-'}
                                          </td>
                                          <td className="py-1.5">{statusBadge}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {importResult ? (
                  <div className="flex items-center gap-2 rounded border px-4 py-3 text-sm theme-bg-success-soft theme-border-success-soft theme-text-success">
                    <CheckCircle2 size={15} />
                    <span>{importResult}</span>
                  </div>
                ) : null}

                {!importResult &&
                  (!confirmingImport ? (
                    <button
                      onClick={() => {
                        if (!selectedCount) {
                          setError('请至少选择一首歌曲')
                          return
                        }
                        setConfirmingImport(true)
                        if (error) setError('')
                      }}
                      className="rounded px-5 py-2 text-sm font-medium theme-button-primary transition-all"
                    >
                      下一步：确认导入
                    </button>
                  ) : (
                    <div className="space-y-3 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-text-primary">
                      <div className="flex items-start gap-2 text-sm">
                        <AlertTriangle
                          size={17}
                          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                        />
                        <div className="space-y-1">
                          <p className="font-semibold">即将导入已勾选的 {selectedCount} 首歌曲：</p>
                          <ul className="list-disc pl-4 text-xs text-text-secondary">
                            <li>全新收录：{selectedNewCount} 首</li>
                            <li>匹配已有并补全外链/信息：{selectedFillableCount} 首</li>
                            {selectedConflictCount > 0 && (
                              <li className="text-amber-600 dark:text-amber-400">
                                存在字段差异（将安全保留已有非空字段）：{selectedConflictCount} 首
                              </li>
                            )}
                            {selectedIdenticalCount > 0 && (
                              <li>完全一致无变化：{selectedIdenticalCount} 首</li>
                            )}
                          </ul>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={handleFinalImport}
                          disabled={importing}
                          className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium theme-button-primary transition-all disabled:opacity-50"
                        >
                          {importing ? <Loader2 size={14} className="animate-spin" /> : null}
                          {importing ? '导入中' : '最终确认导入'}
                        </button>
                        <button
                          onClick={() => setConfirmingImport(false)}
                          className={bookSecondaryButtonClass}
                        >
                          返回修改
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </BookEditorSection>
          )}
        </div>

        <footer className="flex justify-end border-t border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-5 py-3 pb-safe md:px-6">
          <button onClick={onClose} className={bookSecondaryButtonClass}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
