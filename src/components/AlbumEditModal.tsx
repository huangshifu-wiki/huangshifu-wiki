import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { apiPatch, apiPost } from '../lib/apiClient';
import { useToast } from './Toast';

type AlbumFormData = {
  title: string;
  artist: string;
  description?: string;
  cover?: string;
  platformUrl?: string;
};

type AlbumItem = {
  docId?: string;
  id: string;
  title: string;
  artist: string;
  cover: string;
  description?: string | null;
  trackCount?: number;
  tracks?: unknown[];
};

interface AlbumEditModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  album?: AlbumItem | null;
}

export const AlbumEditModal = ({ open, onClose, onSuccess, album }: AlbumEditModalProps) => {
  const [formData, setFormData] = useState<AlbumFormData>({
    title: album?.title || '',
    artist: album?.artist || '',
    description: album?.description || '',
    cover: album?.cover || '',
    platformUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  React.useEffect(() => {
    if (album) {
      setFormData({ title: album.title || '', artist: album.artist || '', description: album.description || '', cover: album.cover || '', platformUrl: '' });
    } else {
      setFormData({ title: '', artist: '', description: '', cover: '', platformUrl: '' });
    }
  }, [album, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) { show('请输入专辑标题', { variant: 'error' }); return; }
    if (!formData.artist.trim()) { show('请输入艺术家名称', { variant: 'error' }); return; }

    setSaving(true);
    try {
      if (album?.docId) {
        await apiPatch(`/api/albums/${album.docId}`, {
          title: formData.title.trim(),
          artist: formData.artist.trim(),
          description: formData.description.trim() || null,
          platformUrl: formData.platformUrl.trim() || null,
        });
        show('专辑已更新');
      } else {
        await apiPost('/api/albums', {
          title: formData.title.trim(),
          artist: formData.artist.trim(),
          description: formData.description.trim() || null,
          platformUrl: formData.platformUrl.trim() || null,
        });
        show('专辑已创建');
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Save album failed:', error);
      show(error instanceof Error ? error.message : '保存专辑失败', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden bg-white rounded border border-[#e0dcd3] flex flex-col">
        <header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2c2c2c]">
              {album ? '编辑专辑' : '创建专辑'}
            </h3>
            <p className="text-xs text-[#9e968e] mt-0.5">
              {album ? '修改专辑信息' : '创建新专辑用于整理歌曲'}
            </p>
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
            <label className="text-sm font-medium text-[#2c2c2c]">专辑标题 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="例如：黄诗扶 1st Album"
              className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#2c2c2c]">艺术家 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={formData.artist}
              onChange={(e) => setFormData((prev) => ({ ...prev, artist: e.target.value }))}
              placeholder="例如：黄诗扶"
              className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#2c2c2c]">描述</label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="专辑简介（可选）"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#2c2c2c]">原始链接</label>
            <input
              type="text"
              value={formData.platformUrl || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, platformUrl: e.target.value }))}
              placeholder="例如：https://music.163.com/album?id=123456（可选）"
              className="w-full px-3 py-2 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
            />
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
  );
};
