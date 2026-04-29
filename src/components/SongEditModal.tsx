import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';

import { apiGet, apiPatch } from '../lib/apiClient';
import { Platform, PlatformIds } from '../types/PlatformIds';
import { useToast } from './Toast';
import { MatchSuggestionModal } from './MatchSuggestionModal';

type CustomPlatformConfig = {
  key: string;
  label: string;
  urlPattern: string;
  color: string;
  bgColor: string;
};

type SongFormData = {
  title: string;
  artist: string;
  album: string;
  lyric?: string | null;
  description?: string | null;
};

type CustomPlatformLink = {
  label: string;
  url: string;
};

const normalizeCustomPlatformLinkUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

type SongItem = {
  docId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audioUrl: string;
  lyric?: string | null;
  description?: string | null;
  primaryPlatform?: Platform | null;
  favoritedByMe?: boolean;
  platformIds?: PlatformIds;
  customPlatformIds?: Record<string, string>;
  customPlatformLinks?: CustomPlatformLink[];
};

interface SongEditModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  song: SongItem;
}

const platformFields: Array<{ key: keyof PlatformIds; label: string; urlPattern: (id: string) => string }> = [
  { key: 'neteaseId', label: '网易云音乐', urlPattern: (id) => `https://music.163.com/song?id=${id}` },
  { key: 'tencentId', label: 'QQ音乐', urlPattern: (id) => `https://y.qq.com/n/ryqq/songDetail/${id}` },
  { key: 'kugouId', label: '酷狗音乐', urlPattern: (id) => `https://www.kugou.com/song/#hash=${id}` },
  { key: 'baiduId', label: '百度音乐', urlPattern: (id) => `https://music.baidu.com/song/${id}` },
  { key: 'kuwoId', label: '酷我音乐', urlPattern: (id) => `https://www.kuwo.cn/song_detail/${id}` },
];

export const SongEditModal = ({ open, onClose, onSuccess, song }: SongEditModalProps) => {
  const [formData, setFormData] = useState<SongFormData>({
    title: song.title || '',
    artist: song.artist || '',
    album: song.album || '',
    lyric: song.lyric || '',
    description: song.description || '',
  });
  const [platformIds, setPlatformIds] = useState<PlatformIds>({
    neteaseId: song.platformIds?.neteaseId || '',
    tencentId: song.platformIds?.tencentId || '',
    kugouId: song.platformIds?.kugouId || '',
    baiduId: song.platformIds?.baiduId || '',
    kuwoId: song.platformIds?.kuwoId || '',
  });
  const [customPlatformLinks, setCustomPlatformLinks] = useState<CustomPlatformLink[]>(song.customPlatformLinks || []);
  const [customPlatformIds, setCustomPlatformIds] = useState<Record<string, string>>(song.customPlatformIds || {});
  const [customPlatforms, setCustomPlatforms] = useState<CustomPlatformConfig[]>([]);
  const [platformExpanded, setPlatformExpanded] = useState(false);
  const [customPlatformExpanded, setCustomPlatformExpanded] = useState(false);
  const [matchingPlatform, setMatchingPlatform] = useState<Platform | null>(null);
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    if (open) {
      apiGet<{ platforms: CustomPlatformConfig[] }>('/api/music-platforms')
        .then(data => setCustomPlatforms(data.platforms || []))
        .catch(() => setCustomPlatforms([]));
    }
  }, [open]);

  useEffect(() => {
    if (song) {
      setFormData({
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        lyric: song.lyric || '',
        description: song.description || '',
      });
      setPlatformIds({
        neteaseId: song.platformIds?.neteaseId || '',
        tencentId: song.platformIds?.tencentId || '',
        kugouId: song.platformIds?.kugouId || '',
        baiduId: song.platformIds?.baiduId || '',
        kuwoId: song.platformIds?.kuwoId || '',
      });
      setCustomPlatformLinks(song.customPlatformLinks || []);
      setCustomPlatformIds(song.customPlatformIds || {});
    }
  }, [song, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) { show('请输入歌曲标题', { variant: 'error' }); return; }
    if (!formData.artist.trim()) { show('请输入艺术家名称', { variant: 'error' }); return; }

    const normalizedCustomPlatformLinks = customPlatformLinks.map((link) => ({
      label: link.label.trim(),
      url: link.url.trim(),
    }));
    const hasIncompleteCustomPlatformLink = normalizedCustomPlatformLinks.some(
      (link) => (link.label || link.url) && (!link.label || !link.url),
    );
    if (hasIncompleteCustomPlatformLink) {
      show('自定义平台链接需要同时填写平台名称和地址', { variant: 'error' });
      return;
    }
    const hasInvalidCustomPlatformLink = normalizedCustomPlatformLinks.some(
      (link) => link.url && !normalizeCustomPlatformLinkUrl(link.url),
    );
    if (hasInvalidCustomPlatformLink) {
      show('自定义平台链接地址无效，请填写正确的 http/https 链接', { variant: 'error' });
      return;
    }

    setSaving(true);
    try {
      await apiPatch(`/api/music/${song.docId}`, {
        title: formData.title.trim(),
        artist: formData.artist.trim(),
        album: formData.album.trim(),
        lyric: formData.lyric?.trim() || null,
        description: formData.description?.trim() || null,
        neteaseId: platformIds.neteaseId || null,
        tencentId: platformIds.tencentId || null,
        kugouId: platformIds.kugouId || null,
        baiduId: platformIds.baiduId || null,
        kuwoId: platformIds.kuwoId || null,
        customPlatformIds,
        customPlatformLinks: normalizedCustomPlatformLinks.filter((link) => link.label && link.url),
      });
      show('歌曲已更新');
      onSuccess();
      onClose();
    } catch (error) {
      const err = error as { conflict?: boolean; conflictingSong?: { docId: string; title: string; artist: string }; message?: string };
      if (err.conflict && err.conflictingSong) {
        show(`该平台ID已被歌曲「${err.conflictingSong.title}」使用`, { variant: 'error' });
      } else {
        show(error instanceof Error ? error.message : '保存失败', { variant: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePlatformIdChange = (key: keyof PlatformIds, value: string) => {
    setPlatformIds((prev) => ({ ...prev, [key]: value }));
  };

  const handleCustomPlatformLinkChange = (index: number, key: keyof CustomPlatformLink, value: string) => {
    setCustomPlatformLinks((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )));
  };

  const handleAddCustomPlatformLink = () => {
    setCustomPlatformLinks((prev) => [...prev, { label: '', url: '' }]);
  };

  const handleRemoveCustomPlatformLink = (index: number) => {
    setCustomPlatformLinks((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleMatchSelect = (platform: Platform, sourceId: string) => {
    handlePlatformIdChange(`${platform}Id` as keyof PlatformIds, sourceId);
    setMatchingPlatform(null);
  };

  const linkedPlatforms = platformFields.filter((p) => platformIds[p.key]);

  return (
    <>
      <div className="fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-lg max-h-[90vh] overflow-hidden bg-white rounded border border-[#e0dcd3] flex flex-col">
          <header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-[#2c2c2c]">编辑歌曲</h3>
              <p className="text-xs text-[#9e968e] mt-0.5">修改歌曲基本信息</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
            >
              <X size={18} />
            </button>
          </header>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2c2c2c]">歌曲标题 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="歌曲名称"
                className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2c2c2c]">艺术家 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.artist}
                onChange={(e) => setFormData((prev) => ({ ...prev, artist: e.target.value }))}
                placeholder="歌手名称"
                className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2c2c2c]">专辑</label>
              <input
                type="text"
                value={formData.album}
                onChange={(e) => setFormData((prev) => ({ ...prev, album: e.target.value }))}
                placeholder="所属专辑（可选）"
                className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2c2c2c]">歌词</label>
              <textarea
                value={formData.lyric || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, lyric: e.target.value }))}
                placeholder="歌词内容（可选，每行一句）"
                rows={6}
                className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2c2c2c]">歌曲描述</label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="创作者的话、创作背景等（可选，支持 Markdown）"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none resize-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setPlatformExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between p-3 rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 hover:bg-[#f7f5f0] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#2c2c2c]">关联平台</span>
                {linkedPlatforms.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[#fdf5d8] text-[#c8951e] font-medium">
                    已关联 {linkedPlatforms.length} 个
                  </span>
                )}
              </div>
              {platformExpanded ? <ChevronUp size={16} className="text-[#9e968e]" /> : <ChevronDown size={16} className="text-[#9e968e]" />}
            </button>

            {platformExpanded && (
              <div className="space-y-2">
                {platformFields.map((platform) => {
                  const currentId = platformIds[platform.key] || '';
                  const isLinked = Boolean(currentId);
                  return (
                    <div key={platform.key} className="flex items-center gap-2">
                      <span className="w-24 text-xs text-[#6b6560] shrink-0">{platform.label}</span>
                      <input
                        type="text"
                        value={currentId}
                        onChange={(e) => handlePlatformIdChange(platform.key, e.target.value)}
                        placeholder={isLinked ? '已关联' : '输入平台歌曲ID'}
                        className="flex-1 px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
                      />
                      {isLinked && (
                        <a
                          href={platform.urlPattern(currentId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setMatchingPlatform(platform.key.replace('Id', '') as Platform)}
                        className="px-3 py-2 rounded border border-[#e0dcd3] text-xs text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-1"
                      >
                        <Search size={13} />
                        匹配
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {customPlatforms.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setCustomPlatformExpanded((prev) => !prev)}
                  className="w-full flex items-center justify-between p-3 rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 hover:bg-[#f7f5f0] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#2c2c2c]">预设平台</span>
                    {Object.keys(customPlatformIds).length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[#fdf5d8] text-[#c8951e] font-medium">
                        已添加 {Object.keys(customPlatformIds).length} 个
                      </span>
                    )}
                  </div>
                  {customPlatformExpanded ? <ChevronUp size={16} className="text-[#9e968e]" /> : <ChevronDown size={16} className="text-[#9e968e]" />}
                </button>

                {customPlatformExpanded && (
                  <div className="space-y-2">
                    {customPlatforms.map((platform) => {
                      const currentId = customPlatformIds[platform.key] || '';
                      const isLinked = Boolean(currentId);
                      const buildUrl = (id: string) => platform.urlPattern.replace('{id}', id);
                      return (
                        <div key={platform.key} className="flex items-center gap-2">
                          <span className="w-20 text-xs px-2 py-1 rounded text-center shrink-0 bg-[#fdf5d8] text-[#c8951e] font-medium">
                            {platform.label}
                          </span>
                          <input
                            type="text"
                            value={currentId}
                            onChange={(e) => setCustomPlatformIds((prev) => ({
                              ...prev,
                              [platform.key]: e.target.value,
                            }))}
                            placeholder={isLinked ? '已添加' : '输入平台ID'}
                            className="flex-1 px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
                          />
                          {isLinked && (
                            <>
                              <a
                                href={buildUrl(currentId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors"
                              >
                                <ExternalLink size={14} />
                              </a>
                              <button
                                type="button"
                                onClick={() => setCustomPlatformIds((prev) => {
                                  const next = { ...prev };
                                  delete next[platform.key];
                                  return next;
                                })}
                                className="p-1.5 text-[#9e968e] hover:text-red-500 transition-colors"
                                title="移除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#2c2c2c]">自定义平台链接</p>
                  <p className="text-xs text-[#9e968e] mt-0.5">例如哔哩哔哩、5sing 或其他发布平台</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddCustomPlatformLink}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-[#e0dcd3] text-xs text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
                >
                  <Plus size={13} /> 添加链接
                </button>
              </div>

              {customPlatformLinks.length > 0 ? (
                <div className="space-y-2">
                  {customPlatformLinks.map((link, index) => {
                    const previewUrl = normalizeCustomPlatformLinkUrl(link.url);
                    return (
                      <div key={`custom-link-${index}`} className="rounded border border-[#e0dcd3] bg-white p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={link.label}
                            onChange={(e) => handleCustomPlatformLinkChange(index, 'label', e.target.value)}
                            placeholder="平台名称，例如 Bilibili"
                            className="w-36 px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
                          />
                          <input
                            type="text"
                            value={link.url}
                            onChange={(e) => handleCustomPlatformLinkChange(index, 'url', e.target.value)}
                            placeholder="链接地址"
                            className="flex-1 px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
                          />
                          {previewUrl && (
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomPlatformLink(index)}
                            className="p-1.5 text-[#9e968e] hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded border border-dashed border-[#e0dcd3] bg-white/70 px-3 py-4 text-xs text-[#9e968e] text-center">
                  暂无自定义平台链接
                </div>
              )}
            </div>

            <div className="rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 p-3">
              <div className="flex items-center gap-3">
                <img src={song.cover} alt="" className="w-12 h-12 rounded object-cover border border-[#e0dcd3]" referrerPolicy="no-referrer" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#2c2c2c] truncate">{song.title}</p>
                  <p className="text-xs text-[#9e968e] truncate">{song.artist}</p>
                  <p className="text-xs text-[#9e968e] mt-0.5">ID: {song.id}</p>
                </div>
              </div>
            </div>
          </form>

          <footer className="px-5 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center gap-2 text-sm transition-all"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? '保存中...' : '保存'}
            </button>
          </footer>
        </div>
      </div>

      {matchingPlatform && (
        <MatchSuggestionModal
          open={true}
          onClose={() => setMatchingPlatform(null)}
          title={formData.title}
          artist={formData.artist}
          targetPlatform={matchingPlatform}
          existingPlatformId={platformIds[`${matchingPlatform}Id` as keyof PlatformIds]}
          onSelect={(sourceId) => handleMatchSelect(matchingPlatform, sourceId)}
        />
      )}
    </>
  );
};
