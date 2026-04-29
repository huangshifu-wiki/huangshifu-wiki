import React, { useEffect, useState } from 'react';
import { Download, Upload, Edit2, Trash2, CheckCircle, XCircle, FileText, Settings, RefreshCw, Sparkles } from 'lucide-react';
import { apiGet, apiPatch, apiDelete, apiPost } from '../../lib/apiClient';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../lib/dateUtils';
import { clsx } from 'clsx';
import { SmartImage } from '../../components/SmartImage';
import { clearImagePreferenceCache } from '../../services/imageService';

interface ImageMap {
  id: string;
  md5: string;
  localUrl: string;
  externalUrl?: string;
  s3Url?: string;
  storageType?: 'local' | 's3' | 'external';
  blurhash?: string;
  thumbhash?: string;
  createdAt: string;
}

interface ImageStats {
  total: number;
  stats: { local: number; external: number; s3: number };
}

interface ImagePreference {
  strategy: 'local' | 's3' | 'external';
  fallback: boolean;
}

const getStrategyLabel = (strategy: string) => {
  const labels: Record<string, string> = { local: '本地服务器', s3: 'S3 图床', external: '外部图床' };
  return labels[strategy] || strategy;
};

const getStorageBadge = (type?: string) => {
  const badges: Record<string, { cls: string; label: string }> = {
    local: { cls: 'bg-[#f7f5f0] text-[#c8951e]', label: '本地' },
    s3: { cls: 'bg-[#fdf5d8] text-[#c8951e]', label: 'S3' },
    external: { cls: 'bg-[#f0ece3] text-[#6b6560]', label: '外部' },
  };
  const b = badges[type || 'local'];
  return <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', b.cls)}>{b.label}</span>;
};

const AdminImages: React.FC = () => {
  const [images, setImages] = useState<ImageMap[]>([]);
  const [stats, setStats] = useState<ImageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingImage, setEditingImage] = useState<ImageMap | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPreferenceModal, setShowPreferenceModal] = useState(false);
  const [preference, setPreference] = useState<ImagePreference>({ strategy: 'local', fallback: true });
  const { show } = useToast();

  const fetchImages = async () => {
    setLoading(true);
    try {
      const response = await apiGet<{ items: ImageMap[] }>('/api/image-maps');
      setImages(response.items || []);
    } catch (error) {
      console.error(error);
      show('获取图片列表失败', { variant: 'error' });
    } finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try {
      const response = await apiGet<ImageStats>('/api/image-maps/stats');
      setStats(response);
    } catch (error) { console.error(error); }
  };

  const fetchPreference = async () => {
    try {
      const response = await apiGet<ImagePreference>('/api/config/image-preference');
      setPreference(response);
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    fetchImages();
    fetchStats();
    fetchPreference();
  }, []);

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const response = await fetch(`/api/image-maps/export?format=${format}`, { credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '导出失败');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-maps-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show(`成功导出 ${images.length} 条图片记录`, { variant: 'success' });
    } catch (error) {
      show(error instanceof Error ? error.message : '导出失败', { variant: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这张图片的映射吗？')) return;
    try {
      await apiDelete(`/api/image-maps/${id}`);
      setImages((prev) => prev.filter((img) => img.id !== id));
      show('删除成功', { variant: 'success' });
      fetchStats();
    } catch { show('删除失败', { variant: 'error' }); }
  };

  const handleRefreshBlurhash = async (id: string) => {
    try {
      const response = await apiPost<{ success: boolean; item: ImageMap }>(`/api/image-maps/${id}/refresh-blurhash`, {});
      if (response.success) {
        setImages((prev) => prev.map((img) => (img.id === id ? response.item : img)));
        show('Blurhash 生成成功', { variant: 'success' });
      }
    } catch { show('生成 Blurhash 失败', { variant: 'error' }); }
  };

  const handleUpdate = async () => {
    if (!editingImage) return;
    try {
      const response = await apiPatch<{ item: ImageMap }>(`/api/image-maps/${editingImage.id}`, {
        localUrl: editingImage.localUrl || null,
        externalUrl: editingImage.externalUrl || null,
        s3Url: editingImage.s3Url || null,
        storageType: editingImage.storageType,
      });
      setImages((prev) => prev.map((img) => (img.id === editingImage.id ? response.item : img)));
      setEditingImage(null);
      show('更新成功', { variant: 'success' });
      fetchStats();
    } catch { show('更新失败', { variant: 'error' }); }
  };

  const handlePreferenceUpdate = async () => {
    try {
      await apiPatch('/api/config/image-preference', preference);
      clearImagePreferenceCache();
      setShowPreferenceModal(false);
      show('设置已保存', { variant: 'success' });
    } catch { show('保存设置失败', { variant: 'error' }); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">图片管理</h2>
          <p className="text-sm text-[#9e968e] mt-1">管理本地图片和外部图床映射</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchImages()} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all inline-flex items-center gap-2">
            <RefreshCw size={16} /> 刷新
          </button>
          <button onClick={() => setShowPreferenceModal(true)} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all inline-flex items-center gap-2">
            <Settings size={16} /> 图片策略
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-xs text-[#9e968e] mb-1">总数量</p>
            <p className="text-2xl font-bold text-[#2c2c2c]">{stats.total}</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-xs text-[#9e968e] mb-1">本地图片</p>
            <p className="text-2xl font-bold text-[#c8951e]">{stats.stats.local}</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-xs text-[#9e968e] mb-1">S3 图床</p>
            <p className="text-2xl font-bold text-[#c8951e]">{stats.stats.s3}</p>
          </div>
          <div className="bg-white border border-[#e0dcd3] rounded p-4">
            <p className="text-xs text-[#9e968e] mb-1">外部图床</p>
            <p className="text-2xl font-bold text-[#c8951e]">{stats.stats.external}</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e0dcd3] rounded p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#2c2c2c]">图片列表</h3>
          <div className="flex gap-2">
            <button onClick={() => handleExport('csv')} className="px-3 py-1.5 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-xs transition-all inline-flex items-center gap-1.5">
              <Download size={14} /> 导出 CSV
            </button>
            <button onClick={() => handleExport('json')} className="px-3 py-1.5 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-xs transition-all inline-flex items-center gap-1.5">
              <Download size={14} /> 导出 JSON
            </button>
            <button onClick={() => setShowImportModal(true)} className="px-3 py-1.5 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-xs transition-all inline-flex items-center gap-1.5">
              <Upload size={14} /> 导入
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-[#f7f5f0] rounded animate-pulse" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="text-center py-16 text-[#9e968e]">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p>暂无图片记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {images.map((image) => {
              const imageUrl = image.s3Url || image.externalUrl || image.localUrl;
              return (
                <div key={image.id} className="border border-[#e0dcd3] rounded p-4 hover:bg-[#f7f5f0] transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="w-20 h-20 flex-shrink-0">
                        <SmartImage src={imageUrl || ''} alt={image.id} className="w-full h-full rounded object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="px-2 py-1 bg-[#f7f5f0] text-[#9e968e] rounded text-xs font-mono">{image.id.slice(0, 8)}</span>
                          <span className="text-xs text-[#9e968e] font-mono">{image.md5.slice(0, 12)}</span>
                          {getStorageBadge(image.storageType)}
                          {image.blurhash && <span className="px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] rounded text-[10px]">Blurhash</span>}
                        </div>
                        <div className="space-y-1">
                          {image.localUrl && <div className="flex items-center gap-2"><CheckCircle size={14} className="text-[#c8951e] flex-shrink-0" /><span className="text-xs text-[#6b6560] truncate">本地: {image.localUrl}</span></div>}
                          {image.s3Url && <div className="flex items-center gap-2"><CheckCircle size={14} className="text-[#c8951e] flex-shrink-0" /><span className="text-xs text-[#6b6560] truncate">S3: {image.s3Url}</span></div>}
                          {image.externalUrl && <div className="flex items-center gap-2"><CheckCircle size={14} className="text-[#9e968e] flex-shrink-0" /><span className="text-xs text-[#9e968e] truncate">外部: {image.externalUrl}</span></div>}
                        </div>
                        <p className="text-[10px] text-[#9e968e] mt-2">创建于: {formatDateTime(image.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!image.blurhash && imageUrl && (
                        <button onClick={() => handleRefreshBlurhash(image.id)} className="p-2 text-[#c8951e] hover:bg-[#fdf5d8] rounded transition-all" title="生成 Blurhash">
                          <Sparkles size={18} />
                        </button>
                      )}
                      <button onClick={() => setEditingImage(image)} className="p-2 text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-all" title="编辑">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDelete(image.id)} className="p-2 text-red-400 hover:bg-red-50 rounded transition-all" title="删除">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingImage && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#e0dcd3] rounded p-6 max-w-2xl w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#2c2c2c]">编辑图片映射</h3>
              <button onClick={() => setEditingImage(null)} className="p-2 hover:bg-[#f7f5f0] rounded">
                <XCircle size={20} className="text-[#9e968e]" />
              </button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">ID</label><input type="text" value={editingImage.id} disabled className="w-full px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm font-mono" /></div>
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">MD5</label><input type="text" value={editingImage.md5} disabled className="w-full px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm font-mono" /></div>
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">本地 URL</label><input type="text" value={editingImage.localUrl} onChange={(e) => setEditingImage({ ...editingImage, localUrl: e.target.value })} className="w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" placeholder="https://..." /></div>
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">S3 URL {editingImage.s3Url && <span className="text-green-600 text-xs">已配置</span>}</label><input type="text" value={editingImage.s3Url || ''} onChange={(e) => setEditingImage({ ...editingImage, s3Url: e.target.value })} className="w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" placeholder="https://cdn.yourdomain.com/..." /></div>
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">外部图床 URL {editingImage.externalUrl && <span className="text-green-600 text-xs">已配置</span>}</label><input type="text" value={editingImage.externalUrl || ''} onChange={(e) => setEditingImage({ ...editingImage, externalUrl: e.target.value })} className="w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" placeholder="https://..." /></div>
              <div><label className="block text-sm font-medium text-[#6b6560] mb-1">存储类型</label><select value={editingImage.storageType || 'local'} onChange={(e) => setEditingImage({ ...editingImage, storageType: e.target.value as any })} className="w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]"><option value="local">本地服务器</option><option value="s3">S3 图床</option><option value="external">外部图床</option></select></div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingImage(null)} className="flex-1 px-4 py-2 bg-[#f0ece3] text-[#6b6560] rounded font-medium hover:bg-[#e0dcd3] transition-all">取消</button>
                <button onClick={handleUpdate} className="flex-1 px-4 py-2 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all">保存修改</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onSuccess={() => { fetchImages(); fetchStats(); setShowImportModal(false); }} />}

      {showPreferenceModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#e0dcd3] rounded p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#2c2c2c]">图片加载策略</h3>
              <button onClick={() => setShowPreferenceModal(false)} className="p-2 hover:bg-[#f7f5f0] rounded"><XCircle size={20} className="text-[#9e968e]" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#6b6560] mb-2">优先使用</label>
                <select value={preference.strategy} onChange={(e) => setPreference({ ...preference, strategy: e.target.value as any })} className="w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]">
                  <option value="local">本地服务器</option><option value="s3">S3 图床</option><option value="external">外部图床</option>
                </select>
                <p className="text-xs text-[#9e968e] mt-1">图片加载时会优先使用选定的 URL</p>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="fallback" checked={preference.fallback} onChange={(e) => setPreference({ ...preference, fallback: e.target.checked })} className="w-4 h-4 accent-[#c8951e]" />
                <label htmlFor="fallback" className="text-sm text-[#6b6560]">启用备用方案</label>
              </div>
              <p className="text-xs text-[#9e968e]">启用后，如果优先 URL 加载失败，会自动尝试其他可用 URL</p>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowPreferenceModal(false)} className="flex-1 px-4 py-2 bg-[#f0ece3] text-[#6b6560] rounded font-medium hover:bg-[#e0dcd3] transition-all">取消</button>
                <button onClick={handlePreferenceUpdate} className="flex-1 px-4 py-2 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all">保存设置</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ImportModalProps { onClose: () => void; onSuccess: () => void; }

const ImportModal: React.FC<ImportModalProps> = ({ onClose, onSuccess }) => {
  const [mode, setMode] = useState<'upsert' | 'update' | 'create'>('upsert');
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToast();

  const handleImport = async () => {
    if (!data.trim()) { show('请输入导入数据', { variant: 'error' }); return; }
    setLoading(true);
    try {
      let items: any[];
      try {
        items = JSON.parse(data);
        if (!Array.isArray(items)) items = [items];
      } catch {
        const lines = data.trim().split('\n');
        items = lines.map((line) => {
          const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
          return { id: parts[0], md5: parts[1], localUrl: parts[2], s3Url: parts[3] || undefined, externalUrl: parts[4] || undefined, storageType: parts[5] as 'local' | 's3' | 'external' || undefined };
        });
      }
      const response = await apiPost<{ success: number; failed: number; errors: string[] }>('/api/image-maps/import', { items, mode });
      if (response.failed > 0) show(`导入完成: 成功 ${response.success} 条, 失败 ${response.failed} 条`, { variant: 'error' });
      else show(`成功导入 ${response.success} 条记录`, { variant: 'success' });
      onSuccess();
    } catch { show('导入失败', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-[#e0dcd3] rounded p-6 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[#2c2c2c]">批量导入图片映射</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#f7f5f0] rounded"><XCircle size={20} className="text-[#9e968e]" /></button>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-[#6b6560] mb-2">导入模式</label>
          <div className="flex gap-2">
            {[
              { value: 'upsert', label: '智能更新', desc: '按MD5匹配，已存在则更新' },
              { value: 'update', label: '仅更新', desc: '按ID更新已有记录' },
              { value: 'create', label: '仅创建', desc: '只创建新记录' },
            ].map((option) => (
              <button key={option.value} onClick={() => setMode(option.value as any)} className={clsx('flex-1 px-4 py-2 border rounded text-sm font-medium transition-all', mode === option.value ? 'border-[#c8951e] bg-[#fdf5d8] text-[#c8951e]' : 'border-[#e0dcd3] text-[#6b6560] hover:bg-[#f7f5f0]')}>
                <div>{option.label}</div>
                <div className="text-xs opacity-70 mt-1">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 flex-1 overflow-hidden flex flex-col">
          <label className="block text-sm font-medium text-[#6b6560] mb-2">导入数据 (JSON 或 CSV)</label>
          <textarea value={data} onChange={(e) => setData(e.target.value)} className="flex-1 w-full px-4 py-2 border border-[#e0dcd3] rounded text-sm font-mono resize-none focus:outline-none focus:border-[#c8951e]" placeholder={mode === 'upsert' ? '[\n  { "md5": "abc123", "localUrl": "https://...", "s3Url": "https://...", "externalUrl": "https://...", "storageType": "s3" }\n]' : '[\n  { "id": "xxx", "localUrl": "https://...", "s3Url": "https://...", "externalUrl": "https://...", "storageType": "local" }\n]'} />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-[#f0ece3] text-[#6b6560] rounded font-medium hover:bg-[#e0dcd3] transition-all" disabled={loading}>取消</button>
          <button onClick={handleImport} className="flex-1 px-4 py-2 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all disabled:opacity-50" disabled={loading}>{loading ? '导入中...' : '开始导入'}</button>
        </div>
      </div>
    </div>
  );
};

export default AdminImages;
