/**
 * 管理后台 - 磁盘监控管理界面
 * 
 * 功能：
 * 1. 实时显示磁盘状态（使用量、剩余空间）
 * 2. ⭐ 动态修改告警阈值（核心需求）
 * 3. 目录统计信息展示
 * 4. 手动触发检查
 * 5. 监控控制（暂停/恢复）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPut, apiPost } from '../../lib/apiClient';

interface DiskStatus {
  totalSpaceGB: number;
  freeSpaceGB: number;
  usedSpaceGB: number;
  usagePercent: number;
  status: 'healthy' | 'warning' | 'critical';
  lastChecked: string;
  uploadsDir?: {
    fileCount: number;
    totalSizeMB: number;
  };
  originalDir?: {
    fileCount: number;
    totalSizeMB: number;
  };
  variantsDir?: {
    fileCount: number;
    totalSizeMB: number;
  };
}

interface DiskMonitorConfig {
  warningThresholdGB: number;
  criticalThresholdGB: number;
  checkIntervalMs: number;
  uploadsMinFreeMB: number;
}

interface UploadPrecheckResult {
  allowed: boolean;
  reason?: string;
  freeSpaceGB: number;
  config: DiskMonitorConfig;
}

export const AdminDiskMonitor: React.FC = () => {
  const [diskStatus, setDiskStatus] = useState<DiskStatus | null>(null);
  const [config, setConfig] = useState<DiskMonitorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 编辑表单状态
  const [editingConfig, setEditingConfig] = useState<Partial<DiskMonitorConfig>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // 获取磁盘状态和配置
  const fetchDiskStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await apiGet<{ success: boolean; data: DiskStatus & { config?: DiskMonitorConfig }; error?: string }>('/api/admin/disk/status');
      
      if (data.success) {
        setDiskStatus(data.data);
        setConfig(data.data.config || null);
      } else {
        throw new Error(data.error || '获取磁盘状态失败');
      }
    } catch (err) {
      console.error('Failed to fetch disk status:', err);
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    fetchDiskStatus();
    
    // 自动刷新间隔（30秒）
    const interval = setInterval(fetchDiskStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchDiskStatus]);

  // 手动刷新
  const handleManualCheck = async () => {
    await fetchDiskStatus();
  };

  // 开始编辑配置
  const handleStartEdit = () => {
    if (config) {
      setEditingConfig({ ...config });
      setIsEditing(true);
      setValidationErrors([]);
      setSaveSuccess(false);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingConfig({});
    setValidationErrors([]);
  };

  // 验证配置
  const validateConfig = (newConfig: Partial<DiskMonitorConfig>): string[] => {
    const errors: string[] = [];

    if ('warningThresholdGB' in newConfig) {
      if (typeof newConfig.warningThresholdGB !== 'number' || newConfig.warningThresholdGB <= 0) {
        errors.push('警告阈值必须是正数');
      }
    }

    if ('criticalThresholdGB' in newConfig) {
      if (typeof newConfig.criticalThresholdGB !== 'number' || newConfig.criticalThresholdGB <= 0) {
        errors.push('严重阈值必须是正数');
      }

      if (
        newConfig.warningThresholdGB &&
        newConfig.criticalThresholdGB &&
        newConfig.criticalThresholdGB >= newConfig.warningThresholdGB
      ) {
        errors.push('严重阈值必须小于警告阈值');
      }
    }

    if ('checkIntervalMs' in newConfig) {
      if (typeof newConfig.checkIntervalMs !== 'number' || newConfig.checkIntervalMs < 60000) {
        errors.push('检查间隔必须 >= 60000 毫秒 (1分钟)');
      }
    }

    if ('uploadsMinFreeMB' in newConfig) {
      if (typeof newConfig.uploadsMinFreeMB !== 'number' || newConfig.uploadsMinFreeMB < 10) {
        errors.push('最小空闲空间必须 >= 10 MB');
      }
    }

    return errors;
  };

  // 保存配置 ⭐ 核心功能
  const handleSaveConfig = async () => {
    const errors = validateConfig(editingConfig);

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

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
      console.error('Failed to save config:', err);
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 重置为默认值
  const handleResetToDefaults = async () => {
    if (!confirm('确定要重置为默认配置吗？')) return;

    try {
      setSaving(true);
      const result = await apiPost<{ success: boolean; data: DiskMonitorConfig }>('/api/admin/disk/config/reset');

      if (result.success) {
        setConfig(result.data);
        setEditingConfig({});
        alert('已重置为默认配置！');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setSaving(false);
    }
  };

  // 渲染状态指示器
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <span className="status-badge healthy">🟢 健康</span>;
      case 'warning':
        return <span className="status-badge warning">🟡 警告</span>;
      case 'critical':
        return <span className="status-badge critical">🔴 严重</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  // 渲染进度条
  const renderUsageBar = (percent: number, status: string) => {
    let colorClass = 'usage-bar-healthy';
    if (status === 'warning') colorClass = 'usage-bar-warning';
    if (status === 'critical') colorClass = 'usage-bar-critical';

    return (
      <div className={`usage-bar-container ${colorClass}`}>
        <div 
          className="usage-bar-fill" 
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
        <span className="usage-text">{percent.toFixed(1)}%</span>
      </div>
    );
  };

  if (loading && !diskStatus) {
    return (
      <div className="admin-disk-monitor loading">
        <div className="spinner-container">
          <div className="spinner" />
          <p>正在加载磁盘监控数据...</p>
        </div>
      </div>
    );
  }

  if (error && !diskStatus) {
    return (
      <div className="admin-disk-monitor error">
        <div className="error-message">
          <h3>❌ 加载失败</h3>
          <p>{error}</p>
          <button onClick={fetchDiskStatus} className="btn-primary">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-disk-monitor">
      {/* 页面标题 */}
      <div className="page-header">
        <h1>📊 磁盘监控管理</h1>
        <p className="subtitle">实时监控系统磁盘空间，支持动态调整告警阈值</p>
      </div>

      {/* 操作栏 */}
      <div className="action-bar">
        <button 
          onClick={handleManualCheck} 
          disabled={loading}
          className="btn-secondary"
        >
          🔄 刷新状态
        </button>
        <button 
          onClick={handleStartEdit} 
          disabled={!config}
          className="btn-primary"
        >
          ⚙️ 修改阈值
        </button>
      </div>

      {error && (
        <div className="alert-error">
          ⚠️ {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {saveSuccess && (
        <div className="alert-success">
          ✅ 配置保存成功！新阈值已立即生效。
        </div>
      )}

      {/* 磁盘状态卡片 */}
      {diskStatus && (
        <div className="card disk-status-card">
          <div className="card-header">
            <h2>💾 磁盘空间概览</h2>
            {renderStatusBadge(diskStatus.status)}
            <span className="last-checked">
              最后检查: {new Date(diskStatus.lastChecked).toLocaleString()}
            </span>
          </div>

          <div className="disk-stats-grid">
            <div className="stat-item">
              <label>总容量</label>
              <span className="stat-value">{diskStatus.totalSpaceGB.toFixed(1)} GB</span>
            </div>
            
            <div className="stat-item highlight">
              <label>剩余空间</label>
              <span className={`stat-value ${diskStatus.status === 'critical' ? 'text-danger' : ''}`}>
                {diskStatus.freeSpaceGB.toFixed(1)} GB
              </span>
            </div>
            
            <div className="stat-item">
              <label>已使用</label>
              <span className="stat-value">{diskStatus.usedSpaceGB.toFixed(1)} GB</span>
            </div>
            
            <div className="stat-item">
              <label>使用率</label>
              <span className="stat-value">{renderUsageBar(diskStatus.usagePercent, diskStatus.status)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 编辑配置面板 ⭐ */}
      {isEditing && config && (
        <div className="card config-editor-card">
          <div className="card-header">
            <h2>⚙️ 告警阈值配置</h2>
            <span className="badge">实时生效</span>
          </div>

          <div className="config-form">
            <div className="form-group">
              <label htmlFor="warningThreshold">
                🟡 警告阈值 (GB)
                <small>低于此值时输出警告日志</small>
              </label>
              <input
                id="warningThreshold"
                type="number"
                min="1"
                step="0.1"
                value={editingConfig.warningThresholdGB ?? config.warningThresholdGB}
                onChange={(e) => setEditingConfig({
                  ...editingConfig,
                  warningThresholdGB: parseFloat(e.target.value)
                })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="criticalThreshold">
                🔴 严重阈值 (GB)
                <small>低于此值时拒绝上传</small>
              </label>
              <input
                id="criticalThreshold"
                type="number"
                min="1"
                step="0.1"
                value={editingConfig.criticalThresholdGB ?? config.criticalThresholdGB}
                onChange={(e) => setEditingConfig({
                  ...editingConfig,
                  criticalThresholdGB: parseFloat(e.target.value)
                })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="checkInterval">
                ⏱️ 检查间隔 (秒)
                <small>两次自动检查的时间间隔</small>
              </label>
              <input
                id="checkInterval"
                type="number"
                min="60"
                step="10"
                value={((editingConfig.checkIntervalMs ?? config.checkIntervalMs) / 1000)}
                onChange={(e) => setEditingConfig({
                  ...editingConfig,
                  checkIntervalMs: parseInt(e.target.value) * 1000
                })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="minFreeSpace">
                💾 上传最小空间 (MB)
                <small>上传前必须保留的最小空闲空间</small>
              </label>
              <input
                id="minFreeSpace"
                type="number"
                min="10"
                step="10"
                value={editingConfig.uploadsMinFreeMB ?? config.uploadsMinFreeMB}
                onChange={(e) => setEditingConfig({
                  ...editingConfig,
                  uploadsMinFreeMB: parseInt(e.target.value)
                })}
                className="form-input"
              />
            </div>

            {validationErrors.length > 0 && (
              <div className="validation-errors">
                <h4>⚠️ 验证错误：</h4>
                <ul>
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions">
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="btn-primary btn-large"
              >
                {saving ? '💾 保存中...' : '✅ 保存配置'}
              </button>
              
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="btn-secondary"
              >
                ❌ 取消
              </button>

              <button
                onClick={handleResetToDefaults}
                disabled={saving}
                className="btn-danger btn-outline"
              >
                🔃 重置为默认值
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 目录统计 */}
      {diskStatus && (
        <div className="card directory-stats-card">
          <div className="card-header">
            <h2>📁 目录统计</h2>
          </div>

          <div className="directory-table">
            <table>
              <thead>
                <tr>
                  <th>目录</th>
                  <th>文件数量</th>
                  <th>总大小</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>📦 uploads/</strong></td>
                  <td>{diskStatus.uploadsDir?.fileCount ?? 'N/A'}</td>
                  <td>{diskStatus.uploadsDir?.totalSizeMB?.toFixed(1) ?? 'N/A'} MB</td>
                </tr>
                <tr>
                  <td><strong>🖼️ original/</strong></td>
                  <td>{diskStatus.originalDir?.fileCount ?? 'N/A'}</td>
                  <td>{diskStatus.originalDir?.totalSizeMB?.toFixed(1) ?? 'N/A'} MB</td>
                </tr>
                <tr>
                  <td><strong>🎨 variants/</strong></td>
                  <td>{diskStatus.variantsDir?.fileCount ?? 'N/A'}</td>
                  <td>{diskStatus.variantsDir?.totalSizeMB?.toFixed(1) ?? 'N/A'} MB</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDiskMonitor;

/* ===== CSS Styles ===== */
/*
.admin-disk-monitor {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.page-header h1 {
  font-size: 28px;
  margin-bottom: 8px;
  color: #1a1a1a;
}

.subtitle {
  color: #666;
  font-size: 14px;
  margin-bottom: 24px;
}

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.btn-primary, .btn-secondary, .btn-danger {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover:not(:disabled) {
  background: #e5e7eb;
}

.btn-danger {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.btn-danger:hover:not(:disabled) {
  background: #fee2e2;
}

.btn-outline {
  background: transparent;
}

.btn-large {
  padding: 14px 28px;
  font-size: 16px;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 24px;
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.card-header h2 {
  font-size: 18px;
  margin: 0;
  color: #1a1a1a;
}

.badge {
  background: #dbeafe;
  color: #1d4ed8;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.last-checked {
  color: #9ca3af;
  font-size: 13px;
}

.disk-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.stat-item {
  background: #f9fafb;
  padding: 16px;
  border-radius: 8px;
}

.stat-item label {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-item value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}

.stat-item .text-danger {
  color: #dc2626;
}

.usage-bar-container {
  position: relative;
  height: 24px;
  background: #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.usage-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 12px;
  transition: width 0.3s ease;
}

.usage-bar-healthy .usage-bar-fill {
  background: linear-gradient(90deg, #10b981, #34d399);
}

.usage-bar-warning .usage-bar-fill {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.usage-bar-critical .usage-bar-fill {
  background: linear-gradient(90deg, #ef4444, #f87171);
  animation: pulse-danger 1s infinite;
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.usage-text {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 700;
  color: #374151;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.status-badge.healthy {
  background: #dcfce7;
  color: #166534;
}

.status-badge.warning {
  background: #fef9c3;
  color: #92400e;
}

.status-badge.critical {
  background: #fee2e2;
  color: #dc2626;
}

.config-form {
  max-width: 500px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: #374151;
  font-size: 14px;
}

.form-group label small {
  display: block;
  font-weight: 400;
  color: #6b7280;
  font-size: 12px;
  margin-top: 4px;
}

.form-input {
  width: 100%;
  padding: 10px 14px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 15px;
  transition: border-color 0.15s;
  outline: none;
}

.form-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.validation-errors {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.validation-errors h4 {
  color: #dc2626;
  margin: 0 0 8px 0;
  font-size: 14px;
}

.validation-errors ul {
  margin: 0;
  padding-left: 20px;
  color: #991b1b;
}

.validation-errors li {
  margin-bottom: 4px;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}

.directory-table {
  overflow-x: auto;
}

.directory-table table {
  width: 100%;
  border-collapse: collapse;
}

.directory-table th,
.directory-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

.directory-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.directory-table td {
  font-size: 14px;
  color: #4b5563;
}

.alert-success {
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  color: #166534;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.alert-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spinner-container {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
*/
