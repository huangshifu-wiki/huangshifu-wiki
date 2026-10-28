/**
 * Cloudflare Turnstile 脚本按需加载（单例）
 *
 * 显式渲染模式：脚本加载完成后由调用方通过 window.turnstile.render 挂载组件。
 */

import { loadScript } from '../utils/scriptLoader'

export interface TurnstileRenderOptions {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  language?: string
  theme?: 'auto' | 'light' | 'dark'
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string
  reset(widgetId?: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loadPromise: Promise<TurnstileApi> | null = null

/** 加载并返回 window.turnstile；失败时重置状态以便重试 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }
  if (loadPromise) {
    return loadPromise
  }

  loadPromise = loadScript({ src: SCRIPT_SRC })
    .then(() => {
      if (!window.turnstile) {
        throw new Error('人机验证脚本已加载但未初始化')
      }
      return window.turnstile
    })
    .catch((error: unknown) => {
      loadPromise = null
      // 移除失败残留的 script 标签，允许挂件重挂载时重试
      document.querySelector(`script[src="${SCRIPT_SRC}"]`)?.remove()
      throw error
    })

  return loadPromise
}
