import React, { useState, useEffect } from 'react'
import { apiGet, apiPost } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { clsx } from 'clsx'
import { Checkbox } from '@/src/components/ui'

interface LinkMapping {
  oldUrl: string
  newUrl: string
  useRegex?: boolean
}

interface ScanResult {
  totalPages: number
  localLinkCount: number
  externalLinkCount: number
  s3LinkCount: number
  unknownLinkCount: number
  details: Array<{
    slug: string
    title: string
    distribution: {
      localLinks: string[]
      externalLinks: string[]
      s3Links: string[]
      unknownLinks: string[]
    }
  }>
}

interface UpdateResult {
  totalPages: number
  successCount: number
  failCount: number
  skipCount: number
  executionTime: number
  results: Array<{
    slug: string
    title: string
    success: boolean
    error?: string
    replaceResult?: {
      replaced: boolean
      replaceCount: number
      replacements: Array<{ oldUrl: string; newUrl: string; type: string }>
    }
  }>
}

export default function AdminMarkdownLinks() {
  const dialog = useDialog()
  const { show } = useToast()
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)

  const [mappings, setMappings] = useState<LinkMapping[]>([
    { oldUrl: '', newUrl: '', useRegex: false },
  ])
  const [previewResult, setPreviewResult] = useState<any[] | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [updating, setUpdating] = useState(false)
  const [dryRun, setDryRun] = useState(true)

  const [fromStorage, setFromStorage] = useState<'local' | 's3' | 'external'>('local')
  const [toStorage, setToStorage] = useState<'local' | 's3' | 'external'>('s3')
  const [storageConfig, setStorageConfig] = useState({
    localBaseUrl: '/uploads/',
    s3BaseUrl: '',
    externalBaseUrl: '',
  })

  const handleScan = async () => {
    setScanning(true)
    try {
      const result = await apiGet<ScanResult>('/api/admin/wiki-links/scan')
      setScanResult(result)
      show('扫描完成', { variant: 'success' })
    } catch {
      show('扫描失败', { variant: 'error' })
    } finally {
      setScanning(false)
    }
  }

  const handlePreview = async () => {
    const valid = mappings.filter((m) => m.oldUrl && m.newUrl)
    if (valid.length === 0) {
      show('请至少填写一个链接映射', { variant: 'error' })
      return
    }
    setPreviewing(true)
    try {
      const result = await apiPost<any[]>('/api/admin/wiki-links/preview', { mappings: valid })
      setPreviewResult(result)
      show('预览完成', { variant: 'success' })
    } catch {
      show('预览失败', { variant: 'error' })
    } finally {
      setPreviewing(false)
    }
  }

  const handleUpdate = async () => {
    const valid = mappings.filter((m) => m.oldUrl && m.newUrl)
    if (valid.length === 0) {
      show('请至少填写一个链接映射', { variant: 'error' })
      return
    }
    if (!dryRun) {
      const confirmed = await dialog.confirm({
        title: '执行实际更新',
        message: '确定要执行实际更新吗？此操作将修改 Wiki 页面内容。',
        confirmText: '更新',
        variant: 'warning',
      })
      if (!confirmed) return
    }
    setUpdating(true)
    try {
      const result = await apiPost<UpdateResult>('/api/admin/wiki-links/update', {
        mappings: valid,
        dryRun,
      })
      setUpdateResult(result)
      show(dryRun ? '预览更新完成' : '更新完成', { variant: 'success' })
    } catch {
      show('更新失败', { variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }

  const handleSwitchStorage = async () => {
    if (fromStorage === toStorage) {
      show('源存储和目标存储不能相同', { variant: 'error' })
      return
    }
    if (!dryRun) {
      const confirmed = await dialog.confirm({
        title: '切换存储策略',
        message: '确定要执行存储策略切换吗？此操作将修改 Wiki 页面内容。',
        confirmText: '切换',
        variant: 'warning',
      })
      if (!confirmed) return
    }
    setUpdating(true)
    try {
      const result = await apiPost<UpdateResult>('/api/admin/wiki-links/switch-storage', {
        fromStorage,
        toStorage,
        config: storageConfig,
        dryRun,
      })
      setUpdateResult(result)
      show(dryRun ? '预览切换完成' : '切换完成', { variant: 'success' })
    } catch {
      show('切换失败', { variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }

  const handleSyncWithImageMap = async () => {
    if (!dryRun) {
      const confirmed = await dialog.confirm({
        title: '同步 ImageMap',
        message: '确定要同步 ImageMap 吗？此操作将修改 Wiki 页面内容。',
        confirmText: '同步',
        variant: 'warning',
      })
      if (!confirmed) return
    }
    setUpdating(true)
    try {
      const result = await apiPost<any>('/api/admin/wiki-links/sync-with-imagemap', { dryRun })
      if (result.result) setUpdateResult(result.result)
      show(result.message || (dryRun ? '预览同步完成' : '同步完成'), { variant: 'success' })
    } catch {
      show('同步失败', { variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }

  const addMapping = () => setMappings([...mappings, { oldUrl: '', newUrl: '', useRegex: false }])
  const removeMapping = (index: number) => setMappings(mappings.filter((_, i) => i !== index))
  const updateMapping = (index: number, field: keyof LinkMapping, value: string | boolean) => {
    const next = [...mappings]
    next[index] = { ...next[index], [field]: value }
    setMappings(next)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-[0.12em]">
          Markdown 链接批量更新
        </h2>
        <p className="text-sm text-text-muted mt-1">
          扫描和批量更新 Wiki 页面中的资源链接，支持存储策略切换。
        </p>
      </div>

      {/* 链接分布扫描 */}
      <div className="bg-surface border border-border rounded p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">链接分布扫描</h3>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold disabled:opacity-50 transition-all"
        >
          {scanning ? '扫描中...' : '开始扫描'}
        </button>
        {scanResult && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-text-primary">{scanResult.totalPages}</div>
              <div className="text-xs text-text-muted">Wiki 页面</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-brand-gold">{scanResult.localLinkCount}</div>
              <div className="text-xs text-text-muted">本地链接</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-brand-gold">{scanResult.s3LinkCount}</div>
              <div className="text-xs text-text-muted">S3 链接</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-brand-gold">
                {scanResult.externalLinkCount}
              </div>
              <div className="text-xs text-text-muted">外部链接</div>
            </div>
          </div>
        )}
      </div>

      {/* 存储策略切换 */}
      <div className="bg-surface border border-border rounded p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">存储策略切换</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">源存储</label>
            <select
              value={fromStorage}
              onChange={(e) => setFromStorage(e.target.value as any)}
              className="w-full px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
            >
              <option value="local">本地存储</option>
              <option value="s3">S3 存储</option>
              <option value="external">外部图床</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">目标存储</label>
            <select
              value={toStorage}
              onChange={(e) => setToStorage(e.target.value as any)}
              className="w-full px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
            >
              <option value="local">本地存储</option>
              <option value="s3">S3 存储</option>
              <option value="external">外部图床</option>
            </select>
          </div>
          <div className="flex items-end">
            <Checkbox
              checked={dryRun}
              onCheckedChange={(checked) => setDryRun(checked === true)}
              label={<span className="text-text-secondary">预览模式（不实际修改）</span>}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              本地基础 URL
            </label>
            <input
              type="text"
              value={storageConfig.localBaseUrl}
              onChange={(e) => setStorageConfig({ ...storageConfig, localBaseUrl: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              placeholder="/uploads/"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              S3 基础 URL
            </label>
            <input
              type="text"
              value={storageConfig.s3BaseUrl}
              onChange={(e) => setStorageConfig({ ...storageConfig, s3BaseUrl: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              placeholder="https://s3.example.com/"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              外部图床基础 URL
            </label>
            <input
              type="text"
              value={storageConfig.externalBaseUrl}
              onChange={(e) =>
                setStorageConfig({ ...storageConfig, externalBaseUrl: e.target.value })
              }
              className="w-full px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              placeholder="https://external.com/"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSwitchStorage}
            disabled={updating || fromStorage === toStorage}
            className="px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold disabled:opacity-50 transition-all"
          >
            {updating ? '处理中...' : dryRun ? '预览切换' : '执行切换'}
          </button>
          <button
            onClick={handleSyncWithImageMap}
            disabled={updating}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm font-medium disabled:opacity-50 transition-all"
          >
            同步 ImageMap
          </button>
        </div>
      </div>

      {/* 自定义链接映射 */}
      <div className="bg-surface border border-border rounded p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">自定义链接映射</h3>
        {mappings.map((mapping, index) => (
          <div key={index} className="flex gap-2 mb-2 items-start">
            <input
              type="text"
              value={mapping.oldUrl}
              onChange={(e) => updateMapping(index, 'oldUrl', e.target.value)}
              className="flex-1 px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              placeholder="原始链接"
            />
            <input
              type="text"
              value={mapping.newUrl}
              onChange={(e) => updateMapping(index, 'newUrl', e.target.value)}
              className="flex-1 px-3 py-2 border border-border rounded text-sm focus:outline-none focus:border-brand-gold"
              placeholder="新链接"
            />
            <div className="px-3 py-2">
              <Checkbox
                checked={mapping.useRegex}
                onCheckedChange={(checked) => updateMapping(index, 'useRegex', checked === true)}
                label={<span className="text-text-secondary">正则</span>}
              />
            </div>
            <button
              onClick={() => removeMapping(index)}
              className="px-3 py-2 theme-icon-button-danger hover:bg-surface-alt rounded transition-all"
              disabled={mappings.length === 1}
            >
              删除
            </button>
          </div>
        ))}
        <button
          onClick={addMapping}
          className="mt-2 px-4 py-2 text-sm text-brand-gold border border-brand-gold/30 rounded hover:bg-brand-gold/10 transition-all"
        >
          + 添加映射
        </button>
        <div className="flex gap-2 mt-4">
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm font-medium disabled:opacity-50 transition-all"
          >
            {previewing ? '预览中...' : '预览效果'}
          </button>
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="px-4 py-2 bg-brand-gold-dark text-white rounded text-sm font-medium hover:bg-brand-gold disabled:opacity-50 transition-all"
          >
            {updating ? '更新中...' : dryRun ? '预览更新' : '执行更新'}
          </button>
        </div>
      </div>

      {/* 预览结果 */}
      {previewResult && previewResult.length > 0 && (
        <div className="bg-surface border border-border rounded p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4">预览结果</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {previewResult.map((item) => (
              <div key={item.slug} className="p-3 bg-surface-alt rounded">
                <div className="font-medium text-sm text-text-primary">{item.title}</div>
                <div className="text-xs text-text-muted">{item.slug}</div>
                {item.preview.replaced ? (
                  <div className="mt-2 text-sm">
                    <span className="theme-text-success text-xs">
                      将替换 {item.preview.replaceCount} 处
                    </span>
                    <ul className="mt-1 space-y-1">
                      {item.preview.replacements.map((r: any, i: number) => (
                        <li key={i} className="text-xs text-text-secondary">
                          {r.type}: {r.oldUrl} → {r.newUrl}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-text-muted">无变化</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 更新结果 */}
      {updateResult && (
        <div className="bg-surface border border-border rounded p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4">
            {dryRun ? '预览更新结果' : '更新结果'}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-text-primary">{updateResult.totalPages}</div>
              <div className="text-xs text-text-muted">处理页面</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold theme-text-success">
                {updateResult.successCount}
              </div>
              <div className="text-xs text-text-muted">成功</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold text-brand-gold">{updateResult.skipCount}</div>
              <div className="text-xs text-text-muted">跳过</div>
            </div>
            <div className="bg-surface border border-border rounded p-4">
              <div className="text-2xl font-bold theme-text-error">{updateResult.failCount}</div>
              <div className="text-xs text-text-muted">失败</div>
            </div>
          </div>
          <div className="text-sm text-text-muted">执行时间: {updateResult.executionTime}ms</div>
          {updateResult.results.some((r) => !r.success) && (
            <div className="mt-4">
              <h4 className="font-medium theme-text-error text-sm mb-2">失败详情</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {updateResult.results
                  .filter((r) => !r.success)
                  .map((r) => (
                    <div key={r.slug} className="text-sm theme-text-error">
                      {r.title} ({r.slug}): {r.error}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
