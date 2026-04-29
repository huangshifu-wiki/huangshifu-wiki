import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Cpu, Database, Image, ShieldCheck, Gift, Link as LinkIcon,
  CheckCircle, XCircle, Trash2, RefreshCw, Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/apiClient';
import { useToast } from '../../components/Toast';
import AdminEmbeddings from './AdminEmbeddings';
import AdminBackups from './AdminBackups';
import AdminImages from './AdminImages';
import AdminMarkdownLinks from './AdminMarkdownLinks';

type ToolType = 'embeddings' | 'backups' | 'images' | 'sensitive_check' | 'birthday' | 'markdown_links';

const toolConfig: Record<ToolType, { title: string; icon: React.ElementType; hasTable?: boolean; apiPath?: string }> = {
  embeddings: { title: '向量管理', icon: Cpu },
  backups: { title: '数据库备份', icon: Database },
  images: { title: '图片管理', icon: Image },
  sensitive_check: { title: '敏感词检测', icon: ShieldCheck, hasTable: false },
  birthday: { title: '生贺配置', icon: Gift, hasTable: true, apiPath: 'birthday/config' },
  markdown_links: { title: '链接更新', icon: LinkIcon },
};

interface BirthdayConfig {
  id: string;
  type: string;
  title: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const AdminToolPage = ({ type: propType }: { type?: ToolType }) => {
  const { type: paramType } = useParams<{ type: ToolType }>();
  const toolType = propType || (paramType as ToolType) || 'embeddings';
  const cfg = toolConfig[toolType];
  const Icon = cfg.icon;
  const { show } = useToast();

  const [sensitiveText, setSensitiveText] = useState('');
  const [sensitiveResult, setSensitiveResult] = useState<string[]>([]);
  const [sensitiveLoading, setSensitiveLoading] = useState(false);

  const [birthdayData, setBirthdayData] = useState<BirthdayConfig[]>([]);
  const [birthdayFilter, setBirthdayFilter] = useState('all');
  const [birthdayLoading, setBirthdayLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BirthdayConfig | null>(null);
  const [newConfig, setNewConfig] = useState({ type: 'notice', title: '', content: '', sortOrder: 0 });

  useEffect(() => {
    if (toolType === 'birthday') {
      fetchBirthday();
    }
  }, [toolType]);

  const fetchBirthday = async () => {
    setBirthdayLoading(true);
    try {
      const result = await apiGet<{ data: BirthdayConfig[] }>('/api/birthday/config');
      setBirthdayData(result.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setBirthdayLoading(false);
    }
  };

  const handleSensitiveCheck = async () => {
    if (!sensitiveText.trim()) return;
    setSensitiveLoading(true);
    try {
      const data = await apiPost<{ sensitiveWords: string[] }>('/api/admin/check-sensitive', { text: sensitiveText });
      setSensitiveResult(data.sensitiveWords || []);
    } catch {
      show('检测失败', { variant: 'error' });
    } finally {
      setSensitiveLoading(false);
    }
  };

  const renderContent = () => {
    switch (toolType) {
      case 'embeddings':
        return <AdminEmbeddings />;
      case 'backups':
        return <AdminBackups />;
      case 'images':
        return <AdminImages />;
      case 'markdown_links':
        return <AdminMarkdownLinks />;
      case 'sensitive_check':
        return (
          <div className="space-y-4">
            <p className="text-sm text-[#9e968e]">输入文本内容进行敏感词检测</p>
            <textarea
              className="w-full p-4 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base"
              rows={8}
              placeholder="请输入要检测的文本内容..."
              value={sensitiveText}
              onChange={(e) => setSensitiveText(e.target.value)}
            />
            <button
              onClick={handleSensitiveCheck}
              disabled={sensitiveLoading || !sensitiveText.trim()}
              className="px-6 py-2 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all disabled:opacity-50"
            >
              {sensitiveLoading ? '检测中...' : '开始检测'}
            </button>
            {sensitiveResult.length > 0 ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded">
                <p className="text-sm font-medium text-red-600 mb-2">检测到 {sensitiveResult.length} 个敏感词：</p>
                <div className="flex flex-wrap gap-2">
                  {sensitiveResult.map((word) => (
                    <span key={word} className="px-3 py-1 bg-red-100 text-red-600 rounded text-xs font-medium">{word}</span>
                  ))}
                </div>
              </div>
            ) : sensitiveText.trim() && !sensitiveLoading ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded">
                <p className="text-sm font-medium text-green-600">未检测到敏感词</p>
              </div>
            ) : null}
          </div>
        );
      case 'birthday':
        return (
          <div className="space-y-5">
            <div className="bg-white border border-[#e0dcd3] rounded p-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-[#6b6560]">筛选类型：</span>
              {['all', 'notice', 'school_history', 'honor_alumni', 'campus', 'guestbook', 'contact', 'program'].map((t) => (
                <button
                  key={t}
                  onClick={() => setBirthdayFilter(t)}
                  className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-all', birthdayFilter === t ? 'bg-[#c8951e] text-white' : 'bg-[#f7f5f0] text-[#6b6560] hover:bg-[#f0ece3]')}
                >
                  {t === 'all' ? '全部' : t === 'school_history' ? '校史' : t === 'honor_alumni' ? '校友' : t === 'campus' ? '校园' : t === 'guestbook' ? '留言壁' : t === 'contact' ? '联系' : t === 'program' ? '节目' : '通知'}
                </button>
              ))}
            </div>

            <div className="bg-white border border-[#e0dcd3] rounded p-5">
              <h3 className="text-sm font-semibold text-[#2c2c2c] mb-3">新增配置</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <select value={newConfig.type} onChange={(e) => setNewConfig({ ...newConfig, type: e.target.value })} className="px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]">
                  <option value="notice">通知公告</option>
                  <option value="school_history">校史拾遗</option>
                  <option value="honor_alumni">荣誉校友</option>
                  <option value="campus">雅学之境</option>
                  <option value="guestbook">学子留言壁</option>
                  <option value="contact">联系我们</option>
                  <option value="program">生贺节目</option>
                </select>
                <input type="text" placeholder="标题" value={newConfig.title} onChange={(e) => setNewConfig({ ...newConfig, title: e.target.value })} className="px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" />
                <input type="number" placeholder="排序" value={newConfig.sortOrder} onChange={(e) => setNewConfig({ ...newConfig, sortOrder: Number(e.target.value) })} className="px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" />
                <button
                  onClick={async () => {
                    if (!newConfig.title.trim()) return;
                    try {
                      await apiPost('/api/birthday/config', newConfig);
                      setNewConfig({ type: 'notice', title: '', content: '', sortOrder: 0 });
                      await fetchBirthday();
                      show('配置已创建', { variant: 'success' });
                    } catch {
                      show('创建失败', { variant: 'error' });
                    }
                  }}
                  className="px-5 py-2 bg-[#c8951e] text-white rounded text-sm font-medium hover:bg-[#dca828] transition-all"
                >
                  添加配置
                </button>
              </div>
              <textarea placeholder="内容 (支持 Markdown)" value={newConfig.content} onChange={(e) => setNewConfig({ ...newConfig, content: e.target.value })} className="w-full mt-3 px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e] h-24" />
            </div>

            <div className="bg-white border border-[#e0dcd3] rounded overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#f7f5f0] border-b border-[#e0dcd3]">
                      {['类型', '标题', '排序', '状态', '操作'].map((col) => (
                        <th key={col} className="px-5 py-3 text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0ece3]">
                    {birthdayLoading ? (
                      [1, 2, 3].map((i) => (
                        <tr key={i} className="animate-pulse"><td colSpan={5} className="px-5 py-4"><div className="h-6 bg-[#f7f5f0] rounded" /></td></tr>
                      ))
                    ) : (
                      (birthdayFilter === 'all' ? birthdayData : birthdayData.filter((d) => d.type === birthdayFilter)).map((item) => (
                        <tr key={item.id} className="hover:bg-[#f7f5f0] transition-colors group">
                          <td className="px-5 py-4"><span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">{item.type}</span></td>
                          <td className="px-5 py-4 text-sm font-medium text-[#2c2c2c]">{item.title}</td>
                          <td className="px-5 py-4 text-sm text-[#9e968e]">{item.sortOrder}</td>
                          <td className="px-5 py-4">
                            <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
                              {item.isActive ? '启用' : '禁用'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={async () => {
                                  try { await apiPatch(`/api/birthday/config/${item.id}/toggle`); await fetchBirthday(); show(item.isActive ? '已禁用' : '已启用', { variant: 'success' }); }
                                  catch { show('操作失败', { variant: 'error' }); }
                                }}
                                className={clsx('p-1.5 rounded transition-all', item.isActive ? 'text-amber-500 hover:bg-amber-50' : 'text-green-500 hover:bg-green-50')}
                                title={item.isActive ? '禁用' : '启用'}
                              >
                                {item.isActive ? <XCircle size={16} /> : <CheckCircle size={16} />}
                              </button>
                              <button onClick={() => setEditingConfig(item)} className="p-1.5 text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-all" title="编辑">
                                <Sparkles size={16} />
                              </button>
                              <button
                                onClick={async () => {
                                  if (!window.confirm('确定删除？')) return;
                                  try { await apiDelete(`/api/birthday/config/${item.id}`); await fetchBirthday(); show('已删除', { variant: 'success' }); }
                                  catch { show('删除失败', { variant: 'error' }); }
                                }}
                                className="p-1.5 text-red-400 hover:bg-red-50 rounded transition-all"
                                title="删除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
          <Icon size={24} className="text-[#c8951e]" /> {cfg.title}
        </h1>
      </div>
      {renderContent()}

      {editingConfig && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#e0dcd3] rounded p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-[#2c2c2c] mb-4">编辑配置</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#6b6560] mb-1">标题</label>
                <input type="text" value={editingConfig.title} onChange={(e) => setEditingConfig({ ...editingConfig, title: e.target.value })} className="w-full px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#6b6560] mb-1">排序</label>
                <input type="number" value={editingConfig.sortOrder} onChange={(e) => setEditingConfig({ ...editingConfig, sortOrder: Number(e.target.value) })} className="w-full px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#6b6560] mb-1">内容 (Markdown)</label>
                <textarea value={editingConfig.content} onChange={(e) => setEditingConfig({ ...editingConfig, content: e.target.value })} className="w-full px-4 py-2 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-sm focus:outline-none focus:border-[#c8951e] h-40" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditingConfig(null)} className="px-5 py-2 bg-[#f0ece3] text-[#6b6560] rounded font-medium hover:bg-[#e0dcd3] transition-all">取消</button>
              <button
                onClick={async () => {
                  try {
                    await apiPut(`/api/birthday/config/${editingConfig.id}`, {
                      title: editingConfig.title,
                      content: editingConfig.content,
                      sortOrder: editingConfig.sortOrder,
                    });
                    await fetchBirthday();
                    setEditingConfig(null);
                    show('配置已更新', { variant: 'success' });
                  } catch {
                    show('更新失败', { variant: 'error' });
                  }
                }}
                className="px-5 py-2 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminToolPage;
