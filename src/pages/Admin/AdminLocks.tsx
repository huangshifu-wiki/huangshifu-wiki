import React, { useEffect, useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { apiDelete, apiGet } from '../../lib/apiClient';
import { formatDateTime } from '../../lib/dateUtils';
import { useToast } from '../../components/Toast';
import type { EditLockItem } from '../../types/entities';

export const AdminLocks = () => {
  const [data, setData] = useState<EditLockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { show } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await apiGet<{ locks: EditLockItem[] }>('/api/admin/locks');
      setData(result.locks || []);
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const releaseLock = async (lock: EditLockItem) => {
    if (!window.confirm('确定要强制释放这个编辑锁吗？')) return;
    try {
      await apiDelete(`/api/admin/locks/${lock.collection}/${encodeURIComponent(lock.recordId)}`);
      setData((prev) => prev.filter((item) => item.id !== lock.id));
      show('已释放', { variant: 'success' });
    } catch (e) {
      show('释放失败', { variant: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">编辑锁</h1>
        <button onClick={fetchData} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all">
          <RefreshCw size={14} className="inline mr-1" /> 刷新
        </button>
      </div>

      <div className="bg-white border border-[#e0dcd3] rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f7f5f0] border-b border-[#e0dcd3]">
                {['资源', '锁定者', '到期时间', '操作'].map((col) => (
                  <th key={col} className="px-5 py-3 text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece3]">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={4} className="px-5 py-4"><div className="h-6 bg-[#f7f5f0] rounded" /></td>
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-[#f7f5f0] transition-colors group">
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-[#2c2c2c]">{item.collection} / {item.recordId}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-[#6b6560]">{item.username} ({item.userId?.slice(0, 8) ?? '未知'})</td>
                    <td className="px-5 py-4 text-xs text-[#9e968e]">{formatDateTime(item.expiresAt, 'N/A')}</td>
                    <td className="px-5 py-4 text-right">
                      <button onClick={() => releaseLock(item)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-all opacity-0 group-hover:opacity-100" title="强制释放">
                        <Lock size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} className="px-5 py-16 text-center text-[#9e968e] italic">暂无编辑锁</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminLocks;
