import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { apiGet, apiPut } from '../../lib/apiClient';
import { formatDateTime, toDateValue } from '../../lib/dateUtils';
import { useToast } from '../../components/Toast';

type ReviewQueueItem = {
  id: string;
  slug?: string;
  title?: string;
  content?: string;
  updatedAt?: string;
  sensitiveWords?: string[];
  reviewType: string;
  reviewId: string;
};

type ReviewFilter = 'all' | 'wiki' | 'posts';

export const AdminReviews = () => {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const { show } = useToast();

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const requests: Promise<{ type: string; items: any[] }>[] = [];
      if (filter === 'all' || filter === 'wiki') {
        requests.push(apiGet<{ type: string; items: any[] }>('/api/admin/review-queue', { type: 'wiki', status: 'pending' }));
      }
      if (filter === 'all' || filter === 'posts') {
        requests.push(apiGet<{ type: string; items: any[] }>('/api/admin/review-queue', { type: 'posts', status: 'pending' }));
      }
      const results = await Promise.all(requests);
      const merged = results.flatMap((bucket) =>
        (bucket.items || []).map((item) => ({
          ...item,
          reviewType: bucket.type,
          reviewId: bucket.type === 'wiki' ? item.slug : item.id,
        })),
      );
      merged.sort((a, b) => {
        const left = toDateValue(a.updatedAt)?.getTime() || 0;
        const right = toDateValue(b.updatedAt)?.getTime() || 0;
        return right - left;
      });
      setItems(merged);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [filter]);

  const handleAction = async (item: ReviewQueueItem, action: 'approve' | 'reject') => {
    const note = window.prompt(action === 'approve' ? '通过备注（可选）' : '驳回原因（可选）', action === 'reject' ? '请按规范完善内容' : '') || '';
    try {
      await apiPut(`/api/admin/review-queue/${item.reviewId}/${action}`, { note });
      await fetchQueue();
      show(action === 'approve' ? '已通过' : '已驳回', { variant: 'success' });
    } catch (e) {
      show(action === 'approve' ? '审核通过失败' : '驳回失败', { variant: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">审核队列</h1>
        <button onClick={fetchQueue} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all">
          刷新队列
        </button>
      </div>

      <div className="bg-white border border-[#e0dcd3] rounded p-4 flex flex-wrap items-center gap-3">
        {([
          { id: 'all', label: '全部待审' },
          { id: 'wiki', label: '百科待审' },
          { id: 'posts', label: '帖子待审' },
        ] as { id: ReviewFilter; label: string }[]).map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={clsx(
              'px-4 py-2 rounded text-xs font-medium transition-all',
              filter === item.id ? 'bg-[#c8951e] text-white' : 'bg-[#f7f5f0] text-[#6b6560] hover:bg-[#f0ece3]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-white border border-[#e0dcd3] rounded animate-pulse" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.reviewType}-${item.reviewId}`} className="bg-white border border-[#e0dcd3] rounded p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={clsx('px-2 py-0.5 text-[10px] font-medium rounded', item.reviewType === 'wiki' ? 'bg-[#f7f5f0] text-[#c8951e]' : 'bg-[#f0ece3] text-[#6b6560]')}>
                      {item.reviewType === 'wiki' ? '百科' : '帖子'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700">待审核</span>
                  </div>
                  <p className="font-semibold text-[#2c2c2c] mb-1">{item.title || item.slug || item.id}</p>
                  <p className="text-xs text-[#9e968e] line-clamp-2">{(String(item.content || '')).replace(/[#*`]/g, '').slice(0, 160) || '无内容摘要'}</p>
                  <p className="text-[10px] text-[#9e968e] mt-2">更新时间：{formatDateTime(item.updatedAt, 'N/A')}</p>
                  {Array.isArray(item.sensitiveWords) && item.sensitiveWords.length > 0 && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <span className="text-[10px] font-medium text-red-600">检测到敏感词: </span>
                      {item.sensitiveWords.map((w) => (
                        <span key={w} className="text-[10px] text-red-500 mr-1">#{w}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleAction(item, 'reject')} className="px-4 py-2 rounded text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-all">
                    驳回
                  </button>
                  <button onClick={() => handleAction(item, 'approve')} className="px-4 py-2 rounded text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-all">
                    通过
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-[#e0dcd3] rounded py-16 text-center text-[#9e968e] italic">当前没有待审核内容</div>
      )}
    </div>
  );
};

export default AdminReviews;
