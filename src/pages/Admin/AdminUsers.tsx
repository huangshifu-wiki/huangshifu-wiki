import React, { useEffect, useState } from 'react';
import { Trash2, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';
import { useToast } from '../../components/Toast';
import { SmartImage } from '../../components/SmartImage';
import { useAuth } from '../../context/AuthContext';
import type { AdminDataItem } from '../../types/entities';

export const AdminUsers = () => {
  const { user: currentUser, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const [data, setData] = useState<AdminDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { show } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await apiGet<{ data: AdminDataItem[] }>('/api/admin/users');
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
  }, []);

  const toggleBan = async (target: AdminDataItem) => {
    if (!target.uid || target.uid === currentUser?.uid) return;
    const shouldUnban = target.status === 'banned';
    if (!window.confirm(`确定要${shouldUnban ? '解封' : '封禁'} ${target.displayName || target.uid} 吗？`)) return;
    const note = window.prompt(shouldUnban ? '解封备注（可选）' : '封禁原因', shouldUnban ? '' : '违反社区规范') || '';
    if (!shouldUnban && !note.trim()) {
      show('请输入封禁原因', { variant: 'error' });
      return;
    }
    try {
      const endpoint = shouldUnban ? `/api/admin/users/${target.uid}/unban` : `/api/admin/users/${target.uid}/ban`;
      const result = await apiPost<{ user: AdminDataItem }>(endpoint, shouldUnban ? { note } : { reason: note, note });
      setData((prev) => prev.map((item) => (item.uid === target.uid ? { ...item, ...result.user } : item)));
      show(shouldUnban ? '已解封' : '已封禁', { variant: 'success' });
    } catch (e) {
      show(shouldUnban ? '解封失败' : '封禁失败', { variant: 'error' });
    }
  };

  const toggleRole = async (target: AdminDataItem) => {
    if (!isSuperAdmin) {
      show('只有超级管理员可以更改权限', { variant: 'error' });
      return;
    }
    const newRole = target.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm(`确定要将 ${target.displayName || target.uid} 的角色更改为 ${newRole} 吗？`)) return;
    try {
      await apiPatch(`/api/users/${target.uid}/role`, { role: newRole });
      setData((prev) => prev.map((item) => (item.uid === target.uid ? { ...item, role: newRole } : item)));
      show('角色已更新', { variant: 'success' });
    } catch (e) {
      show('更新角色失败', { variant: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">用户管理</h1>
        <button onClick={fetchData} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all">
          <RefreshCw size={14} className="inline mr-1" /> 刷新
        </button>
      </div>

      <div className="bg-white border border-[#e0dcd3] rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f7f5f0] border-b border-[#e0dcd3]">
                {['用户', '角色', '状态', '操作'].map((col) => (
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
                  <tr key={item.uid} className="hover:bg-[#f7f5f0] transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <SmartImage src={item.photoURL || ''} alt="" className="w-10 h-10 rounded-full object-cover bg-[#f7f5f0]" />
                        <div>
                          <p className="text-sm font-medium text-[#2c2c2c]">{item.displayName || item.uid}</p>
                          <p className="text-xs text-[#9e968e]">{item.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.role === 'super_admin' ? 'bg-purple-50 text-purple-600' : item.role === 'admin' ? 'bg-red-50 text-red-600' : 'bg-[#f7f5f0] text-[#c8951e]')}>
                        {item.role === 'super_admin' ? '超级管理员' : item.role || 'user'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={clsx('px-2 py-0.5 rounded text-[10px] font-medium', item.status === 'banned' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700')}>
                        {item.status === 'banned' ? '已封禁' : '正常'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isSuperAdmin && item.uid !== currentUser?.uid && (
                          <button onClick={() => toggleRole(item)} className="p-1.5 text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-all" title={item.role === 'admin' ? '取消管理员' : '设为管理员'}>
                            {item.role === 'admin' ? <XCircle size={16} /> : <CheckCircle size={16} />}
                          </button>
                        )}
                        {item.uid !== currentUser?.uid && (
                          <button onClick={() => toggleBan(item)} className={clsx('p-1.5 rounded transition-all', item.status === 'banned' ? 'text-green-600 hover:bg-green-50' : 'text-amber-600 hover:bg-amber-50')} title={item.status === 'banned' ? '解封' : '封禁'}>
                            {item.status === 'banned' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                          </button>
                        )}
                        <button onClick={() => {
                          if (window.confirm('确定删除此用户吗？')) {
                            apiDelete(`/api/admin/users/${item.uid}`).then(() => {
                              setData((prev) => prev.filter((d) => d.uid !== item.uid));
                              show('已删除', { variant: 'success' });
                            }).catch(() => show('删除失败', { variant: 'error' }));
                          }
                        }} className="p-1.5 text-red-400 hover:bg-red-50 rounded transition-all" title="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} className="px-5 py-16 text-center text-[#9e968e] italic">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminUsers;
