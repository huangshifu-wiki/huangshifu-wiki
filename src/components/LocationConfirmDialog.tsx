import React from 'react'
import { MapPin, Check, X, Loader2 } from '@/src/components/icons'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

interface RegionSuggestion {
  code: string
  name: string
  fullName: string
  level: number
  levelName: string
  parentCode: string | null
}

interface LocationConfirmDialogProps {
  open: boolean
  detectedLocation: RegionSuggestion | null
  onConfirm: () => void
  onChange: () => void
  onSkip: () => void
  loading?: boolean
}

export const LocationConfirmDialog = ({
  open,
  detectedLocation,
  onConfirm,
  onChange,
  onSkip,
  loading,
}: LocationConfirmDialogProps) => {
  const presence = useFloatingPresence(open)

  if (!presence.mounted) return null

  return (
    <div
      className="floating-overlay fixed inset-0 z-[100] flex items-center justify-center"
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onSkip} />
      <div className="floating-panel relative bg-surface rounded border border-border w-[90vw] max-w-md overflow-hidden">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded bg-brand-gold/10">
              <MapPin size={18} className="text-brand-gold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">检测到拍摄地点</h3>
              <p className="text-sm text-text-muted">是否使用从图片中提取的地点？</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-brand-gold" />
              <span className="ml-2 text-sm text-text-secondary">正在解析地点...</span>
            </div>
          ) : detectedLocation ? (
            <div className="space-y-4">
              <div className="p-3 rounded border border-border bg-surface-alt">
                <div className="text-sm font-medium text-text-primary">
                  {detectedLocation.fullName}
                </div>
                <div className="text-xs text-text-muted mt-1">{detectedLocation.levelName}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onConfirm}
                  className="flex-1 px-4 py-2 rounded theme-button-primary font-medium transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Check size={15} />
                  使用该地点
                </button>
                <button
                  onClick={onChange}
                  className="flex-1 px-4 py-2 rounded theme-button-secondary transition-all text-sm"
                >
                  更换地点
                </button>
              </div>
              <button
                onClick={onSkip}
                className="w-full px-4 py-2 text-text-muted hover:text-brand-gold text-sm transition-colors"
              >
                暂不设置地点
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded border border-border bg-surface-alt text-center">
                <p className="text-sm text-text-muted">未能在图片中检测到有效的 GPS 信息</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onChange}
                  className="flex-1 px-4 py-2 rounded theme-button-primary font-medium transition-all text-sm"
                >
                  手动选择地点
                </button>
                <button
                  onClick={onSkip}
                  className="flex-1 px-4 py-2 rounded theme-button-secondary transition-all text-sm"
                >
                  跳过
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export type { RegionSuggestion }
