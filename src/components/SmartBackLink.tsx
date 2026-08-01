import React, { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, type LinkProps } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'

interface SmartBackLinkProps extends Omit<LinkProps, 'to'> {
  /** 无法后退时（直接打开 / 从站外进入）的目标地址 */
  fallbackTo: string
  /** 无法后退或来源路径无法识别时的返回文案 */
  fallbackLabel: string
  /** 返回图标，传 null 隐藏；默认 <ArrowLeft size={16} /> */
  icon?: React.ReactNode
}

const ORIGIN_BACK_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/search(?:\/|$)/, '返回搜索'],
  [/^\/users\/[^/]+\/favorites(?:\/|$)/, '返回收藏'],
  [/^\/$/, '返回首页'],
  [/^\/music\/?$/, '返回音乐馆'],
  [/^\/music\//, '返回歌曲'],
  [/^\/album\//, '返回专辑'],
  [/^\/events(?:\/|$)/, '返回活动'],
  [/^\/gallery\/?$/, '返回图集列表'],
  [/^\/forum\/?$/, '返回论坛列表'],
  [/^\/users\//, '返回个人主页'],
  [/^\/wiki\/[^/]+$/, '返回页面'],
  [/^\/wiki$/, '返回百科列表'],
]

/** 根据来源路径推导返回文案；无法识别时返回 null（由调用点兜底文案接管） */
export function matchBackLabel(pathname: string): string | null {
  for (const [pattern, label] of ORIGIN_BACK_LABELS) {
    if (pattern.test(pathname)) return label
  }
  return null
}

interface OriginEntry {
  key: string
  pathname: string
}

// 模块级历史栈：只在 commit 阶段（BackLinkTracker 的 effect）写入，渲染阶段只读。
// originCursor 指向“当前 entry”；渲染发生在 commit 之前时，cursor 还停在来源 entry。
// useBackOrigin 以 location.key 在栈中的位置为主、cursor 为兜底，推导返回将回到的路径。
let originStack: OriginEntry[] = []
let originCursor = -1

/** 测试用：清空模块级历史栈，避免用例间污染 */
export function resetBackLinkOriginForTests(): void {
  originStack = []
  originCursor = -1
}

/**
 * 记录站内导航历史，供 SmartBackLink 推导来源页面。
 * 必须挂载在 Router 内部（全站仅 App.tsx 一处）。
 */
export function BackLinkTracker(): null {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (originStack.length === 0) {
      originStack = [{ key: location.key, pathname: location.pathname }]
      originCursor = 0
      return
    }
    if (navigationType === 'POP') {
      const index = originStack.findIndex((entry) => entry.key === location.key)
      if (index !== -1) {
        originCursor = index
      }
      // index === -1（防御，如从站外返回）：保持 cursor 不变
    } else {
      // REPLACE / PUSH 都先截断被前进覆盖的条目，再更新当前 entry
      originStack = originStack.slice(0, originCursor + 1)
      if (navigationType === 'REPLACE') {
        originStack[originCursor] = { key: location.key, pathname: location.pathname }
      } else {
        originStack.push({ key: location.key, pathname: location.pathname })
        originCursor = originStack.length - 1
      }
    }
  }, [location.key, location.pathname, navigationType])

  return null
}

/**
 * 返回"返回按钮将回到的页面"路径；直接打开（无站内来源）时为 null。
 * 按 location.key 缓存结果：commit 后 cursor 指向当前页，重渲染时不能重算，
 * 否则会把来源误判成当前页；同组件跨路由复用（如 /music/1 → /music/2）时 key 变化触发重算。
 */
export function useBackOrigin(): string | null {
  const location = useLocation()
  const navigationType = useNavigationType()
  const cacheRef = useRef<{ key: string; value: string | null } | null>(null)

  if (cacheRef.current === null || cacheRef.current.key !== location.key) {
    let origin: string | null
    if (location.key === 'default') {
      origin = null
    } else {
      // 优先按 key 定位当前 entry：若 tracker effect 已推进 cursor（如数据加载后才挂载返回链接），
      // 来源是栈中当前 entry 的前一个；key 不在栈中说明渲染先于 tracker effect（导航同次 commit 渲染），
      // 此时 PUSH/POP 的 cursor 仍指向来源 entry，REPLACE 的来源是被替换 entry 的前一个。
      const index = originStack.findIndex((entry) => entry.key === location.key)
      if (index >= 1) {
        origin = originStack[index - 1].pathname
      } else if (index === 0) {
        origin = null
      } else if (navigationType === 'REPLACE') {
        origin = originCursor >= 1 ? (originStack[originCursor - 1]?.pathname ?? null) : null
      } else {
        origin = originCursor >= 0 ? (originStack[originCursor]?.pathname ?? null) : null
      }
    }
    cacheRef.current = { key: location.key, value: origin }
  }

  return cacheRef.current.value
}

/**
 * 智能返回链接：站内导航进入时行为等同浏览器后退（保留来源页筛选/分页状态），
 * 直接打开或从站外进入时回退到 fallbackTo（replace，避免详情页留在历史栈）。
 * 文案优先按来源路径推导（如"返回搜索"），来源无法识别时用 fallbackLabel。
 */
export function SmartBackLink({
  fallbackTo,
  fallbackLabel,
  icon = <ArrowLeft size={16} />,
  onClick,
  ...rest
}: SmartBackLinkProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const originPathname = useBackOrigin()

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

  const label =
    originPathname !== null ? (matchBackLabel(originPathname) ?? fallbackLabel) : fallbackLabel

  return (
    <Link to={fallbackTo} replace onClick={handleClick} {...rest}>
      {icon}
      {label}
    </Link>
  )
}
