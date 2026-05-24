export type CommentStateItem = {
  id: string
  parentId: string | null
  content: string
  isDeleted: boolean
  deletedAt?: string | null
  deletedBy?: string | null
  deletedByName?: string | null
  likedByMe?: boolean
  likesCount?: number
}

export function markCommentDeleted<T extends CommentStateItem>(comments: T[], options: {
  commentId: string
  deletedContent: string
  deletedBy: string
  deletedByName: string | null
  showDeletedComments: boolean
}) {
  const nextComments = comments.map((comment) =>
    comment.id === options.commentId
      ? {
          ...comment,
          content: options.showDeletedComments ? comment.content : options.deletedContent,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: options.deletedBy,
          deletedByName: options.deletedByName,
        }
      : comment
  )

  if (options.showDeletedComments) return nextComments

  const visibleChildrenByRoot = new Map<string, number>()
  for (const comment of nextComments) {
    if (!comment.parentId || comment.isDeleted) continue
    visibleChildrenByRoot.set(comment.parentId, (visibleChildrenByRoot.get(comment.parentId) ?? 0) + 1)
  }

  return nextComments.filter((comment) => {
    if (!comment.isDeleted) return true
    if (comment.parentId) return false
    return (visibleChildrenByRoot.get(comment.id) ?? 0) > 0
  })
}

export function restoreComment<T extends CommentStateItem>(comments: T[], commentId: string) {
  return comments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deletedByName: null,
        }
      : comment
  )
}

export function updateCommentLike<T extends CommentStateItem>(comments: T[], commentId: string, state: {
  likedByMe: boolean
  likesCount: number
}) {
  return comments.map((comment) =>
    comment.id === commentId
      ? { ...comment, likedByMe: state.likedByMe, likesCount: state.likesCount }
      : comment
  )
}
