// 帖子热度分数计算与刷新

export function calculatePostHotScore(post: {
  likesCount: number
  commentsCount: number
  viewCount?: number
  createdAt: Date
  updatedAt: Date
}) {
  const now = Date.now()
  const anchor = post.updatedAt && post.updatedAt > post.createdAt ? post.updatedAt : post.createdAt
  const hoursSince = Math.max(0, (now - anchor.getTime()) / (1000 * 60 * 60))
  const timeDecay = 6 / (1 + hoursSince / 24)
  const score =
    post.likesCount * 3 + post.commentsCount * 2 + (post.viewCount ?? 0) * 0.2 + timeDecay
  return Number(score.toFixed(3))
}
