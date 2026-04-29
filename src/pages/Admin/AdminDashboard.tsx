import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Book, Music, MessageSquare, Image as ImageIcon, Users, Layers, Megaphone, Lock, RefreshCw } from 'lucide-react';
import { apiGet } from '../../lib/apiClient';

const cards = [
  { key: 'wiki', label: '百科', path: '/admin/wiki', icon: Book, countKey: 'wiki' },
  { key: 'music', label: '音乐', path: '/admin/music', icon: Music, countKey: 'music' },
  { key: 'posts', label: '帖子', path: '/admin/posts', icon: MessageSquare, countKey: 'posts' },
  { key: 'galleries', label: '图集', path: '/admin/galleries', icon: ImageIcon, countKey: 'galleries' },
  { key: 'users', label: '用户', path: '/admin/users', icon: Users, countKey: 'users' },
  { key: 'sections', label: '版块', path: '/admin/sections', icon: Layers, countKey: 'sections' },
  { key: 'announcements', label: '公告', path: '/admin/announcements', icon: Megaphone, countKey: 'announcements' },
  { key: 'locks', label: '编辑锁', path: '/admin/locks', icon: Lock, countKey: 'locks' },
];

export const AdminDashboard = () => {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const results: Record<string, number> = {};
      await Promise.all(
        cards.map(async (c) => {
          try {
            const data = await apiGet<{ data?: any[]; locks?: any[] }>(`/api/admin/${c.key}`);
            const arr = data.data || (data as any).locks || [];
            results[c.key] = arr.length;
          } catch {
            results[c.key] = 0;
          }
        }),
      );
      setStats(results);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">仪表盘</h1>
          <p className="text-sm text-[#9e968e] mt-1">总内容量：{total}</p>
        </div>
        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.key} className="bg-white border border-[#e0dcd3] rounded p-5 animate-pulse">
              <div className="h-4 bg-[#f0ece3] rounded w-16 mb-3" />
              <div className="h-8 bg-[#f0ece3] rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.key}
                to={c.path}
                className="bg-white border border-[#e0dcd3] rounded p-5 hover:border-[#c8951e] transition-all group"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={16} className="text-[#9e968e] group-hover:text-[#c8951e] transition-colors" />
                  <span className="text-sm text-[#9e968e] group-hover:text-[#c8951e] transition-colors">{c.label}</span>
                </div>
                <p className="text-2xl font-bold text-[#2c2c2c]">{stats[c.key] ?? 0}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
