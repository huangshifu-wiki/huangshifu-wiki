import React, { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { apiGet, apiPost } from '../../lib/apiClient';
import { useToast } from '../../components/Toast';

type Summary = { pending: number; processing: number; ready: number; failed: number; total: number };

type EmbeddingsStatus = {
  modelName: string;
  vectorSize: number;
  qdrantCollection: string;
  modelCacheDir: string;
  modelLoaded: boolean;
  modelError: string | null;
  usingModelScope: boolean;
  summary: Summary | { gallery: Summary; wiki: Summary; post: Summary };
};

function normalizeSummary(summary: EmbeddingsStatus['summary']) {
  if ('gallery' in summary) {
    return summary as { gallery: Summary; wiki: Summary; post: Summary };
  }
  const old = summary as Summary;
  return { gallery: old, wiki: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 }, post: { pending: 0, processing: 0, ready: 0, failed: 0, total: 0 } };
}

type EmbeddingsError = {
  id: string;
  galleryImageId: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  gallery?: { id: string; title: string };
  imageUrl?: string;
};

const StatusBadge = ({ status }: { status: string }) => {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-[#f0ece3]', text: 'text-[#6b6560]', label: '等待中' },
    processing: { bg: 'bg-[#fdf5d8]', text: 'text-[#c8951e]', label: '处理中' },
    ready: { bg: 'bg-green-50', text: 'text-green-700', label: '就绪' },
    failed: { bg: 'bg-red-50', text: 'text-red-600', label: '失败' },
  };
  const c = cfg[status] || cfg.pending;
  return <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', c.bg, c.text)}>{c.label}</span>;
};

const StatCard = ({ label, value, accent }: { label: string; value: number; accent?: string }) => (
  <div className="bg-white border border-[#e0dcd3] rounded p-4">
    <div className="flex items-center gap-2 mb-2">
      <BarChart3 size={14} className="text-[#9e968e]" />
      <span className="text-xs text-[#9e968e]">{label}</span>
    </div>
    <p className={clsx('text-2xl font-bold', accent || 'text-[#2c2c2c]')}>{value}</p>
  </div>
);

const AdminEmbeddings = () => {
  const [status, setStatus] = useState<EmbeddingsStatus | null>(null);
  const [errors, setErrors] = useState<EmbeddingsError[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [enqueueLimit, setEnqueueLimit] = useState(100);
  const { show } = useToast();

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const response = await apiGet<EmbeddingsStatus>('/api/embeddings/status');
      setStatus(response);
    } catch (error) {
      console.error(error);
      show('获取向量状态失败', { variant: 'error' });
    } finally { setLoading(false); }
  };

  const fetchErrors = async () => {
    setLoadingErrors(true);
    try {
      const response = await apiGet<{ errors: EmbeddingsError[]; total: number }>('/api/embeddings/errors', { limit: 50 });
      setErrors(response.errors || []);
    } catch (error) {
      console.error(error);
      show('获取错误列表失败', { variant: 'error' });
    } finally { setLoadingErrors(false); }
  };

  useEffect(() => { fetchStatus(); }, []);
  useEffect(() => { if (showErrors && errors.length === 0) fetchErrors(); }, [showErrors]);

  const handleEnqueueMissing = async () => {
    setActionLoading('enqueue');
    try {
      const response = await apiPost<{ gallery?: { requested: number; queued: number }; wiki?: { requested: number; queued: number }; post?: { requested: number; queued: number } }>('/api/embeddings/enqueue-missing', { limit: enqueueLimit });
      const parts: string[] = [];
      if (response.gallery) parts.push(`图库 ${response.gallery.queued} 个`);
      if (response.wiki) parts.push(`百科 ${response.wiki.queued} 个`);
      if (response.post) parts.push(`帖子 ${response.post.queued} 个`);
      show(parts.length > 0 ? `已加入队列: ${parts.join(', ')}` : '没有需要加入队列的任务');
      fetchStatus();
    } catch { show('补齐队列失败', { variant: 'error' }); }
    finally { setActionLoading(null); }
  };

  const handleSyncBatch = async () => {
    if (!window.confirm('确定要批量同步向量吗？这可能需要一些时间。')) return;
    setActionLoading('sync');
    try { await apiPost('/api/embeddings/sync-batch', { limit: 100 }); show('批量同步已启动'); fetchStatus(); }
    catch { show('批量同步失败', { variant: 'error' }); }
    finally { setActionLoading(null); }
  };

  const handleRetryFailed = async () => {
    if (!window.confirm('确定要重试所有失败的向量任务吗？')) return;
    setActionLoading('retry');
    try {
      const response = await apiPost<{ resetCount: number }>('/api/embeddings/retry-failed');
      show(`已重置 ${response.resetCount} 个失败任务`);
      fetchStatus();
      if (showErrors) fetchErrors();
    } catch { show('重试失败', { variant: 'error' }); }
    finally { setActionLoading(null); }
  };

  const handleRebuildAll = async () => {
    if (!window.confirm('确定要重建所有向量吗？这将删除现有向量并重新生成，耗时较长。')) return;
    if (!window.confirm('此操作不可逆，确定要继续吗？')) return;
    setActionLoading('rebuild');
    try { await apiPost('/api/embeddings/rebuild-all'); show('重建任务已启动'); fetchStatus(); }
    catch { show('重建失败', { variant: 'error' }); }
    finally { setActionLoading(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-[#9e968e]" />
      </div>
    );
  }

  const summary = status ? normalizeSummary(status.summary) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">向量 Embeddings 管理</h2>
        <button onClick={fetchStatus} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {status && summary && (
        <>
          {([
            { title: '图库图片', key: 'gallery' as const },
            { title: '百科图片', key: 'wiki' as const },
            { title: '帖子图片', key: 'post' as const },
          ]).map((section) => (
            <div key={section.key} className="bg-white border border-[#e0dcd3] rounded p-5">
              <h3 className="text-sm font-semibold text-[#6b6560] mb-3">{section.title}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="等待中" value={summary[section.key].pending} />
                <StatCard label="处理中" value={summary[section.key].processing} accent="text-[#c8951e]" />
                <StatCard label="就绪" value={summary[section.key].ready} accent="text-green-600" />
                <StatCard label="失败" value={summary[section.key].failed} accent="text-red-500" />
              </div>
            </div>
          ))}

          <div className="bg-white border border-[#e0dcd3] rounded p-5">
            <h3 className="text-sm font-semibold text-[#6b6560] mb-3">配置信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div><span className="text-[#9e968e]">模型：</span><span className="font-medium text-[#2c2c2c]">{status.modelName}</span></div>
              <div><span className="text-[#9e968e]">向量维度：</span><span className="font-medium text-[#2c2c2c]">{status.vectorSize}</span></div>
              <div><span className="text-[#9e968e]">集合名称：</span><span className="font-medium text-[#2c2c2c]">{status.qdrantCollection}</span></div>
            </div>
            <div className="mt-4 pt-4 border-t border-[#f0ece3]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-[#9e968e]">模型状态：</span>
                {status.modelLoaded ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">已加载</span>
                ) : status.modelError ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600">加载失败</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#f0ece3] text-[#6b6560]">未加载</span>
                )}
                <span className="text-[10px] text-[#9e968e]">({status.usingModelScope ? 'ModelScope 镜像' : 'Hugging Face'})</span>
              </div>
              {status.modelError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded mt-2">
                  <p className="text-xs text-red-600 font-medium mb-1">模型加载错误：</p>
                  <p className="text-xs text-red-500">{status.modelError}</p>
                </div>
              )}
              <div className="mt-2 text-xs text-[#9e968e]">缓存目录：{status.modelCacheDir}</div>
            </div>
          </div>

          <div className="bg-white border border-[#e0dcd3] rounded p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#6b6560]">批量操作</h3>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={enqueueLimit}
                  onChange={(e) => setEnqueueLimit(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 px-3 py-2 rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e]"
                  min={1} max={2000}
                />
                <button onClick={handleEnqueueMissing} disabled={actionLoading !== null} className="px-4 py-2 rounded bg-[#c8951e] text-white text-sm font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center gap-2 transition-all">
                  {actionLoading === 'enqueue' ? <Loader2 size={14} className="animate-spin" /> : null} 补齐缺失
                </button>
              </div>
              <button onClick={handleSyncBatch} disabled={actionLoading !== null} className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] text-sm font-medium hover:text-[#c8951e] hover:border-[#c8951e] disabled:opacity-50 inline-flex items-center gap-2 transition-all">
                {actionLoading === 'sync' ? <Loader2 size={14} className="animate-spin" /> : null} 批量同步
              </button>
              <button onClick={() => setShowErrors(!showErrors)} disabled={actionLoading !== null} className={clsx('px-4 py-2 rounded border text-sm font-medium inline-flex items-center gap-2 transition-all', showErrors ? 'border-red-200 bg-red-50 text-red-600' : 'border-[#e0dcd3] text-[#6b6560] hover:bg-[#f7f5f0]', actionLoading !== null && 'opacity-50')}>
                <AlertTriangle size={14} /> 查看错误 ({summary.gallery.failed + summary.wiki.failed + summary.post.failed})
              </button>
              <button onClick={handleRetryFailed} disabled={actionLoading !== null || (summary.gallery.failed + summary.wiki.failed + summary.post.failed) === 0} className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] text-sm font-medium hover:text-[#c8951e] hover:border-[#c8951e] disabled:opacity-50 inline-flex items-center gap-2 transition-all">
                {actionLoading === 'retry' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 重试失败
              </button>
              <button onClick={handleRebuildAll} disabled={actionLoading !== null} className="px-4 py-2 rounded border border-red-200 bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 disabled:opacity-50 inline-flex items-center gap-2 transition-all">
                {actionLoading === 'rebuild' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 重建全部
              </button>
            </div>
          </div>
        </>
      )}

      {showErrors && (
        <div className="bg-white border border-[#e0dcd3] rounded p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#6b6560]">错误列表</h3>
            <button onClick={() => setShowErrors(false)} className="p-1 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors">
              <XCircle size={18} />
            </button>
          </div>
          {loadingErrors ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-[#9e968e]" />
            </div>
          ) : errors.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {errors.map((error) => (
                <div key={error.id} className="flex items-start gap-3 p-3 rounded border border-[#f0ece3] hover:bg-[#f7f5f0] transition-colors">
                  <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={error.status} />
                      <span className="text-xs text-[#9e968e]">{format(new Date(error.updatedAt), 'yyyy-MM-dd HH:mm')}</span>
                    </div>
                    <p className="text-sm text-[#2c2c2c] truncate">{error.gallery?.title || `图片 ID: ${error.galleryImageId}`}</p>
                    {error.errorMessage && <p className="text-xs text-red-500 mt-1">{error.errorMessage}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[#9e968e] text-sm">暂无错误</div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminEmbeddings;
