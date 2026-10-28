import type { SyntheticEvent } from 'react'

/**
 * 默认头像（站点统一兜底）
 *
 * 作为静态资源放在 /public/default-avatar.svg，浏览器直接以 /default-avatar.svg
 * 访问。所有展示用户头像的地方应使用 `photoURL || DEFAULT_AVATAR` 兜底，并在
 * <img> 上挂载 handleAvatarError 以应对远端头像 URL 失效。
 */
export const DEFAULT_AVATAR = '/default-avatar.svg'

/**
 * <img onError> 兜底处理：当 photoURL 加载失败时切到默认头像。
 * 内置无限循环防护——若默认头像本身加载失败，不再触发重试。
 */
export const handleAvatarError = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  if (img.dataset.fallback === '1') return
  img.dataset.fallback = '1'
  img.src = DEFAULT_AVATAR
}

/**
 * 便捷工具：根据 photoURL 计算最终的 src。
 * 用于不需要区分"原图加载失败"与"原图为空"的简单场景。
 */
export const resolveAvatarSrc = (photoURL?: string | null): string => {
  if (!photoURL) return DEFAULT_AVATAR
  const trimmed = photoURL.trim()
  return trimmed || DEFAULT_AVATAR
}
