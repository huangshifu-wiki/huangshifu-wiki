import React, { useState } from 'react';
import { ExternalLink, Loader2, Search, X, Check, AlertCircle } from 'lucide-react';

import { apiGet } from '../lib/apiClient';

type Platform = 'netease' | 'tencent' | 'kugou' | 'baidu' | 'kuwo';

type MatchSuggestion = {
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  sourceUrl: string;
  score: number;
  isAutoSelected: boolean;
  alreadyLinked: { docId: string; title: string } | null;
};

type MatchSuggestionsResponse = {
  suggestions: MatchSuggestion[];
  autoSelectedIndex: number | null;
};

interface MatchSuggestionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  targetPlatform: Platform;
  existingPlatformId?: string | null;
  onSelect: (sourceId: string) => void;
}

const platformLabels: Record<Platform, string> = {
  netease: '网易云音乐',
  tencent: 'QQ音乐',
  kugou: '酷狗音乐',
  baidu: '百度音乐',
  kuwo: '酷我音乐',
};

function buildPlatformSongUrl(platform: Platform, id: string): string {
  if (platform === 'netease') return `https://music.163.com/song?id=${id}`;
  if (platform === 'tencent') return `https://y.qq.com/n/ryqq/songDetail/${id}`;
  if (platform === 'kugou') return `https://www.kugou.com/song/#hash=${id}`;
  if (platform === 'baidu') return `https://music.baidu.com/song/${id}`;
  return `https://www.kuwo.cn/song_detail/${id}`;
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
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  React.useEffect(() => {
    if (open && !searched) { handleSearch(); }
  }, [open]);

  React.useEffect(() => {
    if (!open) { setSuggestions([]); setSearched(false); setError(''); setSelectedIndex(null); }
  }, [open]);

  React.useEffect(() => {
    if (searched && suggestions.length > 0) {
      const autoIdx = suggestions.findIndex((s) => s.isAutoSelected);
      if (autoIdx >= 0) { setSelectedIndex(autoIdx); }
    }
  }, [searched, suggestions]);

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setSearched(false);
    try {
      const data = await apiGet<MatchSuggestionsResponse>('/api/music/match-suggestions', {
        platform: targetPlatform,
        title,
        artist,
      });
      setSuggestions(data.suggestions || []);
      setSearched(true);
      if (data.suggestions.length === 0) {
        setError(`在${platformLabels[targetPlatform]}未找到匹配歌曲`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
      setSuggestions([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (selectedIndex === null) return;
    onSelect(suggestions[selectedIndex].sourceId);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden bg-white rounded border border-[#e0dcd3] flex flex-col">
        <header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2c2c2c]">搜索匹配歌曲</h3>
            <p className="text-xs text-[#9e968e] mt-0.5">
              在{platformLabels[targetPlatform]}搜索：{title} - {artist}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-[#c8951e]" />
              <span className="ml-3 text-sm text-[#6b6560]">搜索中...</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2 p-3 rounded bg-red-50 text-red-600 text-sm">
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
                  className={`w-full text-left p-3 rounded border transition-all ${
                    selectedIndex === index
                      ? 'border-[#c8951e] bg-[#fdf5d8]/30'
                      : 'border-[#e0dcd3] hover:border-[#c8951e] hover:bg-[#f7f5f0]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selectedIndex === index
                          ? 'border-[#c8951e] bg-[#c8951e]'
                          : 'border-[#e0dcd3]'
                      }`}
                    >
                      {selectedIndex === index && <Check size={12} className="text-white" />}
                    </div>
                    <img
                      src={suggestion.cover}
                      alt=""
                      className="w-11 h-11 rounded object-cover shrink-0 border border-[#e0dcd3]"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#2c2c2c] truncate">{suggestion.title}</p>
                      <p className="text-xs text-[#9e968e] truncate">{suggestion.artist} · {suggestion.album}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            suggestion.score >= 80
                              ? 'bg-green-50 text-green-700'
                              : suggestion.score >= 60
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-[#f7f5f0] text-[#9e968e]'
                          }`}
                        >
                          匹配度 {suggestion.score}%
                        </span>
                        {suggestion.alreadyLinked && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                            已关联
                          </span>
                        )}
                        {suggestion.isAutoSelected && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#fdf5d8] text-[#c8951e]">
                            推荐
                          </span>
                        )}
                      </div>
                    </div>
                    <a
                      href={buildPlatformSongUrl(targetPlatform, suggestion.sourceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors shrink-0"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </div>
                </button>
              ))}
            </div>
          )}

          {searched && suggestions.length === 0 && !loading && !error && (
            <div className="text-center py-12 text-[#9e968e]">
              <Search size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">未找到匹配歌曲</p>
            </div>
          )}

          {existingPlatformId && (
            <div className="p-3 rounded bg-[#f7f5f0] border border-[#e0dcd3]">
              <p className="text-xs text-[#9e968e]">
                该平台已有ID: <span className="font-mono font-medium text-[#2c2c2c]">{existingPlatformId}</span>
              </p>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex justify-end gap-3 pb-safe">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIndex === null || loading}
            className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center gap-2 text-sm transition-all"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? '处理中...' : '确认'}
          </button>
        </footer>
      </div>
    </div>
  );
};
