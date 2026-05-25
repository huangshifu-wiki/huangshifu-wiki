import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, CheckCircle, XCircle, RefreshCw, Book, Music, MessageSquare, Image as ImageIcon, Layers, Megaphone } from 'lucide-react';
import { clsx } from 'clsx';
import { apiDelete, apiGet, apiPost, apiPatch } from '../../lib/apiClient';
import { formatDateTime } from '../../lib/dateUtils';
import { useToast } from '../../components/Toast';
import { SmartImage } from '../../components/SmartImage';
import type { AdminDataItem } from '../../types/entities';

type ListType = 'wiki' | 'music' | 'posts' | 'galleries' | 'sections' | 'announcements';

const configMap: Record<ListType, { title: string; icon: React.ElementType; apiPath: string; deletePath?: (id: string) => string; columns: string[]; hasCreate: boolean }> = {
  wiki: { title: '百科管理', icon: Book, apiPath: 'wiki', columns: ['内容详情', '分类', '更新时间', '操作'], hasCreate: false },
  music: { title: '音乐管理', icon: Music, apiPath: 'music', columns: ['内容详情', '状态', '更新时间', '操作'], hasCreate: false },
  posts: { title: '帖子管理', icon: MessageSquare, apiPath: 'posts', columns: ['内容详情', '版块', '更新时间', '操作'], hasCreate: false },
  galleries: { title: '图集管理', icon: ImageIcon, apiPath: 'galleries', deletePath: (id) => `/api/galleries/${id}`, columns: ['内容详情', '状态', '更新时间', '操作'], hasCreate: false },
  sections: { title: '版块管理', icon: Layers, apiPath: 'sections', deletePath: (id) => `/api/sections/${id}`, columns: ['名称', '描述', '排序', '操作'], hasCreate: true },
  announcements: { title: '公告管理', icon: Megaphone, apiPath: 'announcements', columns: ['内容', '链接', '状态', '操作'], hasCreate: true },
};

export const AdminListPage = ({ type }: { type: ListType }) => {
  const cfg = configMap[type];
  const Icon = cfg.icon;
  const [data, setData] = useState<AdminDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { show } = useToast();
  const [newItem, setNewItem] = useState<any>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await apiGet<{ data: AdminDataItem[] }>(`/api/admin/${cfg.apiPath}`);
      setData(result.data || []);
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [type]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除吗？此操作不可撤销。')) return;
    try {
      const url = cfg.deletePath ? cfg.deletePath(id) : `/api/admin/${cfg.apiPath}/${id}`;
      await apiDelete(url);
      setData((prev) => prev.filter((item) => (item.docId || item.id || item.uid) !== id));
      show('已删除', { variant: 'success' });
    } catch (e) {
      show(e instanceof Error ? e.message : '删除失败', { variant: 'error' });
    }
  };

  const handleCreate = async () => {
    try {
      if (type === 'sections') {
        await apiPost('/api/sections', {
          name: newItem.name?.trim(),
          description: newItem.description?.trim(),
          order: Number.isFinite(newItem.order) ? newItem.order : 0,
        });
      } else if (type === 'announcements') {
        await apiPost('/api/announcements', {
          content: newItem.content?.trim(),
          link: newItem.link?.trim() || null,
          active: newItem.active ?? true,
        });
      }
      setNewItem({});
      await fetchData();
      show('创建成功', { variant: 'success' });
    } catch (e) {
      show('创建失败', { variant: 'error' });
    }
  };

  const toggleAnnouncement = async (item: AdminDataItem) => {
    try {
      const result = await apiPatch<{ announcement: AdminDataItem }>(`/api/announcements/${item.id}`, { active: !item.active });
      setData((prev) => prev.map((d) => (d.id === item.id ? { ...d, active: result.announcement?.active ?? !item.active } : d)));
      show('状态已更新', { variant: 'success' });
    } catch (e) {
      show('更新失败', { variant: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em] flex items-center gap-2">
          <Icon size={24} className="text-brand-gold" /> {cfg.title}
        </h1>
        <button onClick={fetchData} className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all">
          <RefreshCw size={14} className="inline mr-1" /> 刷新
        </button>
      </div>

      {cfg.hasCreate && (
        <div className="bg-surface border border-border rounded p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Plus size={16} /> 新增
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {type === 'sections' && (
              <>
                <input type="text" placeholder="名称" value={newItem.name || ''} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} className="px-4 py-2 bg-surface-alt border border-border rounded text-sm focus:outline-none focus:border-brand-gold" />
                <input type="text" placeholder="描述" value={newItem.description || ''} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} className="px-4 py-2 bg-surface-alt border border-border rounded text-sm focus:outline-none focus:border-brand-gold" />
                <input type="number" placeholder="排序" value={newItem.order || 0} onChange={(e) => setNewItem({ ...newItem, order: Number(e.target.value) })} className="px-4 py-2 bg-surface-alt border border-border rounded text-sm focus:outline-none focus:border-brand-gold" />
              </>
            )}
            {type === 'announcements' && (
              <>
                <input type="text" placeholder="公告内容" value={newItem.content || ''} onChange={(e) => setNewItem({ ...newItem, content: e.target.value })} className="md:col-span-2 px-4 py-2 bg-surface-alt border border-border rounded text-sm focus:outline-none focus:border-brand-gold" />
                <input type="text" placeholder="跳转链接 (可选)" value={newItem.link || ''} onChange={(e) => setNewItem({ ...newItem, link: e.target.value })} className="px-4 py-2 bg-surface-alt border border-border rounded text-sm focus:outline-none focus:border-brand-gold" />
              </>
            )}
            <button onClick={handleCreate} className="px-5 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all">
              添加
            </button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                {cfg.columns.map((col) => (
                  <th key={col} className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={cfg.columns.length} className="px-5 py-4"><div className="h-6 bg-surface-alt rounded" /></td>
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((item) => {
                  const rowId = String(item.docId || item.id || item.uid || '');
                  return (
                    <tr key={rowId} className="hover:bg-surface-alt transition-colors group">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {type === 'galleries' ? (
                            <SmartImage src={(Array.isArray(item.images) && item.images[0]?.url) || ''} alt="" className="w-10 h-10 rounded object-cover bg-surface-alt" />
                          ) : type === 'music' ? (
                            <SmartImage src={item.cover || ''} alt="" className="w-10 h-10 rounded object-cover bg-surface-alt" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-surface-alt flex items-center justify-center text-brand-gold"><Icon size={18} /></div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-text-primary">{item.title || item.displayName || item.slug || item.name || item.id}</p>
                            <p className="text-xs text-text-muted truncate max-w-xs">{item.content?.slice(0, 60) || item.email || item.description || item.artist || ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {type === 'announcements' ? (
                          <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.active ? 'theme-status-success' : 'bg-surface-alt text-text-muted')}>
                            {item.active ? '启用中' : '已禁用'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-surface-alt text-brand-gold text-[10px] font-medium rounded">
                            {item.category || item.section || item.name || item.status || '默认'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-text-muted">{formatDateTime(item.updatedAt, item.order !== undefined ? `排序: ${item.order}` : 'N/A')}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {type === 'announcements' && (
                            <button onClick={() => toggleAnnouncement(item)} className={clsx('p-1.5 rounded transition-all', item.active ? 'theme-text-success hover:bg-surface-alt' : 'text-text-muted hover:bg-surface-alt')} title={item.active ? '禁用' : '启用'}>
                              {item.active ? <CheckCircle size={16} /> : <XCircle size={16} />}
                            </button>
                          )}
                          <button onClick={() => handleDelete(rowId)} className="p-1.5 theme-icon-button-danger hover:bg-surface-alt rounded transition-all" title="删除">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={cfg.columns.length} className="px-5 py-16 text-center text-text-muted italic">暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminListPage;
