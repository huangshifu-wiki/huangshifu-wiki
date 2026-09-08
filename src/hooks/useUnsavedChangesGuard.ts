import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { UNSAFE_NavigationContext, type NavigateOptions, type To } from 'react-router-dom'
import { useDialog } from '../components/Dialog'

/**
 * 未保存变更离开守卫。
 *
 * 当前应用是 <BrowserRouter>（非 data router），官方 useBlocker/usePrompt 在此架构下
 * 会直接抛错，因此自行实现拦截，覆盖三类离开途径：
 * 1. 站内导航（<Link>/useNavigate）：包装 navigator.push/replace/go；
 * 2. 浏览器后退/前进（popstate）：激活时压入一条克隆当前路由的"哨兵"历史条目，
 *    后退会先弹回哨兵再弹确认，确认离开才真正后退；
 * 3. 刷新/关闭标签页/地址栏跳转：beforeunload 走浏览器原生确认。
 *
 * 已知边界：长按后退从历史菜单多级直跳会绕过哨兵；beforeunload 文案不可定制。
 * 将来若迁移到 data router，可用官方 useBlocker + useBeforeUnload 替换本模块。
 */

const GUARD_STATE_KEY = '__hsfGuard'

const CONFIRM_OPTIONS = {
  title: '离开此页面？',
  message: '当前修改尚未保存，离开后将丢失这些更改。',
  confirmText: '离开',
  cancelText: '留在本页',
  variant: 'warning' as const,
}

type ConfirmFn = (options: typeof CONFIRM_OPTIONS) => Promise<boolean>

type PushFn = (to: To, state?: unknown, options?: NavigateOptions) => void
type GoFn = (delta: number) => void

interface PatchedNavigator {
  push: PushFn
  replace: PushFn
  go: GoFn
}

interface GuardInstance {
  isDirtyRef: { current: boolean }
}

export interface UnsavedChangesGuard {
  /** 保存成功后同步解除拦截；必须在随后调用 navigate 之前调用 */
  markClean: () => void
}

// 模块级单例管理器：支持同一页面多个表单各自挂守卫（如设置页多个分区）
const instances = new Set<GuardInstance>()
let confirmRef: ConfirmFn | null = null
let navigatorRef: PatchedNavigator | null = null
let installed = false
let ignorePopCount = 0
let generation = 0
// 哨兵是否为当前历史条目；初始化时识别"刷新落在哨兵条目上"的情况
let sentinelCurrent = isSentinelState(typeof window !== 'undefined' ? window.history.state : null)

function isSentinelState(state: unknown): boolean {
  return Boolean(
    state && typeof state === 'object' && GUARD_STATE_KEY in (state as Record<string, unknown>)
  )
}

function isActive(): boolean {
  for (const instance of instances) {
    if (instance.isDirtyRef.current) return true
  }
  return false
}

function pushSentinel(): void {
  const current = window.history.state as Record<string, unknown> | null
  const idx = typeof current?.idx === 'number' ? current.idx + 1 : 0
  // 克隆当前路由 state（保留 key/idx 供 react-router 与 BackLinkTracker 正常工作），仅递增 idx
  window.history.pushState(
    { ...(current ?? {}), idx, [GUARD_STATE_KEY]: true },
    '',
    window.location.href
  )
  sentinelCurrent = true
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!isActive()) return
  event.preventDefault()
  event.returnValue = ''
}

function handlePopState(event: PopStateEvent): void {
  sentinelCurrent = isSentinelState(event.state)
  if (ignorePopCount > 0) {
    ignorePopCount -= 1
    return
  }
  if (!isActive() || sentinelCurrent) return
  void resolveLeaveAttempt()
}

async function confirmLeave(): Promise<boolean> {
  const gen = generation
  const confirm = confirmRef
  if (!confirm) return false
  const proceed = await confirm(CONFIRM_OPTIONS)
  // 等待确认期间守卫已被去激活（如二次后退导致页面切换）：视为取消
  return gen === generation && proceed
}

function waitForPop(timeoutMs = 50): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('popstate', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, timeoutMs)
    window.addEventListener('popstate', finish)
  })
}

// 放行 push 前先弹回真实条目，避免哨兵残留在历史栈中导致"后退要按多次"
async function collapseSentinelBeforePush(): Promise<void> {
  ignorePopCount += 1
  window.history.go(-1)
  sentinelCurrent = false
  await waitForPop()
}

async function resolveLeaveAttempt(): Promise<void> {
  const gen = generation
  const confirm = confirmRef
  if (!confirm) return
  const leave = await confirm(CONFIRM_OPTIONS)
  if (gen !== generation || !installed) return
  // 留下：前进一格弹回哨兵；离开：再后退一格。都跳过自身触发的 popstate
  ignorePopCount += 1
  window.history.go(leave ? -1 : 1)
}

const patchedPush: PushFn = async (to, state, options) => {
  if (!isActive()) {
    originals.push?.(to, state, options)
    return
  }
  if (!(await confirmLeave())) return
  // 等待确认期间守卫可能已被去激活（originals 被清空）
  if (!installed || !originals.push) return
  if (sentinelCurrent) await collapseSentinelBeforePush()
  if (!installed || !originals.push) return
  originals.push(to, state, options)
  sentinelCurrent = false
}

const patchedReplace: PushFn = async (to, state, options) => {
  if (!isActive()) {
    originals.replace?.(to, state, options)
    return
  }
  if (!(await confirmLeave())) return
  if (!installed || !originals.replace) return
  // replace 直接覆盖当前条目（含哨兵），天然清理
  originals.replace(to, state, options)
  sentinelCurrent = false
}

const patchedGo: GoFn = async (delta) => {
  if (!isActive()) {
    originals.go?.(delta)
    return
  }
  if (!(await confirmLeave())) return
  if (!installed || !originals.go) return
  // 当前在哨兵条目上时，负向 delta 额外跳过哨兵，避免"返回按了没反应"
  ignorePopCount += 1
  originals.go(delta < 0 && sentinelCurrent ? delta - 1 : delta)
}

const originals: { push: PushFn | null; replace: PushFn | null; go: GoFn | null } = {
  push: null,
  replace: null,
  go: null,
}

function activate(): void {
  if (installed) return
  installed = true
  ignorePopCount = 0
  const navigator = navigatorRef
  if (navigator) {
    originals.push = navigator.push.bind(navigator)
    originals.replace = navigator.replace.bind(navigator)
    originals.go = navigator.go.bind(navigator)
    navigator.push = patchedPush
    navigator.replace = patchedReplace
    navigator.go = patchedGo
  }
  // 监听器常驻（空闲时自我短路），避免装卸与哨兵收缩之间的竞态
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('popstate', handlePopState)
  if (!sentinelCurrent) pushSentinel()
}

function deactivate(): void {
  if (!installed) return
  installed = false
  generation += 1
  const navigator = navigatorRef
  if (navigator && originals.push) {
    navigator.push = originals.push
    navigator.replace = originals.replace
    navigator.go = originals.go
  }
  originals.push = null
  originals.replace = null
  originals.go = null
  if (sentinelCurrent) {
    // 延迟收缩：StrictMode 下 activate/deactivate 会连续成对执行，
    // 若立即收缩随后又被重新激活，会产生多余的哨兵条目
    window.setTimeout(() => {
      if (installed || !sentinelCurrent) return
      sentinelCurrent = false
      // markClean 后的 navigate 走已还原的原始 push/replace，会覆盖哨兵条目并写入
      // react-router 的全新 state（不含 GUARD_STATE_KEY）；此时哨兵已消失，
      // 若仍 go(-1) 会把用户从目标页弹回编辑页（即"保存要点两次"的根因）
      if (!isSentinelState(window.history.state)) return
      ignorePopCount += 1
      window.history.go(-1)
    }, 0)
  }
}

function syncActivation(): void {
  if (isActive() && !installed) activate()
  else if (!isActive() && installed) deactivate()
}

/** 测试用：清空模块级守卫状态，避免用例间污染 */
export function resetUnsavedChangesGuardForTests(): void {
  instances.clear()
  confirmRef = null
  navigatorRef = null
  installed = false
  ignorePopCount = 0
  generation += 1
  sentinelCurrent = isSentinelState(window.history.state)
}

function registerInstance(
  instance: GuardInstance,
  navigator: PatchedNavigator | null,
  confirm: ConfirmFn
): void {
  instances.add(instance)
  confirmRef = confirm
  if (navigator) {
    navigatorRef = navigator
  }
}

function unregisterInstance(instance: GuardInstance): void {
  instances.delete(instance)
}

export function useUnsavedChangesGuard(when: boolean): UnsavedChangesGuard {
  // 测试等场景可能在 Router 外渲染组件：无 navigator 时跳过站内导航拦截，
  // 仅保留 beforeunload 与哨兵能力
  const navigation = useContext(UNSAFE_NavigationContext)
  const { confirm } = useDialog()
  const isDirtyRef = useRef(false)
  const instance = useMemo<GuardInstance>(() => ({ isDirtyRef }), [isDirtyRef])

  // 拦截判定读取 ref 中的实时脏状态，保存后 markClean 同步生效
  useLayoutEffect(() => {
    isDirtyRef.current = when
  })

  useEffect(() => {
    registerInstance(instance, navigation?.navigator ?? null, confirm)
    syncActivation()
    return () => {
      unregisterInstance(instance)
      syncActivation()
    }
    // when 翻转时重新同步激活：挂载时页面尚未脏，激活必须由脏状态变化驱动
  }, [instance, navigation, confirm, when])

  const markClean = useCallback(() => {
    isDirtyRef.current = false
    syncActivation()
  }, [])

  return { markClean }
}
