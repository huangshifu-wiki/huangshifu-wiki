import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import {
  limitedString,
  limitedStringArray,
  nullableLimitedString,
  optionalLimitedString,
} from '../utils/textLimits'

export const postCreateSchema = z.object({
  title: limitedString('标题', CONTENT_LIMITS.post.title).min(1, '标题不能为空'),
  section: limitedString('版块', CONTENT_LIMITS.post.section).min(1, '版块不能为空'),
  content: limitedString('内容', CONTENT_LIMITS.post.content).min(1, '内容不能为空'),
  tags: limitedStringArray('标签', CONTENT_LIMITS.post.tag, CONTENT_LIMITS.post.tags),
  status: z.enum(['draft', 'pending', 'published']).optional(),
  musicDocId: optionalLimitedString('歌曲 ID', CONTENT_LIMITS.music.id),
  albumDocId: optionalLimitedString('专辑 ID', CONTENT_LIMITS.album.id),
  locationCode: nullableLimitedString('地点编码', CONTENT_LIMITS.post.locationCode),
  locationDetail: nullableLimitedString('地点详情', CONTENT_LIMITS.post.locationDetail),
})

export const postUpdateSchema = postCreateSchema

export const postDeleteSchema = z
  .object({
    reason: optionalLimitedString('删除理由', CONTENT_LIMITS.post.reviewNote),
  })
  .default({})

export const postCommentSchema = z.object({
  content: limitedString('评论内容', CONTENT_LIMITS.post.comment).min(1, '评论内容不能为空'),
  parentId: nullableLimitedString('父评论 ID', CONTENT_LIMITS.admin.editLockRecordId),
})
