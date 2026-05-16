import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Link2, X } from 'lucide-react';
import { clsx } from 'clsx';

import { apiPost } from '../lib/apiClient';

type Platform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo';
type ResourceType = 'song' | 'album' | 'playlist';

type PreviewSong = {
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  sourceUrl: string;
};

type ParsedResource = {
  platform: Platform;
  type: ResourceType;
  id: string;
  title: string;
  artist: string;
  cover: string;
  description: string;
  platformUrl: string;
  songs: PreviewSong[];
  totalSongs: number;
};

type ParseUrlResponse = {
  resource: ParsedResource;
};

type ImportResponse = {
  summary: {
    imported: number;
    skipped: number;
    failed: number;
  };
  collection?: {
    docId: string;
    title: string;
    resourceType: ResourceType;
  } | null;
};

interface MusicImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

function platformLabel(platform: Platform) {
  if (platform === 'netease') return '网易云音乐';
  if (platform === 'tencent') return 'QQ音乐';
  if (platform === 'kugou') return '酷狗音乐';
  if (platform === 'baidu') return '百度音乐';
  return '酷我音乐';
}

function resourceTypeLabel(type: ResourceType) {
  if (type === 'song') return '歌曲';
  if (type === 'album') return '专辑';
  return '歌单';
}

export const MusicImportModal = ({ open, onClose, onImported }: MusicImportModalProps) => {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ParsedResource | null>(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [importResult, setImportResult] = useState<string>('');

  const selectedCount = selectedIds.size;

  const allSelected = useMemo(() => {
    if (!preview || !preview.songs.length) return false;
    return preview.songs.every((song) => selectedIds.has(song.sourceId));
  }, [preview, selectedIds]);

  if (!open) return null;

  const resetResult = () => {
    setImportResult('');
    setConfirmingImport(false);
  };

  const handleParse = async () => {
    if (!url.trim()) {
      setError('请先粘贴音乐链接');
      return;
    }
    setParsing(true);
    setError('');
    setImportResult('');
    setConfirmingImport(false);
    try {
      const response = await apiPost<ParseUrlResponse>('/api/music/parse-url', { url: url.trim() });
      setPreview(response.resource);
      setSelectedIds(new Set(response.resource.songs.map((song) => song.sourceId)));
    } catch (err) {
      setPreview(null);
      setSelectedIds(new Set());
      setError(err instanceof Error ? err.message : '解析链接失败');
    } finally {
      setParsing(false);
    }
  };

  const toggleSong = (sourceId: string) => {
    resetResult();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!preview) return;
    resetResult();
    setSelectedIds(new Set(preview.songs.map((song) => song.sourceId)));
  };

  const handleSelectNone = () => {
    resetResult();
    setSelectedIds(new Set());
  };

  const handleFinalImport = async () => {
    if (!preview) return;
    if (!selectedCount) { setError('请至少选择一首歌曲'); return; }
    setImporting(true);
    setError('');
    setImportResult('');
    try {
      const response = await apiPost<ImportResponse>('/api/music/import', {
        url: url.trim() || preview.platformUrl,
        selectedSongIds: [...selectedIds],
      });
      const summary = response.summary;
      const parts = [`导入成功 ${summary.imported} 首`];
      if (summary.skipped) parts.push(`已存在 ${summary.skipped} 首`);
      if (summary.failed) parts.push(`失败 ${summary.failed} 首`);
      if (response.collection) parts.push(`已更新${resourceTypeLabel(response.collection.resourceType)}：${response.collection.title}`);
      setImportResult(parts.join('，'));
      setConfirmingImport(false);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-white rounded border border-[#e0dcd3] flex flex-col">
        <header className="px-5 md:px-6 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2c2c2c]">导入音乐 / 专辑 / 歌单</h3>
            <p className="text-xs text-[#9e968e] mt-0.5">粘贴链接后自动识别平台；导入前需二次确认</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 md:px-6 py-4 space-y-4 overflow-y-auto">
          <div className="rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 p-4">
            <label className="text-sm font-medium text-[#2c2c2c] inline-flex items-center gap-2 mb-3">
              <Link2 size={15} /> 粘贴链接
            </label>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError('');
                }}
                placeholder="例如: https://music.163.com/#/playlist?id=3778678"
                className="flex-1 px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
              />
              <button
                onClick={handleParse}
                disabled={parsing}
                className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center justify-center gap-2 text-sm transition-all"
              >
                {parsing ? <Loader2 size={14} className="animate-spin" /> : null}
                {parsing ? '解析中' : '解析链接'}
              </button>
            </div>
            {error ? <p className="text-sm text-red-500 mt-2">{error}</p> : null}
          </div>

          {preview && (
            <section className="rounded border border-[#e0dcd3] bg-[#fdf5d8]/20 p-4 space-y-4">
              <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-14 h-14 rounded overflow-hidden bg-[#f7f5f0] shrink-0 border border-[#e0dcd3]">
                    {preview.cover && <img src={preview.cover} alt="封面" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-[#9e968e] font-medium">
                      {platformLabel(preview.platform)} · {resourceTypeLabel(preview.type)}
                    </p>
                    <h4 className="text-base font-bold text-[#2c2c2c] truncate">{preview.title}</h4>
                    <p className="text-sm text-[#6b6560] truncate">{preview.artist}</p>
                  </div>
                </div>
                <a
                  href={preview.platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#c8951e] hover:underline shrink-0"
                >
                  查看原始页面
                </a>
              </div>

              {preview.description && (
                <p className="text-sm text-[#6b6560] bg-white rounded p-3 border border-[#e0dcd3]">{preview.description}</p>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-[#6b6560]">共 {preview.totalSongs} 首，已选择 {selectedCount} 首</span>
                <div className="flex items-center gap-3">
                  <button onClick={handleSelectAll} className="text-[#c8951e] hover:underline text-xs">全选</button>
                  <button onClick={handleSelectNone} className="text-[#9e968e] hover:underline text-xs">清空</button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto bg-white rounded border border-[#e0dcd3]">
                {preview.songs.map((song, index) => {
                  const checked = selectedIds.has(song.sourceId);
                  return (
                    <label
                      key={`${song.sourceId}-${index}`}
                      className={clsx(
                        'px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors border-b border-[#e0dcd3] last:border-b-0',
                        checked && 'bg-[#fdf5d8]/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSong(song.sourceId)}
                        className="w-4 h-4 accent-[#c8951e]"
                      />
                      <div className="w-10 h-10 rounded overflow-hidden bg-[#f7f5f0] shrink-0 border border-[#e0dcd3]">
                        {song.cover && <img src={song.cover} alt="封面" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#2c2c2c] truncate">{song.title}</p>
                        <p className="text-xs text-[#9e968e] truncate">{song.artist} · {song.album}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {importResult ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded px-4 py-3">
                  <CheckCircle2 size={15} />
                  <span>{importResult}</span>
                </div>
              ) : null}

              {!importResult && (
                !confirmingImport ? (
                  <button
                    onClick={() => {
                      if (!selectedCount) { setError('请至少选择一首歌曲'); return; }
                      setConfirmingImport(true);
                      setError('');
                    }}
                    className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] transition-all text-sm"
                  >
                    下一步：确认导入
                  </button>
                ) : (
                  <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertTriangle size={15} />
                      即将导入 {selectedCount} 首歌曲，确认后将写入数据库。
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleFinalImport}
                        disabled={importing}
                        className="px-4 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center gap-2 text-sm transition-all"
                      >
                        {importing ? <Loader2 size={14} className="animate-spin" /> : null}
                        {importing ? '导入中' : '最终确认导入'}
                      </button>
                      <button
                        onClick={() => setConfirmingImport(false)}
                        className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
                      >
                        返回修改
                      </button>
                    </div>
                  </div>
                )
              )}
            </section>
          )}
        </div>

        <footer className="px-5 md:px-6 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex items-center justify-between">
          <p className="text-xs text-[#9e968e] inline-flex items-center gap-1">
            <AlertTriangle size={13} />
            仅管理员可导入，且始终保留原平台链接。
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
};
