import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Database, Download, Loader2, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { apiDelete, apiGet, apiPost, apiUpload, apiDownload } from '../../lib/apiClient';
import { useToast } from '../../components/Toast';

type BackupFile = {
  filename: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
};

type BackupCreateResponse = { backup: BackupFile };
type BackupListResponse = { backups: BackupFile[] };
type DialogType = 'create' | 'restore' | 'delete' | null;

const AdminBackups = () => {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [password, setPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const { show } = useToast();

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet<BackupListResponse>('/api/admin/backup/list');
      setBackups(response.backups || []);
    } catch (error) {
      console.error('Fetch backups failed:', error);
      show('获取备份列表失败', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const closeDialog = () => {
    setDialog(null);
    setPassword('');
    setDeleteTarget(null);
    setRestoreFile(null);
  };

  const handleCreate = async () => {
    if (!password.trim()) { show('请输入备份密码', { variant: 'error' }); return; }
    setActionLoading('create');
    try {
      await apiPost<BackupCreateResponse>('/api/admin/backup/create', { password });
      show('备份创建成功');
      closeDialog();
      fetchBackups();
    } catch (error) {
      show(error instanceof Error ? error.message : '创建备份失败', { variant: 'error' });
    } finally { setActionLoading(null); }
  };

  const handleDownload = async (filename: string) => {
    try {
      const response = await apiDownload(`/api/admin/backup/${encodeURIComponent(filename)}/download`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '下载失败');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show('下载完成', { variant: 'success' });
    } catch (error) {
      show(error instanceof Error ? error.message : '下载失败', { variant: 'error' });
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) { show('请选择备份文件', { variant: 'error' }); return; }
    if (!password.trim()) { show('请输入备份密码', { variant: 'error' }); return; }
    setActionLoading('restore');
    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      formData.append('password', password);
      formData.append('confirm', 'true');
      await apiUpload<{ success: boolean }>('/api/admin/backup/restore', formData);
      show('数据库恢复成功');
      closeDialog();
    } catch (error) {
      show(error instanceof Error ? error.message : '恢复失败', { variant: 'error' });
    } finally { setActionLoading(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!password.trim()) { show('请输入备份密码', { variant: 'error' }); return; }
    setActionLoading('delete');
    try {
      await apiDelete(`/api/admin/backup/${encodeURIComponent(deleteTarget)}?password=${encodeURIComponent(password)}`);
      show('备份已删除');
      closeDialog();
      fetchBackups();
    } catch (error) {
      show(error instanceof Error ? error.message : '删除失败', { variant: 'error' });
    } finally { setActionLoading(null); }
  };

  const openDeleteDialog = (filename: string) => {
    setDeleteTarget(filename);
    setDialog('delete');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={32} className="animate-spin text-[#9e968e]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#2c2c2c] tracking-[0.12em]">数据库备份</h2>
        <div className="flex items-center gap-3">
          <button onClick={fetchBackups} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> 刷新
          </button>
          <button onClick={() => setDialog('restore')} className="px-4 py-2 border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded text-sm transition-all inline-flex items-center gap-1.5">
            <Upload size={14} /> 上传恢复
          </button>
          <button onClick={() => setDialog('create')} className="px-4 py-2 bg-[#c8951e] text-white rounded text-sm font-medium hover:bg-[#dca828] transition-all inline-flex items-center gap-1.5">
            <Database size={14} /> 创建备份
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#e0dcd3] rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f7f5f0] border-b border-[#e0dcd3]">
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">文件名</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">创建时间</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">大小</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9e968e] uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ece3]">
            {backups.length > 0 ? (
              backups.map((backup) => (
                <tr key={backup.filename} className="hover:bg-[#f7f5f0] transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Database size={16} className="text-[#9e968e] shrink-0" />
                      <span className="text-sm font-medium text-[#2c2c2c]">{backup.filename}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#6b6560]">{format(new Date(backup.createdAt), 'yyyy-MM-dd HH:mm:ss')}</td>
                  <td className="px-5 py-4 text-sm text-[#6b6560]">{backup.sizeFormatted}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleDownload(backup.filename)} className="p-2 text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-all" title="下载">
                        <Download size={18} />
                      </button>
                      <button onClick={() => openDeleteDialog(backup.filename)} className="p-2 text-red-400 hover:bg-red-50 rounded transition-all" title="删除">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-5 py-16 text-center text-[#9e968e] italic">暂无备份记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDialog}>
          <div className="bg-white border border-[#e0dcd3] rounded w-full max-w-md mx-4 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#2c2c2c]">
                {dialog === 'create' && '创建备份'}
                {dialog === 'restore' && '上传备份恢复'}
                {dialog === 'delete' && '删除备份'}
              </h3>
              <button onClick={closeDialog} className="p-1 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0]">
                <XCircle size={20} />
              </button>
            </div>

            {(dialog === 'restore' || dialog === 'delete') && (
              <div className="flex items-start gap-3 p-3 rounded bg-amber-50 border border-amber-200">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  {dialog === 'restore' ? '恢复操作将覆盖当前数据库中的所有数据，此操作不可逆，请谨慎操作。' : '删除后无法恢复，请确认操作。'}
                </p>
              </div>
            )}

            {dialog === 'restore' && (
              <div>
                <label className="block text-sm font-medium text-[#6b6560] mb-2">选择备份文件</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-[#6b6560] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-[#f7f5f0] file:text-[#2c2c2c] hover:file:bg-[#f0ece3]"
                />
                {restoreFile && (
                  <p className="mt-1.5 text-xs text-[#9e968e]">已选择: {restoreFile.name} ({(restoreFile.size / (1024 * 1024)).toFixed(1)} MB)</p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#6b6560] mb-2">{dialog === 'create' ? '备份密码（用于加密和恢复验证）' : '备份密码'}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入备份密码"
                className="w-full px-4 py-2.5 rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (dialog === 'create') handleCreate();
                    else if (dialog === 'restore') handleRestore();
                    else if (dialog === 'delete') handleDelete();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={closeDialog} className="px-4 py-2 rounded border border-[#e0dcd3] text-sm text-[#6b6560] hover:bg-[#f7f5f0] transition-all">取消</button>
              <button
                onClick={() => { if (dialog === 'create') handleCreate(); else if (dialog === 'restore') handleRestore(); else if (dialog === 'delete') handleDelete(); }}
                disabled={actionLoading !== null}
                className={clsx('px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 inline-flex items-center gap-2', dialog === 'delete' || dialog === 'restore' ? 'bg-red-500 hover:bg-red-600' : 'bg-[#c8951e] hover:bg-[#dca828]')}
              >
                {actionLoading && <Loader2 size={14} className="animate-spin" />}
                {dialog === 'create' && '创建备份'}
                {dialog === 'restore' && '恢复数据库'}
                {dialog === 'delete' && '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminBackups;
