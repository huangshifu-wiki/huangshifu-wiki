/**
 * 管理后台 - 变体管理界面
 * 
 * 功能：
 * 1. 变体生成统计信息
 * 2. 批量变体重建
 * 3. 孤儿文件清理
 * 4. 失败变体清理
 * 5. 清理统计报告
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '../../lib/apiClient';

interface VariantStats {
  queueLength: number;
  processingCount: number;
  completedToday: number;
  failedToday: number;
  averageProcessingTime: number;
  timeoutCount: number;
}

interface CleanupStats {
  totalImages: number;
  completedVariants: number;
  failedVariants: number;
  pendingOrProcessing: number;
  estimatedOrphanedDirectories: number;
}

interface RebuildResponse {
  success: boolean;
  error?: string;
  jobId?: string;
  status?: string;
  summary?: {
    totalScanned: number;
    queuedForRebuild: number;
    skipped: number;
    errors: number;
  };
  estimatedTimeSeconds?: number;
}

export const AdminVariantManager: React.FC = () => {
  const [variantStats, setVariantStats] = useState<VariantStats | null>(null);
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 批量重建状态
  const [rebuildScope, setRebuildScope] = useState<string>('missing');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<RebuildResponse | null>(null);

  // 清理操作状态
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    type: string;
    freedSpace: number;
    deletedCount: number;
    errorsCount: number;
  } | null>(null);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsData, cleanupData] = await Promise.all([
        apiGet<{ success: boolean; data: VariantStats }>('/api/admin/variants/stats'),
        apiGet<{ success: boolean; data: CleanupStats }>('/api/admin/variants/cleanup/stats'),
      ]);

      if (statsData.success) {
        setVariantStats(statsData.data);
      }

      if (cleanupData.success) {
        setCleanupStats(cleanupData.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // 批量变体重建 ⭐ 核心功能
  const handleRebuildVariants = async (scope: string) => {
    if (!confirm(`确定要执行"${scope}"范围的批量重建吗？\n\n这将重新生成所有符合条件的图片变体。`)) return;

    try {
      setRebuilding(true);
      setRebuildResult(null);

      const result = await apiPost<RebuildResponse>('/api/admin/images/rebuild-all-variants', {
        scope,
        batchSize: 100,
        dryRun: false,
      });

      if (result.success) {
        setRebuildResult(result);
        
        setTimeout(() => {
          fetchStats();
        }, 2000);
      } else {
        throw new Error(result.error || '重建失败');
      }
    } catch (err) {
      console.error('Rebuild error:', err);
      setError(err instanceof Error ? err.message : '重建失败');
    } finally {
      setRebuilding(false);
    }
  };

  // 清理孤儿文件
  const handleCleanupOrphaned = async () => {
    if (!confirm('确定要清理所有孤儿变体文件吗？\n\n这将删除数据库中无对应记录的变体文件。')) return;

    try {
      setCleaning(true);
      setCleanupResult(null);

      const data = await apiPost<{ success: boolean; data: { freedSpace: number; deletedCount: number; errorsCount: number } }>('/api/admin/variants/cleanup/orphaned');

      if (data.success) {
        setCleanupResult({
          type: 'orphaned',
          freedSpace: data.data.freedSpace,
          deletedCount: data.data.deletedCount,
          errorsCount: data.data.errorsCount,
        });

        setTimeout(() => fetchStats(), 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  // 清理失败残留
  const handleCleanupFailed = async () => {
    if (!confirm('确定要清理所有失败的变体文件吗？')) return;

    try {
      setCleaning(true);
      setCleanupResult(null);

      const data = await apiPost<{ success: boolean; data: { freedSpace: number; deletedCount: number; errorsCount: number } }>('/api/admin/variants/cleanup/failed');

      if (data.success) {
        setCleanupResult({
          type: 'failed',
          freedSpace: data.data.freedSpace,
          deletedCount: data.data.deletedCount,
          errorsCount: data.data.errorsCount,
        });

        setTimeout(() => fetchStats(), 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  // 全量清理
  const handleCleanupAll = async () => {
    if (!confirm('⚠️ 确定要执行全量清理吗？\n\n这将同时清理孤儿文件和失败残留。')) return;

    try {
      setCleaning(true);
      setCleanupResult(null);

      const data = await apiPost<{ success: boolean; data: { totalFreedBytes: number; totalDeletedFiles: number; totalErrors: number } }>('/api/admin/variants/cleanup/all');

      if (data.success) {
        setCleanupResult({
          type: 'all',
          freedSpace: data.data.totalFreedBytes,
          deletedCount: data.data.totalDeletedFiles,
          errorsCount: data.data.totalErrors,
        });

        setTimeout(() => fetchStats(), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '全量清理失败');
    } finally {
      setCleaning(false);
    }
  };

  // 格式化字节数
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading && !variantStats && !cleanupStats) {
    return (
      <div className="admin-variant-manager loading">
        <div className="spinner-container">
          <div className="spinner" />
          <p>正在加载变体管理数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-variant-manager">
      {/* 页面标题 */}
      <div className="page-header">
        <h1>🖼️ 变体管理中心</h1>
        <p className="subtitle">管理 WebP 变体的生成、清理与重建</p>
      </div>

      {/* 操作栏 */}
      <div className="action-bar">
        <button 
          onClick={fetchStats} 
          disabled={loading}
          className="btn-secondary"
        >
          🔄 刷新统计
        </button>
      </div>

      {error && (
        <div className="alert-error">
          ⚠️ {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* 统计概览 */}
      <div className="cards-grid">
        {/* 变体生成器状态 */}
        <div className="card">
          <div className="card-header">
            <h2>⚙️ 生成队列</h2>
            <span className={`status-badge ${loading ? 'warning' : 'healthy'}`}>
              {loading ? '加载中...' : '运行中'}
            </span>
          </div>

          {variantStats && (
            <div className="stats-grid">
              <div className="stat-item">
                <label>等待处理</label>
                <span className="stat-value">{variantStats.queueLength}</span>
              </div>
              
              <div className="stat-item highlight">
                <label>正在处理</label>
                <span className="stat-value">{variantStats.processingCount}</span>
              </div>
              
              <div className="stat-item success">
                <label>今日完成</label>
                <span className="stat-value">{variantStats.completedToday}</span>
              </div>
              
              <div className="stat-item danger">
                <label>今日失败</label>
                <span className="stat-value">{variantStats.failedToday}</span>
              </div>
              
              <div className="stat-item warning">
                <label>超时次数</label>
                <span className="stat-value">{variantStats.timeoutCount}</span>
              </div>
              
              <div className="stat-item info">
                <label>平均耗时</label>
                <span className="stat-value">{variantStats.averageProcessingTime}ms</span>
              </div>
            </div>
          )}
        </div>

        {/* 变体统计 */}
        <div className="card">
          <div className="card-header">
            <h2>📊 变体统计</h2>
          </div>

          {cleanupStats && (
            <div className="stats-grid">
              <div className="stat-item">
                <label>总图片数</label>
                <span className="stat-value">{cleanupStats.totalImages}</span>
              </div>
              
              <div className="stat-item success">
                <label>已完成</label>
                <span className="stat-value">{cleanupStats.completedVariants}</span>
              </div>
              
              <div className="stat-item danger">
                <label>失败数</label>
                <span className="stat-value">{cleanupStats.failedVariants}</span>
              </div>
              
              <div className="stat-item warning">
                <label>待处理</label>
                <span className="stat-value">{cleanupStats.pendingOrProcessing}</span>
              </div>
              
              <div className="stat-item info">
                <label>预估孤儿目录</label>
                <span className="stat-value">{cleanupStats.estimatedOrphanedDirectories}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 批量重建区域 */}
      <div className="card rebuild-card">
        <div className="card-header">
          <h2>🔄 批量变体重建</h2>
          <p className="description">为历史图片补全或重新生成 WebP 变体</p>
        </div>

        <div className="rebuild-options">
          <div className="option-group">
            <label>选择重建范围：</label>
            
            <div className="radio-options">
              <label className="radio-option">
                <input
                  type="radio"
                  name="scope"
                  value="missing"
                  checked={rebuildScope === 'missing'}
                  onChange={(e) => setRebuildScope(e.target.value)}
                />
                <span className="option-label">
                  <strong>补全缺失</strong>
                  <small>仅处理没有变体的图片</small>
                </span>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name="scope"
                  value="failed"
                  checked={rebuildScope === 'failed'}
                  onChange={(e) => setRebuildScope(e.target.value)}
                />
                <span className="option-label">
                  <strong>重建失败</strong>
                  <small>仅处理生成失败的图片</small>
                </span>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={rebuildScope === 'all'}
                  onChange={(e) => setRebuildScope(e.target.value)}
                />
                <span className="option-label">
                  <strong>全部重建</strong>
                  <small>强制重新生成所有图片的变体（⚠️ 慎用）</small>
                </span>
              </label>
            </div>
          </div>

          <div className="action-area">
            <button
              onClick={() => handleRebuildVariants(rebuildScope)}
              disabled={rebuilding}
              className="btn-primary btn-large"
            >
              {rebuilding ? `⏳ 正在处理...` : `🚀 开始重建 (${rebuildScope})`}
            </button>
          </div>
        </div>

        {rebuildResult && (
          <div className="result-panel success">
            <h3>✅ 重建任务已提交</h3>
            <div className="result-details">
              <div className="detail-row">
                <span>任务 ID:</span>
                <code>{rebuildResult.jobId}</code>
              </div>
              <div className="detail-row">
                <span>扫描总数:</span>
                <strong>{rebuildResult.summary?.totalScanned ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>入队数量:</span>
                <strong>{rebuildResult.summary?.queuedForRebuild ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>跳过数量:</span>
                <strong>{rebuildResult.summary?.skipped ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>错误数量:</span>
                <strong className={rebuildResult.summary?.errors ? 'text-danger' : ''}>
                  {rebuildResult.summary?.errors ?? 0}
                </strong>
              </div>
              {rebuildResult.estimatedTimeSeconds && (
                <div className="detail-row">
                  <span>预计耗时:</span>
                  <strong>~{Math.ceil(rebuildResult.estimatedTimeSeconds / 60)} 分钟</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 清理操作区域 */}
      <div className="card cleanup-card">
        <div className="card-header">
          <h2>🧹 变体清理</h2>
          <p className="description">清理无效或多余的变体文件以释放磁盘空间</p>
        </div>

        <div className="cleanup-actions">
          <button
            onClick={handleCleanupOrphaned}
            disabled={cleaning}
            className="btn-warning btn-medium"
          >
            🗑️ 清理孤儿文件
          </button>

          <button
            onClick={handleCleanupFailed}
            disabled={cleaning}
            className="btn-danger btn-medium"
          >
            ❌ 清理失败残留
          </button>

          <button
            onClick={handleCleanupAll}
            disabled={cleaning}
            className="btn-primary btn-medium"
          >
            🔥 全量清理
          </button>
        </div>

        {cleaning && (
          <div className="processing-indicator">
            <div className="spinner-small" />
            <span>正在清理，请稍候...</span>
          </div>
        )}

        {cleanupResult && (
          <div className="result-panel info">
            <h3>✨ 清理完成 ({cleanupResult.type})</h3>
            <div className="result-details">
              <div className="detail-row">
                <span>释放空间:</span>
                <strong className="text-success">{formatBytes(cleanupResult.freedSpace)}</strong>
              </div>
              <div className="detail-row">
                <span>删除文件:</span>
                <strong>{cleanupResult.deletedCount}</strong>
              </div>
              <div className="detail-row">
                <span>错误数量:</span>
                <strong className={cleanupResult.errorsCount > 0 ? 'text-danger' : ''}>
                  {cleanupResult.errorsCount}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminVariantManager;
