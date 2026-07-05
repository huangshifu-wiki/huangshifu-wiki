import { Prisma } from '@prisma/client'
import type { ApiUser } from '../types'
import { canViewGallery, canViewPost } from './authorization'
import { prisma } from './config'
import { buildMentionTargetsByTextKey } from './mentions'
import { toCommentResponse } from './response-transformers'

const commentInclude = {
  author: {
    select: { publicId: true, displayName: true, photoURL: true },
  },
  replyTo: {
    select: {
      authorUid: true,
      author: {
        select: { publicId: true, displayName: true },
      },
    },
  },
  _count: {
    select: { likes: true },
  },
} satisfies Prisma.PostCommentInclude

type CommentWithRelations = Prisma.PostCommentGetPayload<{ include: typeof commentInclude }>

export async function buildCommentResponses(
  comments: CommentWithRelations[],
  options: {
    authUserUid?: string | null
    includeDeleted?: boolean
  }
) {
  const includeDeleted = Boolean(options.includeDeleted)
  const visibleComments = includeDeleted ? comments : filterVisibleComments(comments)
  return serializeCommentResponses(visibleComments, {
    authUserUid: options.authUserUid,
    includeDeleted,
  })
}

async function serializeCommentResponses(
  comments: CommentWithRelations[],
  options: {
    authUserUid?: string | null
    includeDeleted: boolean
  }
) {
  const commentIds = comments.map((comment) => comment.id)
  const deletedByUids = [
    ...new Set(
      options.includeDeleted
        ? comments.map((comment) => comment.deletedBy).filter((uid): uid is string => Boolean(uid))
        : []
    ),
  ]

  const [likedComments, deletedByUsers, mentionTargetsByCommentId] = await Promise.all([
    options.authUserUid && commentIds.length
      ? prisma.postCommentLike.findMany({
          where: {
            userUid: options.authUserUid,
            commentId: { in: commentIds },
          },
          select: { commentId: true },
        })
      : Promise.resolve([]),
    deletedByUids.length
      ? prisma.user.findMany({
          where: { uid: { in: deletedByUids } },
          select: { uid: true, displayName: true },
        })
      : Promise.resolve([]),
    buildMentionTargetsByTextKey(
      comments
        .filter((comment) => options.includeDeleted || !comment.deletedAt)
        .map((comment) => ({ key: comment.id, content: comment.content }))
    ),
  ])

  const likedCommentSet = new Set(likedComments.map((item) => item.commentId))
  const deletedByNameMap = new Map(deletedByUsers.map((user) => [user.uid, user.displayName]))

  return comments.map((comment) =>
    toCommentResponse(
      {
        ...comment,
        mentionTargets: mentionTargetsByCommentId.get(comment.id) ?? [],
      },
      {
        maskDeletedContent: !options.includeDeleted,
        hideDeletedAuthor: !options.includeDeleted,
        likedByMe: likedCommentSet.has(comment.id),
        deletedByName:
          options.includeDeleted && comment.deletedBy
            ? (deletedByNameMap.get(comment.deletedBy) ?? null)
            : null,
      }
    )
  )
}

export async function fetchPostCommentsForResponse(
  postId: string,
  options: {
    authUserUid?: string | null
    includeDeleted?: boolean
  }
) {
  const comments = await prisma.postComment.findMany({
    where: { postId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: commentInclude,
  })

  return buildCommentResponses(comments, options)
}

export async function fetchPostCommentsPageForResponse(
  postId: string,
  options: {
    authUserUid?: string | null
    includeDeleted?: boolean
    take?: number
    skip?: number
  }
) {
  const skip = options.skip ?? 0
  if (options.includeDeleted) {
    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where: { postId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: options.take,
        skip,
        include: commentInclude,
      }),
      prisma.postComment.count({ where: { postId } }),
    ])

    return {
      comments: await serializeCommentResponses(comments, {
        authUserUid: options.authUserUid,
        includeDeleted: true,
      }),
      total,
    }
  }

  const limitClause =
    typeof options.take === 'number' ? Prisma.sql`LIMIT ${options.take}` : Prisma.empty
  const offsetClause = skip > 0 ? Prisma.sql`OFFSET ${skip}` : Prisma.empty
  const visibleWhere = Prisma.sql`
    "postId" = ${postId}
    AND (
      "deletedAt" IS NULL
      OR (
        "parentId" IS NULL
        AND "deletedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "PostComment" AS child
          WHERE child."parentId" = "PostComment"."id"
            AND child."deletedAt" IS NULL
        )
      )
    )
  `

  const [pageRows, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PostComment"
      WHERE ${visibleWhere}
      ORDER BY "createdAt" ASC, "id" ASC
      ${limitClause}
      ${offsetClause}
    `),
    prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS "count"
      FROM "PostComment"
      WHERE ${visibleWhere}
    `),
  ])

  const commentIds = pageRows.map((row) => row.id)
  const comments = commentIds.length
    ? await prisma.postComment.findMany({
        where: { id: { in: commentIds } },
        include: commentInclude,
      })
    : []
  const commentOrder = new Map(commentIds.map((id, index) => [id, index]))
  comments.sort((a, b) => (commentOrder.get(a.id) ?? 0) - (commentOrder.get(b.id) ?? 0))

  return {
    comments: await serializeCommentResponses(comments, {
      authUserUid: options.authUserUid,
      includeDeleted: false,
    }),
    total: Number(totalRows[0]?.count ?? 0),
  }
}

export async function fetchGalleryCommentsForResponse(
  galleryId: string,
  options: {
    authUserUid?: string | null
    includeDeleted?: boolean
  }
) {
  const comments = await prisma.postComment.findMany({
    where: { galleryId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: commentInclude,
  })

  return buildCommentResponses(comments, options)
}

async function findCommentLikeTarget(commentId: string) {
  return prisma.postComment.findUnique({
    where: { id: commentId },
    select: {
      deletedAt: true,
      post: {
        select: {
          status: true,
          authorUid: true,
        },
      },
      gallery: {
        select: {
          status: true,
          published: true,
          authorUid: true,
        },
      },
    },
  })
}

async function canLikeComment(commentId: string, authUser: ApiUser) {
  const target = await findCommentLikeTarget(commentId)

  if (!target || target.deletedAt) return false
  if (target.post) return canViewPost(target.post, authUser)
  if (target.gallery) return canViewGallery(target.gallery, authUser)

  return false
}

export async function resolveCommentReplyTarget(
  targetId: string,
  expected: {
    postId?: string
    galleryId?: string
  }
) {
  const target = await prisma.postComment.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      postId: true,
      galleryId: true,
      parentId: true,
      authorUid: true,
      deletedAt: true,
    },
  })

  if (!target) return null
  if (expected.postId && target.postId !== expected.postId) return null
  if (expected.galleryId && target.galleryId !== expected.galleryId) return null

  const isRoot = !target.parentId
  if (target.deletedAt && !isRoot) return null

  return {
    parentId: isRoot ? target.id : target.parentId,
    replyToId: target.id,
    replyTargetUid: target.authorUid,
  }
}

export async function createCommentLike(commentId: string, authUser: ApiUser) {
  if (!(await canLikeComment(commentId, authUser))) return null

  await prisma.postCommentLike.upsert({
    where: {
      commentId_userUid: { commentId, userUid: authUser.uid },
    },
    update: {},
    create: { commentId, userUid: authUser.uid },
  })

  return getCommentLikeState(commentId, authUser.uid)
}

export async function deleteCommentLike(commentId: string, authUser: ApiUser) {
  if (!(await canLikeComment(commentId, authUser))) return null

  await prisma.postCommentLike.deleteMany({
    where: { commentId, userUid: authUser.uid },
  })

  return getCommentLikeState(commentId, authUser.uid)
}

async function getCommentLikeState(commentId: string, userUid: string) {
  const [likesCount, likedByMe] = await Promise.all([
    prisma.postCommentLike.count({ where: { commentId } }),
    prisma.postCommentLike.count({ where: { commentId, userUid } }).then((count) => count > 0),
  ])

  return { liked: likedByMe, likedByMe, likesCount }
}

function filterVisibleComments(comments: CommentWithRelations[]) {
  const visibleChildrenByRoot = new Map<string, number>()

  for (const comment of comments) {
    if (!comment.parentId || comment.deletedAt) continue
    visibleChildrenByRoot.set(
      comment.parentId,
      (visibleChildrenByRoot.get(comment.parentId) ?? 0) + 1
    )
  }

  return comments.filter((comment) => {
    if (!comment.deletedAt) return true
    if (comment.parentId) return false
    return (visibleChildrenByRoot.get(comment.id) ?? 0) > 0
  })
}
