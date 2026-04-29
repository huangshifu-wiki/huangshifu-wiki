import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Shield, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { apiGet } from '../../lib/apiClient';
import { formatDateTime } from '../../lib/dateUtils';
import type { AdminDataItem } from '../../types/entities';

export const AdminLogs = ({ type: propType }: { type?: 'moderation_logs' | 'ban_logs' }) => {
  const { type: paramType } = useParams<{ type: 'moderation_logs' | 'ban_logs' }>();
  const logType = propType || paramType || 'moderation_logs';
  const [data, setData] = useState<AdminDataItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await apiGet<{ logs: AdminDataItem[] }>(`/api/admin/${logType}`);
      setData(result.logs || []);
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [logType]);

  const Icon = logType === 'ban_logs' ? Shield : FileText;
  const title = logType === 'ban_logs' ? '封禁日志' : '操作日志';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
          <Icon size={24} className="text-[#c8951e]" /> {title}
        </h1>
        <button onClick={fetchData} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all">
          <RefreshCw size={14} className="inline mr-1" /> 刷新
        </button>
      </div>

      <div className="bg-white border border-[#e0dcd3] rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f7f5f0] border-b border-[#e0dcd3]">
                {['时间', '操作者', '目标', '操作类型', '备注'].map((col) => (
                  <th key={col} className="px-5 py-3 text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece3]">
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-5 py-4"><div className="h-6 bg-[#f7f5f0] rounded" /></td>
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-[#f7f5f0] transition-colors">
                    <td className="px-5 py-4 text-sm text-[#9e968e] whitespace-nowrap">{formatDateTime(item.createdAt, 'N/A')}</td>
                    <td className="px-5 py-4 text-sm font-medium text-[#2c2c2c]">{item.operatorName || item.operatorUid}</td>
                    <td className="px-5 py-4 text-sm text-[#6b6560]">
                      {logType === 'ban_logs' ? (
                        <span className="font-medium text-[#2c2c2c]">{item.targetName || item.targetUid}</span>
                      ) : (
                        <div>
                          <span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">{item.targetType}</span>
                          <span className="ml-2 text-[#9e968e] font-mono text-xs">{item.targetId}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {logType === 'ban_logs' ? (
                        <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.action === 'ban' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700')}>
                          {item.action === 'ban' ? '封禁' : '解封'}
                        </span>
                      ) : (
                        <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.action === 'approve' ? 'bg-green-50 text-green-700' : item.action === 'reject' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600')}>
                          {item.action === 'approve' ? '通过' : item.action === 'reject' ? '驳回' : item.action}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-[#9e968e] max-w-[200px] truncate">{item.note || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="px-5 py-16 text-center text-[#9e968e] italic">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminLogs;
