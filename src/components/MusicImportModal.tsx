import React, { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Link2, X } from '@/src/components/icons'
import { Checkbox } from '@/src/components/ui'
import { clsx } from 'clsx'

import { apiPost } from '../lib/apiClient'
import { formatMusicCredits } from '../lib/musicCredits'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import {
  BookEditorSection,
  BookFormField,
  bookCompactInputClass,
  bookPanelClass,
  bookSecondaryButtonClass,
  bookSmallButtonClass,
} from './BookEditor'

type Platform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo'
type ResourceType = 'song' | 'album' | 'playlist'

type PreviewSong = {
  sourceId: string
  title: string
  artists: string[]
  album: string
  cover: string
  sourceUrl: string
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

function platformLabel(platform: Platform) {
  if (platform === 'netease') return '网易云音乐'
  if (platform === 'tencent') return 'QQ音乐'
  if (platform === 'kugou') return '酷狗音乐'
  if (platform === 'baidu') return '百度音乐'
  return '酷我音乐'
}

function resourceTypeLabel(type: ResourceType) {
  if (type === 'song') return '歌曲'
  if (type === 'album') return '专辑'
  return '歌单'
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

  const selectedCount = selectedIds.size

  if (!presence.mounted) return null

  const resetResult = () => {
    setImportResult('')
    setConfirmingImport(false)
  }

  const handleParse = async () => {
    if (!url.trim()) {
      setError('请先粘贴音乐链接')
      return
    }
    setParsing(true)
    setError('')
    setImportResult('')
    setConfirmingImport(false)
    try {
      const response = await apiPost<ParseUrlResponse>('/api/music/parse-url', { url: url.trim() })
      setPreview(response.resource)
      setSelectedIds(new Set(response.resource.songs.map((song) => song.sourceId)))
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
      const next = new Set(prev)
      if (selected) next.add(sourceId)
      else next.delete(sourceId)
      return next
    })
  }

  const handleSelectAll = () => {
    if (!preview) return
    resetResult()
    setSelectedIds(new Set(preview.songs.map((song) => song.sourceId)))
  }

  const handleSelectNone = () => {
    resetResult()
    setSelectedIds(new Set())
  }

  const handleFinalImport = async () => {
    if (!preview) return
    if (!selectedCount) {
      setError('请至少选择一首歌曲')
      return
    }
    setImporting(true)
    setError('')
    setImportResult('')
    try {
      const response = await apiPost<ImportResponse>('/api/music/import', {
        url: url.trim() || preview.platformUrl,
        selectedSongIds: [...selectedIds],
      })
      const summary = response.summary
      const parts = [`导入成功 ${summary.imported} 首`]
      if (summary.skipped) parts.push(`已存在 ${summary.skipped} 首`)
      if (summary.failed) parts.push(`失败 ${summary.failed} 首`)
      if (response.collection) parts.push(`已更新专辑：${response.collection.title}`)
      setImportResult(parts.join('，'))
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
      className="floating-overlay fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center"
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className="floating-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <header className="flex items-center justify-between border-b border-[var(--book-ink-line)] px-5 py-4 md:px-6">
          <div>
            <h3
              className="text-base font-semibold tracking-[0.06em] text-text-primary"
              style={{ fontFamily: 'var(--book-title-font)' }}
            >
              导入音乐 / 专辑 / 歌单
            </h3>
            <p className="mt-0.5 text-xs tracking-[0.04em] text-text-muted">
              粘贴链接后自动识别平台；导入前需二次确认
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
                        setError('')
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
            <BookEditorSection title="导入预览">
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
                          {platformLabel(preview.platform)} · {resourceTypeLabel(preview.type)}
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

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">
                    共 {preview.totalSongs} 首，已选择 {selectedCount} 首
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSelectAll} className={bookSmallButtonClass}>
                      全选
                    </button>
                    <button onClick={handleSelectNone} className={bookSmallButtonClass}>
                      清空
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)]">
                  {preview.songs.map((song, index) => {
                    const checked = selectedIds.has(song.sourceId)
                    return (
                      <label
                        key={`${song.sourceId}-${index}`}
                        htmlFor={`music-import-selection-${song.sourceId}-${index}`}
                        className={clsx(
                          'flex cursor-pointer items-center gap-3 border-b border-[var(--book-ink-line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--book-panel-hover)]',
                          checked &&
                            'bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]'
                        )}
                      >
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
                          {song.cover && (
                            <img
                              src={song.cover}
                              alt="封面"
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-primary">
                            {song.title}
                          </p>
                          <p className="truncate text-xs text-text-muted">
                            {formatMusicCredits(song.artists, '未知歌手')} · {song.album}
                          </p>
                        </div>
                      </label>
                    )
                  })}
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
                        setError('')
                      }}
                      className="rounded px-5 py-2 text-sm font-medium theme-button-primary transition-all"
                    >
                      下一步：确认导入
                    </button>
                  ) : (
                    <div className="space-y-3 rounded px-4 py-3 theme-status-warning-soft">
                      <p className="flex items-center gap-2 text-sm">
                        <AlertTriangle size={15} />
                        即将导入 {selectedCount} 首歌曲，确认后将写入数据库。
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
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
