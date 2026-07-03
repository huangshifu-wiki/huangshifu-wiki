import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Cpu, Database, Image, ShieldCheck, Link as LinkIcon } from '@/src/components/icons'
import { apiPost } from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import AdminEmbeddings from './AdminEmbeddings'
import AdminBackups from './AdminBackups'
import AdminImages from './AdminImages'
import AdminMarkdownLinks from './AdminMarkdownLinks'

type ToolType = 'embeddings' | 'backups' | 'images' | 'sensitive_check' | 'markdown_links'

const toolConfig: Record<ToolType, { title: string; icon: React.ElementType }> = {
  embeddings: { title: '向量管理', icon: Cpu },
  backups: { title: '数据库备份', icon: Database },
  images: { title: '图片管理', icon: Image },
  sensitive_check: { title: '敏感词检测', icon: ShieldCheck },
  markdown_links: { title: '链接更新', icon: LinkIcon },
}

export const AdminToolPage = ({ type: propType }: { type?: ToolType }) => {
  const { type: paramType } = useParams<{ type: ToolType }>()
  const toolType = propType || (paramType as ToolType) || 'embeddings'
  const cfg = toolConfig[toolType]
  const Icon = cfg.icon
  const { show } = useToast()

  const [sensitiveText, setSensitiveText] = useState('')
  const [sensitiveResult, setSensitiveResult] = useState<string[]>([])
  const [sensitiveLoading, setSensitiveLoading] = useState(false)

  const handleSensitiveCheck = async () => {
    if (!sensitiveText.trim()) return
    setSensitiveLoading(true)
    try {
      const data = await apiPost<{ sensitiveWords: string[] }>('/api/admin/check-sensitive', {
        text: sensitiveText,
      })
      setSensitiveResult(data.sensitiveWords || [])
    } catch {
      show('检测失败', { variant: 'error' })
    } finally {
      setSensitiveLoading(false)
    }
  }

  const renderContent = () => {
    switch (toolType) {
      case 'embeddings':
        return <AdminEmbeddings />
      case 'backups':
        return <AdminBackups />
      case 'images':
        return <AdminImages />
      case 'markdown_links':
        return <AdminMarkdownLinks />
      case 'sensitive_check':
        return (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">输入文本内容进行敏感词检测</p>
            <textarea
              className="w-full p-4 bg-surface-alt border border-border rounded focus:outline-none focus:border-brand-gold text-base"
              rows={8}
              placeholder="请输入要检测的文本内容..."
              value={sensitiveText}
              onChange={(e) => setSensitiveText(e.target.value)}
            />
            <button
              onClick={handleSensitiveCheck}
              disabled={sensitiveLoading || !sensitiveText.trim()}
              className="px-6 py-2 bg-brand-gold-dark text-white rounded font-medium hover:bg-brand-gold transition-all disabled:opacity-50"
            >
              {sensitiveLoading ? '检测中...' : '开始检测'}
            </button>
            {sensitiveResult.length > 0 ? (
              <div className="p-4 theme-status-error rounded">
                <p className="text-sm font-medium theme-text-error mb-2">
                  检测到 {sensitiveResult.length} 个敏感词：
                </p>
                <div className="flex flex-wrap gap-2">
                  {sensitiveResult.map((word) => (
                    <span
                      key={word}
                      className="px-3 py-1 theme-status-error rounded text-xs font-medium"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            ) : sensitiveText.trim() && !sensitiveLoading ? (
              <div className="p-4 theme-status-success rounded">
                <p className="text-sm font-medium theme-text-success">未检测到敏感词</p>
              </div>
            ) : null}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em] flex items-center gap-2">
          <Icon size={24} className="text-brand-gold" /> {cfg.title}
        </h1>
      </div>
      {renderContent()}
    </div>
  )
}

export default AdminToolPage
