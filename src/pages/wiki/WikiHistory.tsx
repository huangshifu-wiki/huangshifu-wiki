import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, History, X } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost } from '../../lib/apiClient'
import { formatDate } from '../../lib/dateUtils'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import WikiMarkdown from './WikiMarkdown'

const WikiHistory = () => {
  const { isBanned } = useAuth()
  const { slug } = useParams()
  const [revisions, setRevisions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRevision, setSelectedRevision] = useState<any>(null)
  const previewPresence = useFloatingPresence(Boolean(selectedRevision))
  const lastSelectedRevisionRef = useRef<any>(null)
  const [loadingRevision, setLoadingRevision] = useState(false)
  const navigate = useNavigate()
  const dialog = useDialog()
  const { show } = useToast()

  if (selectedRevision) {
    lastSelectedRevisionRef.current = selectedRevision
  }

  const previewRevision = selectedRevision ?? lastSelectedRevisionRef.current

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const data = await apiGet<{ revisions: any[] }>(`/api/wiki/${slug}/history`)
        setRevisions(data.revisions || [])
      } catch (e) {
        console.error('Error fetching history:', e)
      }
      setLoading(false)
    }
    fetchHistory()
  }, [slug])

  const handlePreviewRevision = async (rev: any) => {
    setLoadingRevision(true)
    try {
      const data = await apiGet<{ revision: any }>(`/api/wiki/${slug}/revisions/${rev.id}`)
      setSelectedRevision(data.revision)
    } catch (e) {
      console.error('Error fetching revision:', e)
      show('加载修订版本失败', { variant: 'error' })
    }
    setLoadingRevision(false)
  }

  const handleRollback = async (revision: any) => {
    const confirmed = await dialog.confirm({
      title: '回滚版本',
      message: `确定要回滚到 ${formatDate(revision.createdAt, 'yyyy-MM-dd HH:mm')} 的版本吗？`,
      confirmText: '回滚',
      variant: 'warning',
    })
    if (!confirmed) return
    if (isBanned) {
      show('账号已被封禁，无法回滚', { variant: 'error' })
      return
    }

    try {
      await apiPost(`/api/wiki/${slug}/rollback/${revision.id}`)
      navigate(`/wiki/${slug}`)
    } catch (e) {
      console.error('Rollback error:', e)
      show('回滚失败', { variant: 'error' })
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
      <Link
        to={`/wiki/${slug}`}
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
      >
        <ArrowLeft size={18} /> 返回页面
      </Link>

      <div className="bg-surface rounded border border-border p-8 sm:p-10">
        <h2 className="text-3xl font-serif font-bold text-brand-gold mb-8 flex items-center gap-3">
          <History size={28} /> 历史版本: {slug}
        </h2>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-surface-alt rounded animate-pulse"></div>
            ))}
          </div>
        ) : revisions.length > 0 ? (
          <div className="space-y-4">
            {revisions.map((rev, i) => (
              <div
                key={rev.id}
                className="p-6 bg-surface-alt/50 border border-border rounded flex items-center justify-between group hover:bg-surface-alt transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-brand-gold/10 flex items-center justify-center text-brand-gold font-bold">
                    {revisions.length - i}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-text-primary">
                      {formatDate(rev.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                    </p>
                    <p className="text-xs text-text-muted">
                      编辑者: {rev.editorName} ({rev.editorUid.substring(0, 6)})
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePreviewRevision(rev)}
                    disabled={loadingRevision}
                    className="px-4 py-2 bg-surface text-brand-gold text-xs font-bold rounded border border-brand-gold/20 hover:bg-brand-gold hover:text-white transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {loadingRevision ? '加载中...' : '预览内容'}
                  </button>
                  <button
                    onClick={() => handleRollback(rev)}
                    className="px-4 py-2 bg-surface text-brand-gold text-xs font-bold rounded border border-brand-gold/20 hover:bg-brand-gold hover:text-white transition-all opacity-0 group-hover:opacity-100"
                  >
                    回滚到此版本
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-text-muted italic py-12">暂无历史记录</p>
        )}
      </div>

      {previewPresence.mounted && previewRevision && (
        <div
          className="floating-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          data-state={previewPresence.state}
          aria-hidden={!selectedRevision}
        >
          <div className="floating-panel bg-surface rounded w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col border border-border">
            <div className="p-8 border-b border-border flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-serif font-bold text-brand-gold">版本预览</h3>
                <p className="text-xs text-text-muted mt-1">
                  {formatDate(previewRevision.createdAt, 'yyyy-MM-dd HH:mm:ss')} · 编辑者:{' '}
                  {previewRevision.editorName}
                </p>
              </div>
              <button
                onClick={() => setSelectedRevision(null)}
                className="p-2 text-text-muted theme-icon-button-danger"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-8 sm:p-12 overflow-y-auto flex-grow prose max-w-none">
              <h1 className="text-4xl font-serif font-bold text-brand-gold mb-8">
                {previewRevision.title}
              </h1>
              <WikiMarkdown content={previewRevision.content} />
            </div>
            <div className="p-8 border-t border-border flex justify-end gap-4">
              <button
                onClick={() => setSelectedRevision(null)}
                className="px-8 py-3 text-text-muted font-bold hover:text-brand-gold"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  handleRollback(previewRevision)
                  setSelectedRevision(null)
                }}
                className="px-8 py-3 theme-button-primary rounded font-bold transition-all"
              >
                回滚到此版本
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WikiHistory
