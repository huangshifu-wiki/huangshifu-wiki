import { useState, useCallback } from 'react'
import { apiPost, apiDelete } from '../lib/apiClient'
import { getErrorMessage } from '../lib/errorHandler'

export type InteractionType = 'like' | 'dislike' | 'favorite' | 'pin'

export interface UseToggleInteractionOptions<T> {
  /** 当前实体对象（如 page / post / song） */
  entity: T | null
  /** 设置实体状态的 setter，支持函数式更新 */
  setEntity: (entity: T | ((prev: T) => T)) => void
  /** 当前登录用户，null 表示未登录 */
  user: { uid: string; role?: string; status?: string } | null
  /** 用户是否被封禁 */
  isBanned?: boolean
  /** 用户是否为管理员 */
  isAdmin?: boolean
  /** API 基础路径，如 '/api/wiki'、'/api/posts' */
  apiBase: string
  /** 实体 ID（wiki 用 slug，posts 用 id，music 用 docId） */
  entityId: string | undefined
  /** toast 提示方法 */
  toast: { show: (msg: string, opts?: { variant?: string }) => void }
  /** i18n 翻译函数 */
  t: (key: string) => string
}

export interface UseToggleInteractionReturn {
  toggleLike: () => Promise<void>
  toggleDislike: () => Promise<void>
  toggleFavorite: () => Promise<void>
  togglePin: () => Promise<void>
  liking: boolean
  disliking: boolean
  favoriting: boolean
  pinning: boolean
}

/** 从 apiBase 推导收藏的 targetType */
function deriveFavoriteTargetType(apiBase: string): string {
  if (apiBase.includes('/wiki')) return 'wiki'
  if (apiBase.includes('/posts')) return 'post'
  if (apiBase.includes('/music')) return 'music'
  // 兜底：取最后一段路径
  const segments = apiBase.split('/')
  return segments[segments.length - 1] || 'unknown'
}

/** i18n key 前缀，基于 apiBase 推导 */
function deriveI18nPrefix(apiBase: string): string {
  if (apiBase.includes('/wiki')) return 'wiki'
  if (apiBase.includes('/posts')) return 'forum'
  if (apiBase.includes('/music')) return 'music'
  return 'common'
}

/**
 * 通用交互 Hook：封装 like / dislike / favorite / pin 的乐观更新逻辑。
 *
 * 核心流程：
 * 1. 前置检查（登录、权限、防重复点击）
 * 2. 保存 prevState
 * 3. 乐观更新实体状态
 * 4. 调用 API
 * 5. 成功时用服务端返回值修正计数
 * 6. 失败时回滚到 prevState
 * 7. finally 重置 loading
 */
export function useToggleInteraction<T extends Record<string, any>>(
  options: UseToggleInteractionOptions<T>
): UseToggleInteractionReturn {
  const {
    entity,
    setEntity,
    user,
    isBanned = false,
    isAdmin = false,
    apiBase,
    entityId,
    toast,
    t,
  } = options

  const [liking, setLiking] = useState(false)
  const [disliking, setDisliking] = useState(false)
  const [favoriting, setFavoriting] = useState(false)
  const [pinning, setPinning] = useState(false)

  const prefix = deriveI18nPrefix(apiBase)
  const favoriteTargetType = deriveFavoriteTargetType(apiBase)

  const toggleLike = useCallback(async () => {
    if (!entityId || liking) return
    if (isBanned) {
      toast.show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      toast.show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setLiking(true)
    const prevState = entity

    // 乐观更新
    if (entity?.likedByMe) {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              likedByMe: false,
              likesCount: Math.max(0, Number(prev.likesCount || 0) - 1),
            }
          : prev
      )
    } else {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              likedByMe: true,
              likesCount: Number(prev.likesCount || 0) + 1,
              dislikedByMe: false,
              dislikesCount: entity?.dislikedByMe
                ? Math.max(0, Number(prev.dislikesCount || 0) - 1)
                : prev.dislikesCount,
            }
          : prev
      )
    }

    try {
      if (prevState?.likedByMe) {
        const data = await apiDelete<{ liked: boolean; likesCount: number }>(
          `${apiBase}/${entityId}/like`
        )
        setEntity((prev: T) => (prev ? { ...prev, likesCount: data.likesCount } : prev))
      } else {
        const data = await apiPost<{
          liked: boolean
          likesCount: number
          dislikesCount: number
        }>(`${apiBase}/${entityId}/like`)
        setEntity((prev: T) =>
          prev ? { ...prev, likesCount: data.likesCount, dislikesCount: data.dislikesCount } : prev
        )
      }
    } catch (error) {
      if (prevState) setEntity(prevState)
      console.error('Toggle like failed:', error)
      toast.show(getErrorMessage(error, t(`${prefix}.likeFailed`)), { variant: 'error' })
    } finally {
      setLiking(false)
    }
  }, [entityId, user, liking, isBanned, entity, setEntity, apiBase, toast, t, prefix])

  const toggleDislike = useCallback(async () => {
    if (!entityId || disliking) return
    if (isBanned) {
      toast.show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      toast.show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setDisliking(true)
    const prevState = entity

    // 乐观更新
    if (entity?.dislikedByMe) {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              dislikedByMe: false,
              dislikesCount: Math.max(0, Number(prev.dislikesCount || 0) - 1),
            }
          : prev
      )
    } else {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              dislikedByMe: true,
              dislikesCount: Number(prev.dislikesCount || 0) + 1,
              likedByMe: false,
              likesCount: entity?.likedByMe
                ? Math.max(0, Number(prev.likesCount || 0) - 1)
                : prev.likesCount,
            }
          : prev
      )
    }

    try {
      if (prevState?.dislikedByMe) {
        const data = await apiDelete<{
          disliked: boolean
          dislikesCount: number
        }>(`${apiBase}/${entityId}/dislike`)
        setEntity((prev: T) => (prev ? { ...prev, dislikesCount: data.dislikesCount } : prev))
      } else {
        const data = await apiPost<{
          disliked: boolean
          dislikesCount: number
          likesCount: number
        }>(`${apiBase}/${entityId}/dislike`)
        setEntity((prev: T) =>
          prev ? { ...prev, dislikesCount: data.dislikesCount, likesCount: data.likesCount } : prev
        )
      }
    } catch (error) {
      if (prevState) setEntity(prevState)
      console.error('Toggle dislike failed:', error)
      toast.show(getErrorMessage(error, t(`${prefix}.dislikeFailed`)), { variant: 'error' })
    } finally {
      setDisliking(false)
    }
  }, [entityId, user, disliking, isBanned, entity, setEntity, apiBase, toast, t, prefix])

  const toggleFavorite = useCallback(async () => {
    if (!entityId || favoriting) return
    if (isBanned) {
      toast.show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      toast.show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setFavoriting(true)
    const prevState = entity

    // 乐观更新
    if (entity?.favoritedByMe) {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              favoritedByMe: false,
              favoritesCount: Math.max(0, Number(prev.favoritesCount || 0) - 1),
            }
          : prev
      )
    } else {
      setEntity((prev: T) =>
        prev
          ? {
              ...prev,
              favoritedByMe: true,
              favoritesCount: Number(prev.favoritesCount || 0) + 1,
            }
          : prev
      )
    }

    try {
      if (prevState?.favoritedByMe) {
        await apiDelete(`/api/favorites/${favoriteTargetType}/${entityId}`)
      } else {
        await apiPost('/api/favorites', {
          targetType: favoriteTargetType,
          targetId: entityId,
        })
      }
    } catch (error) {
      if (prevState) setEntity(prevState)
      console.error('Toggle favorite failed:', error)
      toast.show(getErrorMessage(error, t(`${prefix}.favoriteFailed`)), { variant: 'error' })
    } finally {
      setFavoriting(false)
    }
  }, [
    entityId,
    user,
    favoriting,
    isBanned,
    entity,
    setEntity,
    favoriteTargetType,
    toast,
    t,
    prefix,
  ])

  const togglePin = useCallback(async () => {
    if (!entityId || !isAdmin || pinning) return

    setPinning(true)
    const prevState = entity

    try {
      if (entity?.isPinned) {
        await apiDelete<{ isPinned: boolean }>(`${apiBase}/${entityId}/pin`)
        setEntity((prev: T) => (prev ? { ...prev, isPinned: false } : prev))
      } else {
        const data = await apiPost<{ isPinned: boolean }>(`${apiBase}/${entityId}/pin`)
        setEntity((prev: T) => (prev ? { ...prev, isPinned: data.isPinned } : prev))
      }
    } catch (error) {
      // pin 操作的回滚：恢复到之前的状态
      if (prevState) setEntity(prevState)
      console.error('Toggle pin failed:', error)
      toast.show(getErrorMessage(error, t(`${prefix}.pinFailed`)), { variant: 'error' })
    } finally {
      setPinning(false)
    }
  }, [entityId, isAdmin, pinning, entity, setEntity, apiBase, toast, t, prefix])

  return {
    toggleLike,
    toggleDislike,
    toggleFavorite,
    togglePin,
    liking,
    disliking,
    favoriting,
    pinning,
  }
}
