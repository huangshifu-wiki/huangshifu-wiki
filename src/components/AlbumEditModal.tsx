import React, { useState } from 'react';

import { apiPatch, apiPost } from '../lib/apiClient';
import { useToast } from './Toast';
import { FormModal } from './Modal/FormModal';

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
    <FormModal
      open={open}
      onClose={onClose}
      title={album ? '编辑专辑' : '创建专辑'}
      subtitle={album ? '修改专辑信息' : '创建新专辑用于整理歌曲'}
      onSubmit={handleSubmit}
      submitText="保存"
      loading={saving}
      maxWidth="max-w-lg"
    >
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
    </FormModal>
  );
};
