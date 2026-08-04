import type { ReactNode } from 'react'
import { Loader2, RefreshCw } from '@/src/components/icons'
import { Button } from '@/src/components/ui'
import { clsx } from 'clsx'

/**
 * 管理后台通用区块组件：标题行（图标 + 标题 + 分隔线）+ 内容。
 * 全站管理面板区块统一使用（无卡片框），避免样式漂移。
 */
export function AdminSection({
  id,
  icon,
  title,
  className,
  children,
}: {
  id?: string
  icon?: ReactNode
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section id={id} className={clsx('scroll-mt-16 space-y-4', className)}>
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {icon}
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * 区块加载/错误状态：loading 时显示加载文案，loadError 时显示错误与重试按钮。
 * 供各区块在内容加载前统一渲染，与 AdminSection 配套使用。
 */
export function SectionStatus({
  loading,
  loadingText,
  loadError,
  errorText,
  onRetry,
  children,
}: {
  loading: boolean
  loadingText: string
  loadError: boolean
  errorText: string
  onRetry: () => void
  children: ReactNode
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin" />
        {loadingText}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 text-sm text-text-secondary" role="alert">
        <p>{errorText}</p>
        <Button
          variant="secondary"
          onClick={onRetry}
          className="w-fit"
          leftIcon={<RefreshCw size={14} />}
        >
          重试
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
