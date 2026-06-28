import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, RefreshCw, Settings, Save, X, RotateCcw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { apiGet, apiPut, apiPost } from '../../lib/apiClient';
import { useDialog } from '../../components/Dialog';

interface DiskStatus {
  totalSpaceGB: number;
  freeSpaceGB: number;
  usedSpaceGB: number;
  usagePercent: number;
  status: 'healthy' | 'warning' | 'critical';
  lastChecked: string;
  uploadsDir?: { fileCount: number; totalSizeMB: number };
  originalDir?: { fileCount: number; totalSizeMB: number };
  variantsDir?: { fileCount: number; totalSizeMB: number };
}

interface DiskMonitorConfig {
  warningThresholdGB: number;
  criticalThresholdGB: number;
  checkIntervalMs: number;
  uploadsMinFreeMB: number;
}

type DiskApiResponse<T> = { success: boolean; data: T; error?: string };

const NO_CACHE_OPTIONS = { staleTime: 0, swr: false };

function getDiskRequestError<T>(
  result: PromiseSettledResult<DiskApiResponse<T>>,
  fallback: string
) {
  if (result.status === 'rejected') {
    return result.reason instanceof Error ? result.reason.message : fallback;
  }

  return result.value.success ? null : result.value.error || fallback;
}

export const AdminDiskMonitor: React.FC = () => {
  const [diskStatus, setDiskStatus] = useState<DiskStatus | null>(null);
  const [config, setConfig] = useState<DiskMonitorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<Partial<DiskMonitorConfig>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const dialog = useDialog();

  const fetchDiskStatus = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const { showLoading = true } = options;
    try {
      if (showLoading) setLoading(true);
      if (showLoading) setError(null);
      const [statusRes, configRes] = await Promise.allSettled([
        apiGet<DiskApiResponse<DiskStatus>>('/api/admin/disk/status', undefined, NO_CACHE_OPTIONS),
        apiGet<DiskApiResponse<DiskMonitorConfig>>('/api/admin/disk/config', undefined, NO_CACHE_OPTIONS),
      ]);
      if (statusRes.status === 'fulfilled' && statusRes.value.success) {
        setDiskStatus(statusRes.value.data);
      }
      if (configRes.status === 'fulfilled' && configRes.value.success) {
        setConfig(configRes.value.data);
      }
      const errors = [
        getDiskRequestError(statusRes, '获取磁盘状态失败'),
        getDiskRequestError(configRes, '获取监控配置失败'),
      ].filter((message): message is string => Boolean(message));
      if (errors.length > 0) throw new Error(errors.join('；'));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch disk status:', err);
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const [statusRes, configRes] = await Promise.allSettled([
        apiPost<DiskApiResponse<DiskStatus>>('/api/admin/disk/check'),
        apiGet<DiskApiResponse<DiskMonitorConfig>>('/api/admin/disk/config', undefined, NO_CACHE_OPTIONS),
      ]);
      if (statusRes.status === 'fulfilled' && statusRes.value.success) {
        setDiskStatus(statusRes.value.data);
      }
      if (configRes.status === 'fulfilled' && configRes.value.success) {
        setConfig(configRes.value.data);
      }
      const errors = [
        getDiskRequestError(statusRes, '刷新磁盘状态失败'),
        getDiskRequestError(configRes, '获取监控配置失败'),
      ].filter((message): message is string => Boolean(message));
      if (errors.length > 0) throw new Error(errors.join('；'));
    } catch (err) {
      console.error('Failed to refresh disk status:', err);
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDiskStatus();
    const interval = setInterval(() => fetchDiskStatus({ showLoading: false }), 30000);
    return () => clearInterval(interval);
  }, [fetchDiskStatus]);

  const handleStartEdit = () => {
    if (config) {
      setEditingConfig({ ...config });
      setIsEditing(true);
      setValidationErrors([]);
      setSaveSuccess(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingConfig({});
    setValidationErrors([]);
  };

  const validateConfig = (nc: Partial<DiskMonitorConfig>): string[] => {
    const errors: string[] = [];
    if ('warningThresholdGB' in nc && (typeof nc.warningThresholdGB !== 'number' || nc.warningThresholdGB <= 0)) {
      errors.push('警告阈值必须是正数');
    }
    if ('criticalThresholdGB' in nc && (typeof nc.criticalThresholdGB !== 'number' || nc.criticalThresholdGB <= 0)) {
      errors.push('严重阈值必须是正数');
    }
    if (nc.warningThresholdGB && nc.criticalThresholdGB && nc.criticalThresholdGB >= nc.warningThresholdGB) {
      errors.push('严重阈值必须小于警告阈值');
    }
    if ('checkIntervalMs' in nc && (typeof nc.checkIntervalMs !== 'number' || nc.checkIntervalMs < 60000)) {
      errors.push('检查间隔必须 >= 60 秒');
    }
    if ('uploadsMinFreeMB' in nc && (typeof nc.uploadsMinFreeMB !== 'number' || nc.uploadsMinFreeMB < 10)) {
      errors.push('最小空闲空间必须 >= 10 MB');
    }
    return errors;
  };

  const handleSaveConfig = async () => {
    const errors = validateConfig(editingConfig);
    if (errors.length > 0) { setValidationErrors(errors); return; }
    try {
      setSaving(true);
      setValidationErrors([]);
      const result = await apiPut<{ success: boolean; data: DiskMonitorConfig; error?: string }>('/api/admin/disk/config', editingConfig);
      if (result.success) {
        setConfig(result.data);
        setIsEditing(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const confirmed = await dialog.confirm({
      title: '重置磁盘监控配置',
      message: '确定要重置为默认配置吗？',
      confirmText: '重置',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      setSaving(true);
      const result = await apiPost<{ success: boolean; data: DiskMonitorConfig }>('/api/admin/disk/config/reset');
      if (result.success) {
        setConfig(result.data);
        setEditingConfig({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setSaving(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === 'critical') return 'theme-status-error border-border';
    if (status === 'warning') return 'theme-status-warning border-border';
    return 'theme-status-success border-border';
  };

  const statusIcon = (status: string) => {
    if (status === 'critical') return <XCircle size={14} className="theme-text-error" />;
    if (status === 'warning') return <AlertTriangle size={14} className="theme-text-warning" />;
    return <CheckCircle size={14} className="theme-text-success" />;
  };

  const barColor = (status: string) => {
    if (status === 'critical') return 'bg-[var(--color-error)]';
    if (status === 'warning') return 'bg-[var(--color-warning)]';
    return 'bg-brand-gold-dark';
  };

  if (loading && !diskStatus) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">磁盘监控</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface border border-border rounded p-5 animate-pulse">
              <div className="h-4 bg-bg-tertiary rounded w-16 mb-3" />
              <div className="h-8 bg-bg-tertiary rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !diskStatus) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">磁盘监控</h1>
        <div className="p-4 theme-status-error rounded">
          <p className="text-sm theme-text-error font-medium">{error}</p>
          <button onClick={() => fetchDiskStatus()} className="mt-2 px-4 py-2 theme-button-primary rounded text-sm font-medium transition-all">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive size={24} className="text-brand-gold" />
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">磁盘监控</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> 刷新
          </button>
          <button
            onClick={handleStartEdit}
            disabled={!config}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
          >
            <Settings size={16} /> 修改阈值
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-3 rounded theme-status-error">
          <XCircle size={18} className="theme-text-error shrink-0 mt-0.5" />
          <p className="text-sm theme-text-error flex-1">{error}</p>
          <button onClick={() => setError(null)} className="p-1 theme-icon-button-danger">
            <X size={14} />
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="flex items-center gap-3 p-3 rounded theme-status-success">
          <CheckCircle size={18} className="theme-text-success shrink-0" />
          <p className="text-sm font-medium theme-text-success">配置保存成功，新阈值已立即生效</p>
        </div>
      )}

      {diskStatus && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface border border-border rounded p-5">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={14} className="text-text-muted" />
                <span className="text-xs text-text-muted">总容量</span>
              </div>
              <p className="text-2xl font-bold text-text-primary">{diskStatus.totalSpaceGB.toFixed(1)}<span className="text-sm font-normal text-text-muted ml-1">GB</span></p>
            </div>

            <div className="bg-surface border border-border rounded p-5">
              <div className="flex items-center gap-2 mb-2">
                {statusIcon(diskStatus.status)}
                <span className="text-xs text-text-muted">剩余空间</span>
              </div>
              <p className={`text-2xl font-bold ${diskStatus.status === 'critical' ? 'theme-text-error' : 'text-text-primary'}`}>
                {diskStatus.freeSpaceGB.toFixed(1)}<span className="text-sm font-normal text-text-muted ml-1">GB</span>
              </p>
            </div>

            <div className="bg-surface border border-border rounded p-5">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={14} className="text-text-muted" />
                <span className="text-xs text-text-muted">已使用</span>
              </div>
              <p className="text-2xl font-bold text-text-primary">{diskStatus.usedSpaceGB.toFixed(1)}<span className="text-sm font-normal text-text-muted ml-1">GB</span></p>
            </div>

            <div className="bg-surface border border-border rounded p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor(diskStatus.status)}`}>
                  {diskStatus.status === 'healthy' ? '健康' : diskStatus.status === 'warning' ? '警告' : '严重'}
                </span>
                <span className="text-xs text-text-muted">使用率</span>
              </div>
              <div className="mt-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xl font-bold text-text-primary">{diskStatus.usagePercent.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor(diskStatus.status)}`} style={{ width: `${Math.min(diskStatus.usagePercent, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-secondary">目录统计</h3>
              <span className="text-xs text-text-muted">最后检查: {new Date(diskStatus.lastChecked).toLocaleString()}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-alt border-b border-border">
                    <th className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">目录</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">文件数量</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">总大小</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-surface-alt transition-colors">
                    <td className="px-5 py-4 text-sm text-text-primary font-medium">uploads/</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.uploadsDir?.fileCount ?? '-'}</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.uploadsDir?.totalSizeMB?.toFixed(1) ?? '-'} MB</td>
                  </tr>
                  <tr className="hover:bg-surface-alt transition-colors">
                    <td className="px-5 py-4 text-sm text-text-primary font-medium">original/</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.originalDir?.fileCount ?? '-'}</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.originalDir?.totalSizeMB?.toFixed(1) ?? '-'} MB</td>
                  </tr>
                  <tr className="hover:bg-surface-alt transition-colors">
                    <td className="px-5 py-4 text-sm text-text-primary font-medium">variants/</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.variantsDir?.fileCount ?? '-'}</td>
                    <td className="px-5 py-4 text-sm text-text-secondary">{diskStatus.variantsDir?.totalSizeMB?.toFixed(1) ?? '-'} MB</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {isEditing && config && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Settings size={18} className="text-brand-gold" />
              <h3 className="text-sm font-semibold text-text-secondary">告警阈值配置</h3>
              <span className="px-2 py-0.5 theme-tag text-[10px] font-medium rounded">实时生效</span>
            </div>
            <button onClick={handleCancelEdit} className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-alt rounded transition-all">
              <X size={18} />
            </button>
          </div>

          {validationErrors.length > 0 && (
            <div className="flex items-start gap-3 p-3 rounded theme-status-error mb-4">
              <AlertTriangle size={18} className="theme-text-error shrink-0 mt-0.5" />
              <ul className="text-sm theme-text-error list-disc list-inside">
                {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">警告阈值 (GB)</label>
              <p className="text-xs text-text-muted mb-2">低于此值时输出警告日志</p>
              <input
                type="number" min="1" step="0.1"
                value={editingConfig.warningThresholdGB ?? config.warningThresholdGB}
                onChange={(e) => setEditingConfig({ ...editingConfig, warningThresholdGB: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">严重阈值 (GB)</label>
              <p className="text-xs text-text-muted mb-2">低于此值时拒绝上传</p>
              <input
                type="number" min="1" step="0.1"
                value={editingConfig.criticalThresholdGB ?? config.criticalThresholdGB}
                onChange={(e) => setEditingConfig({ ...editingConfig, criticalThresholdGB: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">检查间隔 (秒)</label>
              <p className="text-xs text-text-muted mb-2">两次自动检查的时间间隔</p>
              <input
                type="number" min="60" step="10"
                value={(editingConfig.checkIntervalMs ?? config.checkIntervalMs) / 1000}
                onChange={(e) => setEditingConfig({ ...editingConfig, checkIntervalMs: parseInt(e.target.value) * 1000 })}
                className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">上传最小空间 (MB)</label>
              <p className="text-xs text-text-muted mb-2">上传前必须保留的最小空闲空间</p>
              <input
                type="number" min="10" step="10"
                value={editingConfig.uploadsMinFreeMB ?? config.uploadsMinFreeMB}
                onChange={(e) => setEditingConfig({ ...editingConfig, uploadsMinFreeMB: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-5 border-t border-border mt-5">
            <button
              onClick={handleResetToDefaults}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 border border-border theme-status-error text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
            >
              <RotateCcw size={14} /> 重置默认
            </button>
            <button
              onClick={handleCancelEdit}
              disabled={saving}
              className="px-4 py-2 rounded border border-border text-sm text-text-secondary hover:bg-surface-alt transition-all disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
            >
              <Save size={14} /> {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      {config && !isEditing && (
        <div className="bg-surface border border-border rounded p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-secondary">当前配置</h3>
            <button onClick={handleStartEdit} className="p-1.5 text-brand-gold hover:bg-surface-alt rounded transition-all" title="编辑配置">
              <Settings size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-text-muted mb-1">警告阈值</p>
              <p className="text-sm font-medium text-text-primary">{config.warningThresholdGB} GB</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">严重阈值</p>
              <p className="text-sm font-medium text-text-primary">{config.criticalThresholdGB} GB</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">检查间隔</p>
              <p className="text-sm font-medium text-text-primary">{config.checkIntervalMs / 1000} 秒</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">上传最小空间</p>
              <p className="text-sm font-medium text-text-primary">{config.uploadsMinFreeMB} MB</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDiskMonitor;
