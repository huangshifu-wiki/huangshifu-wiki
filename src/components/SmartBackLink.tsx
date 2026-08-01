import { Link, useLocation, useNavigate, type LinkProps } from 'react-router-dom'

interface SmartBackLinkProps extends Omit<LinkProps, 'to'> {
  /** 无法后退时（直接打开 / 从站外进入）的目标地址 */
  fallbackTo: string
}

/**
 * 智能返回链接：站内导航进入时行为等同浏览器后退（保留来源页筛选/分页状态），
 * 直接打开或从站外进入时回退到 fallbackTo（replace，避免详情页留在历史栈）。
 */
export function SmartBackLink({ fallbackTo, onClick, ...rest }: SmartBackLinkProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    // 修饰键 / 非左键点击保留 Link 默认行为（新标签页打开 fallbackTo）
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    if (location.key !== 'default') {
      event.preventDefault()
      navigate(-1)
    }
    // location.key === 'default'：保持 Link 默认行为，跳转 fallbackTo
  }

  return <Link to={fallbackTo} replace onClick={handleClick} {...rest} />
}
