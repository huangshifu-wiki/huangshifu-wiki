import React, { useState } from 'react';
import { Loader2, Trash2, Star, Upload, X } from 'lucide-react';
import { clsx } from 'clsx';

import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/apiClient';
import { useToast } from './Toast';
import { uploadImageWithStrategy, type UploadImageResult } from '../services/imageService';

type CoverItem = {
  id: string;
  url: string;
  isDefault: boolean;
  createdAt: string;
};

type CoversResponse = {
  covers: CoverItem[];
};

type ResourceType = 'song' | 'album';

const RESOURCE_CONFIG: Record<ResourceType, { title: string; subtitle: string; apiPrefix: string }> = {
  song: {
    title: '歌曲封面管理',
    subtitle: '上传、设置默认封面或删除现有封面',
    apiPrefix: '/api/music',
  },
  album: {
    title: '专辑封面管理',
    subtitle: '上传、管理专辑封面或将封面同步到歌曲',
    apiPrefix: '/api/albums',
  },
};

interface CoverManagerProps {
  resourceType: ResourceType;
  resourceId: string;
  currentCover: string;
  onCoverUpdated?: (newCoverUrl: string) => void;
  onSyncToSongs?: () => void;
}

export const CoverManager = ({
  resourceType,
  resourceId,
  currentCover,
  onCoverUpdated,
  onSyncToSongs,
}: CoverManagerProps) => {
  const config = RESOURCE_CONFIG[resourceType];
  const [covers, setCovers] = useState<CoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { show } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fetchCovers = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet<CoversResponse>(`${config.apiPrefix}/${resourceId}/covers`);
      setCovers(response.covers || []);
    } catch (error) {
      console.error('Fetch covers failed:', error);
    } finally {
      setLoading(false);
    }
  }, [config.apiPrefix, resourceId]);

  React.useEffect(() => {
    if (isOpen) { fetchCovers(); }
  }, [isOpen, fetchCovers]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { show('请选择图片文件', { variant: 'error' }); return; }
    if (file.size > 10 * 1024 * 1024) { show('图片大小不能超过 10MB', { variant: 'error' }); return; }

    setUploading(true);
    try {
      const result: UploadImageResult = await uploadImageWithStrategy(file, { type: 'cover' });
      if (!result.assetId) throw new Error('上传失败');
      await apiPost(`${config.apiPrefix}/${resourceId}/covers`, { assetId: result.assetId });
      show('封面上传成功');
      fetchCovers();
    } catch (error) {
      console.error('Upload cover failed:', error);
      show(error instanceof Error ? error.message : '上传封面失败', { variant: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSetDefault = async (coverId: string) => {
    setSettingDefault(coverId);
    try {
      await apiPatch(`${config.apiPrefix}/${resourceId}/covers/${coverId}/default`);
      setCovers((prev) => prev.map((c) => ({ ...c, isDefault: c.id === coverId })));
      const newDefaultCover = covers.find((c) => c.id === coverId);
      if (newDefaultCover && onCoverUpdated) { onCoverUpdated(newDefaultCover.url); }
      show('默认封面已更新');
    } catch (error) {
      console.error('Set default cover failed:', error);
      show('设置默认封面失败', { variant: 'error' });
    } finally {
      setSettingDefault(null);
    }
  };

  const handleDelete = async (coverId: string) => {
    if (!window.confirm('确定要删除这个封面吗？')) return;
    setDeleting(coverId);
    try {
      await apiDelete(`${config.apiPrefix}/${resourceId}/covers/${coverId}`);
      setCovers((prev) => prev.filter((c) => c.id !== coverId));
      show('封面已删除');
    } catch (error) {
      console.error('Delete cover failed:', error);
      show('删除封面失败', { variant: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const handleSyncToSongsInternal = async () => {
    if (!window.confirm('确定要将此封面同步到专辑内的所有歌曲吗？')) return;
    try {
      await apiPost(`${config.apiPrefix}/${resourceId}/sync-covers-to-songs`);
      show('封面已同步到专辑内歌曲');
      onSyncToSongs?.();
    } catch (error) {
      console.error('Sync covers to songs failed:', error);
      show('同步封面失败', { variant: 'error' });
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 rounded border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
      >
        封面管理
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden bg-white rounded border border-[#e0dcd3] flex flex-col">
        <header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2c2c2c]">{config.title}</h3>
            <p className="text-xs text-[#9e968e] mt-0.5">{config.subtitle}</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div className="rounded border border-[#e0dcd3] bg-[#f7f5f0]/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-[#2c2c2c]">当前封面</span>
              <div className="w-14 h-14 rounded overflow-hidden bg-[#f7f5f0] border border-[#e0dcd3]">
                <img src={currentCover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
            {resourceType === 'album' ? (
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 px-4 py-2.5 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center justify-center gap-2 text-sm transition-all"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? '上传中...' : '上传新封面'}
                </button>
                <button
                  onClick={handleSyncToSongsInternal}
                  className="px-4 py-2.5 rounded border border-[#e0dcd3] text-[#6b6560] text-sm hover:border-[#c8951e] hover:text-[#c8951e] transition-all"
                >
                  同步到歌曲
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full px-4 py-2.5 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center justify-center gap-2 text-sm transition-all"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? '上传中...' : '上传新封面'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-[#c8951e]" />
            </div>
          ) : covers.length > 0 ? (
            <div className="space-y-3">
              <span className="text-sm font-medium text-[#2c2c2c]">已上传的封面 ({covers.length})</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {covers.map((cover) => (
                  <div
                    key={cover.id}
                    className={clsx(
                      'relative rounded overflow-hidden border transition-all',
                      cover.isDefault ? 'border-[#c8951e] ring-1 ring-[#c8951e]/20' : 'border-[#e0dcd3]',
                    )}
                  >
                    <div className="aspect-square">
                      <img src={cover.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                    {cover.isDefault && (
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#c8951e] text-white text-[10px] font-medium rounded flex items-center gap-1">
                        <Star size={10} /> 默认
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                      {!cover.isDefault && (
                        <button
                          onClick={() => handleSetDefault(cover.id)}
                          disabled={settingDefault === cover.id}
                          className="p-1.5 bg-white rounded text-[#6b6560] hover:text-[#c8951e] transition-colors disabled:opacity-50"
                          title="设为默认"
                        >
                          {settingDefault === cover.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Star size={14} />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(cover.id)}
                        disabled={deleting === cover.id || cover.isDefault}
                        className="p-1.5 bg-white rounded text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deleting === cover.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-[#9e968e] text-sm">暂无额外封面</div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex justify-end">
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] text-sm hover:border-[#c8951e] hover:text-[#c8951e] transition-all"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
};
